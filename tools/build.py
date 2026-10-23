"""
build.py
========
Reads every data/seasons/*.json and data/mm/*.json file and writes
data/index.json: standings, champions, all-time totals, records, the player
index and Hall of Fame info. The website reads index.json plus the per-season
files directly, so run this after any data change (update.py runs it for you).

    python tools/build.py
"""
import glob
import os
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ALIASES, MANAGERS, ROOT, STATS, player_key, read_json, write_json  # noqa: E402

TOP_N = 10
HOF_MIN_GP, HOF_MIN_TOTAL = 20, 500


def load_all(kind):
    out = {}
    for f in sorted(glob.glob(os.path.join(ROOT, "data", kind, "*.json"))):
        d = read_json(f)
        out[d["year"]] = d
    return out


def team_summary(team, slots):
    """Totals for one team's season (or tournament)."""
    tot = [0] * 5
    gp = 0
    by_slot = []
    for g in team["games"]:
        st = [0] * 5
        played = False
        for r in g:
            if r.get("s"):
                st = [a + b for a, b in zip(st, r["s"])]
                gp += 1
                played = True
        tot = [a + b for a, b in zip(tot, st)]
        by_slot.append({"s": st, "t": sum(st), "done": played})
    score = sum(tot)
    return {"stats": tot, "score": score, "gp": gp, "avg": round(score / gp, 2) if gp else 0, "bySlot": by_slot}


def standings(season):
    rows = []
    for m in season["managers"]:
        t = season["teams"].get(m)
        if not t:
            continue
        s = team_summary(t, season["slots"])
        rows.append({"m": m, **{k: v for k, v in s.items() if k != "bySlot"}})
    rows.sort(key=lambda r: -r["score"])
    for i, r in enumerate(rows):
        r["place"] = i + 1
    return rows


def top(items, key, n=TOP_N):
    return sorted(items, key=lambda x: -x[key])[:n]


