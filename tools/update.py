"""
update.py
=========
Turns a league config (league/<year>.json, plus league/<year>-mm.json for
March Madness) into the site's data files by fetching box scores, then
rebuilds data/index.json.

    python tools/update.py                 # current season, auto source
    python tools/update.py --source espn   # force the no-key ESPN source

Scoring rules (regular season):
  * 7 rostered players; each one's game # is his team's game # (conference
    tournament included, NCAA tournament excluded), up to `slots` games.
  * 6 starters count. The owner picks 1 bench player (config "bench", by game #).
  * If a starter doesn't play his game N, the bench player's game N counts in
    his place -- even if the bench player's game N happened first.
  * Pickups: count the games each player's team has played through the
    pickup date (games that day included). The added player counts from the
    next game # after the larger of the two; the dropped player fills every
    game # before that -- even games he plays after the pickup -- so each
    game # is counted exactly once. ("fromGame" in the config overrides.)
March Madness: 7 players, all count, NCAA tournament games 1-6.
"""
import argparse
import glob
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources  # noqa: E402
from build import build  # noqa: E402
from common import ROOT, norm_name, read_json, season_label, write_json  # noqa: E402

MM_SLOTS = 6


def latest_season():
    years = [int(os.path.basename(f)[:4]) for f in glob.glob(os.path.join(ROOT, "league", "[0-9][0-9][0-9][0-9].json"))]
    if not years:
        raise SystemExit("no league/<year>.json config found")
    return max(years)


def now_et():
    return (datetime.now(timezone.utc) - timedelta(hours=5)).strftime("%Y-%m-%d %H:%M ET")


class Resolver:
    """Finds each player's school + ESPN id and remembers it in cfg['players']."""

    def __init__(self, cfg):
        self.players = cfg.setdefault("players", {})
        self._b1g = None
        self._rosters = {}
        self.changed = False

    def resolve(self, name, school=None):
        info = self.players.get(name) or {}
        if info.get("id") and info.get("school"):
            return info
        school = info.get("school") or school
        hit = None
        if school:
            school = sources.find_school(school)
            if school not in self._rosters:
                self._rosters[school] = sources.school_roster(school)
            hit = self._rosters[school].get(norm_name(name))
        else:
            if self._b1g is None:
                print("  looking up Big Ten rosters...")
                self._b1g = sources.big_ten_rosters()
            hit = self._b1g.get(norm_name(name))
        if not hit:
            if school:
                # not on the current roster page -- box scores get matched by name
                self.players[name] = {"school": school, "id": None}
                return self.players[name]
            print(f"  WARNING: couldn't find '{name}' on any Big Ten roster. Set his school in the config's "
                  f"\"players\" section, e.g. \"{name}\": {{\"school\": \"Purdue\"}}")
            self.players[name] = {"school": None, "id": None}
            return self.players[name]
        self.players[name] = {"school": hit["school"], "id": hit["id"]}
        self.changed = True
        print(f"  {name}: {hit['school']} (ESPN id {hit['id']})")
        return self.players[name]


class Fetcher:
    def __init__(self, season, source):
        self.season, self.source, self.cache = season, source, {}

    def games(self, school, bucket):
        if not school:
            return []
        if school not in self.cache:
            print(f"  fetching {school} ({self.source})")
            self.cache[school] = sources.team_games(school, self.season, self.source)
        return self.cache[school][bucket]


def player_line(name, n, info, games, overrides):
    """Row for player `name` in his team's game n (1-based)."""
    ov = overrides.get((norm_name(name), n))
    row = {"p": name}
    if n <= len(games):
        g = games[n - 1]
        row["o"], row["d"] = g["opp"], g["date"]
        line = g["players"].get(str(info.get("id"))) if info.get("id") else None
        if line is None and not info.get("id"):
            # no ESPN id (e.g. not on the roster page): match by name instead
            key = norm_name(name)
            line = next((v for v in g["players"].values() if norm_name(v["name"]) == key), None)
        if line:
            row["raw"] = line["s"]
        else:
            row["st"] = "dnp"
    else:
        row["st"] = "pending"
    if ov:
        if ov.get("dnp"):
            row.pop("raw", None)
            row["st"] = "dnp"
        elif ov.get("stats"):
            row["raw"] = ov["stats"]
            row.pop("st", None)
        if ov.get("opp"):
            row["o"] = ov["opp"]
        row["ov"] = 1
    return row


def compute_season(cfg, fetcher, resolver):
    slots = cfg.get("slots", 31)
    overrides = {(norm_name(o["player"]), int(o["game"])): o for o in cfg.get("overrides", [])}
    out_teams = {}
    for mgr, t in cfg["teams"].items():
        draft = [p or None for p in t["draft"]]
        for p in draft:
            if p:
                resolver.resolve(p)
        for pk in t.get("pickups", []):
            resolver.resolve(pk["add"], pk.get("school"))

        def games_of(name):
            return fetcher.games(resolver.players.get(name, {}).get("school"), "regular") if name else []

        # slot timeline: list of (fromGame, player) per slot
        timeline = [[(1, p)] for p in draft]
        resolved_pickups = []
        for pk in sorted(t.get("pickups", []), key=lambda x: x.get("date") or ""):
            holders = [tl[-1][1] for tl in timeline]
            if pk["drop"] not in holders:
                print(f"  WARNING: {mgr} pickup drops '{pk['drop']}', who isn't on the roster. Skipped.")
                continue
            slot = holders.index(pk["drop"])
            if pk.get("fromGame"):
                start = int(pk["fromGame"])
            else:
                played = lambda gs: sum(1 for g in gs if g["date"] <= pk["date"])  # noqa: E731
                start = max(played(games_of(pk["drop"])), played(games_of(pk["add"]))) + 1
            timeline[slot].append((start, pk["add"]))
            resolved_pickups.append({"slot": slot + 1, "add": pk["add"], "drop": pk["drop"],
                                     "date": pk.get("date"), "fromGame": start})

        def holder(slot, n):
            cur = None
            for start, p in timeline[slot]:
                if start <= n:
                    cur = p
            return cur

        bench_plan = sorted(t.get("bench", []), key=lambda b: int(b["fromGame"]))
        games = []
        warned = False
        for n in range(1, slots + 1):
            holders = [holder(i, n) for i in range(len(timeline))]
            bench = None
            for b in bench_plan:
                if int(b["fromGame"]) <= n:
                    bench = b["player"]
            if not bench or bench not in holders:
                if bench and not warned:
                    print(f"  WARNING: {mgr}'s bench player '{bench}' isn't on the roster at game {n}.")
                bench = holders[-1] if holders and holders[-1] else None
                if not warned and any(holders):
                    print(f"  WARNING: {mgr} has no bench set for game {n}; defaulting to {bench}.")
                warned = True
            rows = []
            for p in holders:
                if not p:
                    rows.append({"p": None})
                    continue
                row = player_line(p, n, resolver.players.get(p, {}), games_of(p), overrides)
                if p == bench:
                    row["b"] = 1
                rows.append(row)
            starters_out = sum(1 for r in rows if r.get("p") and not r.get("b") and r.get("st") == "dnp")
            for r in rows:
                raw = r.pop("raw", None)
                if raw is None:
                    r["s"] = None
                elif not r.get("b"):
                    r["s"] = raw
                elif starters_out:
                    r["s"], r["sub"] = raw, 1  # bench player fills in for a starter who sat
                else:
                    r["s"], r["x"] = None, raw  # bench stats shown, not counted
            games.append(rows)
        seen = {r["p"] for g in games for r in g if r.get("s") or r.get("x")}
        for p in {p for tl in timeline for _, p in tl if p}:
            if p not in seen and games_of(p):
                print(f"  WARNING: {p} ({resolver.players.get(p, {}).get('school')}) hasn't shown up in any box score yet. "
                      f"Check the spelling / school.")
        out_teams[mgr] = {"draft": [p or "" for p in draft], "pickups": resolved_pickups,
                          "bench": bench_plan, "games": games}

    managers = cfg.get("managers") or list(cfg["teams"])
    return {
        "year": cfg["season"], "label": season_label(cfg["season"]), "kind": "season",
        "status": cfg.get("status", "live"), "managers": managers, "slots": slots,
        "draftOrder": cfg.get("draftOrder"), "pickupDates": cfg.get("pickupDates", []),
        "notes": cfg.get("notes", []), "lastUpdate": now_et(), "teams": out_teams,
        "players": player_map(resolver),
    }