def build():
    seasons = load_all("seasons")
    mms = load_all("mm")
    extras = read_json(os.path.join(ROOT, "data", "extras.json"), {})
    schools_raw = extras.get("schools", {})
    schools = {player_key(k): v for k, v in schools_raw.items()}
    for cfg in glob.glob(os.path.join(ROOT, "league", "*.json")):
        for name, info in (read_json(cfg).get("players") or {}).items():
            if info.get("school"):
                schools.setdefault(player_key(name), info["school"])
    # school per season, so transfers credit the right school: past seasons from
    # data/season_schools.json (tools/import_schools.py), live seasons from the
    # school update.py looked up for each player
    past_schools = read_json(os.path.join(ROOT, "data", "season_schools.json"), {})

    def season_school(year, season, name):
        info = (season.get("players") or {}).get(name) or {}
        return past_schools.get(str(year), {}).get(name) or info.get("school") or schools.get(player_key(name))

    season_list, champions = [], {}
    team_seasons, team_weeks, player_seasons, player_games = [], [], [], []
    players = {}

    def player(name):
        k = player_key(name)
        p = players.get(k)
        if not p:
            p = players[k] = {"key": k, "spellings": Counter(), "seasons": {}, "mm": {}}
        p["spellings"][name] += 1
        return p

    latest_year = max(seasons) if seasons else None
    for year, s in sorted(seasons.items()):
        st = standings(s)
        final = s.get("status") == "final"
        if final and st:
            champions[year] = st[0]["m"]
        season_list.append({
            "year": year, "label": s["label"], "status": s.get("status"), "slots": s["slots"],
            "lastUpdate": s.get("lastUpdate"), "draftOrder": s.get("draftOrder"),
            "standings": st,
            "champion": st[0]["m"] if final and st else None,
        })
        for m, t in s["teams"].items():
            summ = team_summary(t, s["slots"])
            if summ["gp"]:
                team_seasons.append({"m": m, "year": year, "t": summ["score"], **dict(zip(STATS, summ["stats"])), "live": not final})
            for i, w in enumerate(summ["bySlot"], start=1):
                if w["done"]:
                    team_weeks.append({"m": m, "year": year, "game": i, "t": w["t"], **dict(zip(STATS, w["s"])), "live": not final})
            # player season lines
            lines = {}
            for gi, g in enumerate(t["games"], start=1):
                for r in g:
                    if not r.get("p"):
                        continue
                    p = player(r["p"])
                    ln = lines.setdefault(p["key"], {"gp": 0, "s": [0] * 5, "zero": 0, "name": r["p"]})
                    if r.get("s"):
                        ln["gp"] += 1
                        ln["s"] = [a + b for a, b in zip(ln["s"], r["s"])]
                        if sum(r["s"]) == 0:
                            ln["zero"] += 1
                        player_games.append({"p": r["p"], "key": p["key"], "m": m, "year": year, "game": gi,
                                             "o": r.get("o"), "t": sum(r["s"]), "s": r["s"]})
            for k, ln in lines.items():
                players[k]["seasons"].setdefault(year, []).append(
                    {"m": m, "gp": ln["gp"], "s": ln["s"], "t": sum(ln["s"]), "zero": ln["zero"],
                     "school": season_school(year, s, ln["name"])})
                if ln["gp"]:
                    player_seasons.append({"p": ln["name"], "key": k, "m": m, "year": year, "gp": ln["gp"],
                                           "t": sum(ln["s"]), **dict(zip(STATS, ln["s"])),
                                           "avg": round(sum(ln["s"]) / ln["gp"], 2), "live": not final})

    mm_list, mm_team, mm_player = [], [], []
    for year, s in sorted(mms.items()):
        st = standings(s) if s.get("status") != "cancelled" else []
        final = s.get("status") == "final"
        mm_list.append({"year": year, "status": s.get("status"), "note": s.get("note"), "standings": st,
                        "champion": st[0]["m"] if final and st else None})
        for r in st:
            mm_team.append({"m": r["m"], "year": year, "t": r["score"], **dict(zip(STATS, r["stats"]))})
        for m, t in s["teams"].items():
            lines = {}
            for g in t["games"]:
                for r in g:
                    if not r.get("p"):
                        continue
                    p = player(r["p"])
                    ln = lines.setdefault(p["key"], {"gp": 0, "s": [0] * 5, "name": r["p"]})
                    if r.get("s"):
                        ln["gp"] += 1
                        ln["s"] = [a + b for a, b in zip(ln["s"], r["s"])]
            for k, ln in lines.items():
                players[k]["mm"][year] = {"m": m, "gp": ln["gp"], "s": ln["s"], "t": sum(ln["s"])}
                if ln["gp"]:
                    mm_player.append({"p": ln["name"], "key": k, "m": m, "year": year, "gp": ln["gp"],
                                      "t": sum(ln["s"]), **dict(zip(STATS, ln["s"]))})

    # Hall of Fame status
    hof = extras.get("hof", {})
    hof_keys = {player_key(h["player"]): h for h in hof.get("members", [])}
    ballot_years = sorted(hof.get("ballots", {}))
    on_ballot = {player_key(b["player"]) for b in hof.get("ballots", {}).get(ballot_years[-1], [])} if ballot_years else set()

    index = []
    for k, p in players.items():
        reg = p["seasons"]
        if not reg:
            # March Madness only: no regular-season career, but still gets a page
            mm = [dict(year=y, **v) for y, v in sorted(p["mm"].items())]
            index.append({"key": k, "name": p["spellings"].most_common(1)[0][0], "school": schools.get(k), "schools": [],
                          "years": [], "owner": mm[-1]["m"], "owners": sorted({x["m"] for x in mm}), "rings": 0,
                          "gp": 0, "s": [0] * 5, "t": 0, "avg": 0, "zero": 0, "status": "mmOnly",
                          "seasons": [], "mm": mm})
            continue
        name = p["spellings"].most_common(1)[0][0]
        gp = sum(l["gp"] for ls in reg.values() for l in ls)
        tot = [sum(l["s"][i] for ls in reg.values() for l in ls) for i in range(5)]
        owners = Counter()
        for ls in reg.values():
            for l in ls:
                owners[l["m"]] += l["gp"] or 1
        years = sorted(reg)
        rings = sum(1 for y, ls in reg.items() if any(l["m"] == champions.get(y) and l["gp"] for l in ls))
        total = sum(tot)
        if k in hof_keys:
            status = "hof"
        elif latest_year in reg:
            status = "active"
        elif k in on_ballot:
            status = "ballot"
        elif gp > HOF_MIN_GP and total > HOF_MIN_TOTAL:
            status = "eligible"
        else:
            status = "ineligible"
        index.append({
            "key": k, "name": name, "years": years,
            # latest school, plus every school he played for (in order)
            "school": next((l["school"] for y in reversed(years) for l in reg[y] if l.get("school")), schools.get(k)),
            "schools": list(dict.fromkeys(l["school"] for y in years for l in reg[y] if l.get("school"))),
            "owner": owners.most_common(1)[0][0], "owners": sorted(owners), "rings": rings,
            "gp": gp, "s": tot, "t": total, "avg": round(total / gp, 2) if gp else 0,
            "zero": sum(l["zero"] for ls in reg.values() for l in ls), "status": status,
            "seasons": [dict(year=y, **l) for y in years for l in reg[y]],
            "mm": [dict(year=y, **v) for y, v in sorted(p["mm"].items())],
        })
    index.sort(key=lambda r: -r["t"])

    # all-time totals / placements (completed seasons only)
    alltime = {m: {"m": m, "s": [0] * 5, "t": 0, "places": [0, 0, 0, 0], "titles": [], "mmTitles": [],
                   "mmPlaces": [0, 0, 0, 0], "seasons": 0, "gp": 0} for m in MANAGERS}
    for s in season_list:
        if s["status"] != "final":
            continue
        for r in s["standings"]:
            a = alltime[r["m"]]
            a["s"] = [x + y for x, y in zip(a["s"], r["stats"])]
            a["t"] += r["score"]
            a["gp"] += r["gp"]
            a["places"][r["place"] - 1] += 1
            a["seasons"] += 1
            if r["place"] == 1:
                a["titles"].append(s["year"])
    for s in mm_list:
        if s["status"] != "final":
            continue
        for r in s["standings"]:
            alltime[r["m"]]["mmPlaces"][r["place"] - 1] += 1
            if r["place"] == 1:
                alltime[r["m"]]["mmTitles"].append(s["year"])

    def cat_tops(items, extra=()):
        out = {"t": top(items, "t")}
        for k in STATS + list(extra):
            out[k] = top(items, k)
        return out

    records = {
        "teamSeason": cat_tops(team_seasons),
        "teamGame": cat_tops(team_weeks),
        "playerSeason": cat_tops(player_seasons),
        "playerGame": sorted(player_games, key=lambda x: -x["t"])[:25],
        "playerAvg": top([p for p in player_seasons if p["gp"] >= 5], "avg"),
        "mmTeam": top(mm_team, "t"),
        "mmPlayer": top(mm_player, "t"),
        "careerTotal": [{"key": p["key"], "name": p["name"], "owner": p["owner"], "t": p["t"], "gp": p["gp"]}
                        for p in index[:TOP_N]],
    }
    for i, k in enumerate(STATS):
        records["career_" + k] = [{"key": p["key"], "name": p["name"], "owner": p["owner"], "t": p["s"][i], "gp": p["gp"]}
                                  for p in sorted(index, key=lambda p: -p["s"][i])[:TOP_N]]
    # player season leaders for each year (top averages, min 5 games)
    season_leaders = defaultdict(list)
    for p in player_seasons:
        if p["gp"] >= 5:
            season_leaders[p["year"]].append(p)
    for s in season_list:
        s["topAvg"] = top(season_leaders.get(s["year"], []), "avg")
        s["topTotal"] = top([p for p in player_seasons if p["year"] == s["year"]], "t")

    out = {
        "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "managers": MANAGERS,
        "aliases": ALIASES,
        "seasons": season_list,
        "mm": mm_list,
        "alltime": list(alltime.values()),
        "records": records,
        "players": index,
        "hof": hof,
    }
    path = os.path.join(ROOT, "data", "index.json")
    prev = read_json(path) or {}
    if {k: v for k, v in prev.items() if k != "built"} == {k: v for k, v in out.items() if k != "built"}:
        out["built"] = prev["built"]  # unchanged: keep the old stamp so git sees no diff
    write_json(path, out)
    print(f"index.json: {len(season_list)} seasons, {len(mm_list)} tournaments, "
          f"{sum(1 for p in index if p['status'] != 'mmOnly')} players (+{sum(1 for p in index if p['status'] == 'mmOnly')} March Madness only)")


if __name__ == "__main__":
    build()