def compute_mm(cfg, fetcher, resolver):
    overrides = {(norm_name(o["player"]), int(o["game"])): o for o in cfg.get("overrides", [])}
    teams = {}
    for mgr, t in cfg["teams"].items():
        draft = [p for p in t["draft"] if p]
        for p in draft:
            resolver.resolve(p, (cfg.get("players", {}).get(p) or {}).get("school"))
        games = []
        for n in range(1, MM_SLOTS + 1):
            rows = []
            for p in draft:
                info = resolver.players.get(p, {})
                r = player_line(p, n, info, fetcher.games(info.get("school"), "ncaa"), overrides)
                r["s"] = r.pop("raw", None)
                if r.get("st") == "pending":
                    r.pop("st")
                rows.append(r)
            games.append(rows)
        teams[mgr] = {"draft": draft, "games": games}
    return {
        "year": cfg["season"], "label": f"{cfg['season']} March Madness", "kind": "mm",
        "status": cfg.get("status", "live"), "managers": cfg.get("managers") or list(cfg["teams"]),
        "slots": MM_SLOTS, "lastUpdate": now_et(), "teams": teams, "players": player_map(resolver),
    }


def player_map(resolver):
    """name -> school / ESPN athlete id / ESPN team id, for the site's live layer."""
    teams = sources.espn_teams()
    return {name: {"school": i.get("school"), "id": i.get("id"),
                   "teamId": str(teams[i["school"]]) if i.get("school") in teams else None}
            for name, i in sorted(resolver.players.items())}


def write_schedule(season, data):
    """data/schedule/<year>.json: every rostered school's full schedule, so the
    site can show who plays today, tip times and next games."""
    schools = sorted({i["school"] for i in data.get("players", {}).values() if i.get("school")})
    out = {}
    for school in schools:
        try:
            out[school] = {"teamId": str(sources.espn_teams()[school]), "games": sources.espn_schedule(school, season)}
        except Exception as e:  # schedule is a nice-to-have; never block the stats update
            print(f"  WARNING: no schedule for {school}: {e}")
    path = os.path.join(ROOT, "data", "schedule", f"{season}.json")
    if out != read_json(path):
        write_json(path, out)


def update(season=None, source="auto"):
    season = season or latest_season()
    source = sources.pick_source(source)
    fetcher = Fetcher(season, source)
    for suffix, kind, compute in (("", "seasons", compute_season), ("-mm", "mm", compute_mm)):
        path = os.path.join(ROOT, "league", f"{season}{suffix}.json")
        cfg = read_json(path)
        if not cfg:
            continue
        print(f"{season}{suffix}:")
        resolver = Resolver(cfg)
        data = compute(cfg, fetcher, resolver)
        out = os.path.join(ROOT, "data", kind, f"{season}.json")
        old = read_json(out) or {}
        if {k: v for k, v in old.items() if k != "lastUpdate"} == {k: v for k, v in data.items() if k != "lastUpdate"}:
            data["lastUpdate"] = old.get("lastUpdate")  # nothing new -- don't touch the file
        write_json(out, data)
        if resolver.changed:
            write_json(path, cfg, pretty=True)
        if kind == "seasons":
            print("  schedules...")
            write_schedule(season, data)
    build()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int)
    ap.add_argument("--source", choices=["auto", "cbbd", "espn"], default="auto")
    a = ap.parse_args()
    update(a.season, a.source)


if __name__ == "__main__":
    main()
