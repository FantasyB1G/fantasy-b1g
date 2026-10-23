"""
league.py -- day-to-day league management. Edits league/<year>.json for you
(you can also just edit that file by hand), then `update` pulls stats.

  python tools/league.py show
  python tools/league.py draft Waldo 3 "Braden Smith" [--school Purdue]
  python tools/league.py bench Michael "Cade Tyson" --from-game 1
  python tools/league.py pickup Brett --add "John Doe" --drop "Joe Smith" [--date 2026-12-15] [--from-game 12] [--school Iowa]
  python tools/league.py school "Cade Tyson" Minnesota
  python tools/league.py override "Joe Smith" 10 --stats 12 5 3 1 0 [--opp "vs Iowa"]
  python tools/league.py override "Joe Smith" 10 --dnp      (or --clear)
  python tools/league.py mm-draft Falan 2 "Cooper Flagg" --school Duke
  python tools/league.py update [--source cbbd|espn]
  python tools/league.py finish            (mark the season final)
  python tools/league.py new-season 2028   (start next season's config)

Managers can be given by first or last name (Waldo/Vasquez, Michael/Titus,
Brett/Gold, Falan/Garner). --season defaults to the newest league/<year>.json.
"""
import argparse
import os
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import LAST_TO_FIRST, MANAGERS, ROOT, norm_name, read_json, write_json  # noqa: E402
from update import latest_season, update  # noqa: E402


def cfg_path(season, mm=False):
    return os.path.join(ROOT, "league", f"{season}{'-mm' if mm else ''}.json")


def load(season, mm=False):
    path = cfg_path(season, mm)
    cfg = read_json(path)
    if cfg is None:
        if not mm:
            raise SystemExit(f"{path} doesn't exist (try new-season)")
        reg = read_json(cfg_path(season)) or {}
        cfg = {"season": season, "managers": reg.get("managers", MANAGERS),
               "teams": {m: {"draft": [""] * 7} for m in MANAGERS}, "players": {}, "overrides": []}
    return cfg


def save(cfg, mm=False):
    write_json(cfg_path(cfg["season"], mm), cfg, pretty=True)
    print("saved", os.path.relpath(cfg_path(cfg["season"], mm), ROOT))


def manager(name):
    for m in MANAGERS:
        if m.lower() == name.lower():
            return m
    for last, first in LAST_TO_FIRST.items():
        if last.lower() == name.lower():
            return first
    raise SystemExit(f"unknown manager '{name}' (use one of {', '.join(MANAGERS)})")


def roster_names(team):
    names = [p for p in team["draft"] if p]
    for pk in team.get("pickups", []):
        names.append(pk["add"])
    return names


def find_player(team, name):
    for p in roster_names(team):
        if norm_name(p) == norm_name(name):
            return p
    raise SystemExit(f"'{name}' isn't on this roster: {', '.join(roster_names(team))}")


def set_school(cfg, name, school):
    if school:
        cfg.setdefault("players", {})[name] = {"school": school, "id": None}


def cmd_show(a):
    cfg = load(a.season)
    print(f"{cfg['season']} season  (draft order {cfg.get('draftOrder') or '?'}, pickups {', '.join(cfg.get('pickupDates', []))})")
    for m, t in cfg["teams"].items():
        print(f"\n{m}")
        for i, p in enumerate(t["draft"], start=1):
            school = (cfg.get("players", {}).get(p) or {}).get("school") if p else None
            print(f"  R{i}  {p or '--'}" + (f"  ({school})" if school else ""))
        for pk in t.get("pickups", []):
            print(f"  pickup {pk.get('date', '')}: +{pk['add']}  -{pk['drop']}" + (f"  from game {pk['fromGame']}" if pk.get("fromGame") else ""))
        for b in t.get("bench", []):
            print(f"  bench from game {b['fromGame']}: {b['player']}")
    if cfg.get("overrides"):
        print("\noverrides:")
        for o in cfg["overrides"]:
            print("  ", o)


def cmd_draft(a, mm=False):
    cfg = load(a.season, mm)
    m = manager(a.manager)
    team = cfg["teams"][m]
    while len(team["draft"]) < a.round:
        team["draft"].append("")
    team["draft"][a.round - 1] = a.player
    set_school(cfg, a.player, a.school)
    save(cfg, mm)


def cmd_bench(a):
    cfg = load(a.season)
    team = cfg["teams"][manager(a.manager)]
    player = find_player(team, a.player)
    bench = [b for b in team.setdefault("bench", []) if int(b["fromGame"]) != a.from_game]
    bench.append({"fromGame": a.from_game, "player": player})
    team["bench"] = sorted(bench, key=lambda b: int(b["fromGame"]))
    save(cfg)


def cmd_pickup(a):
    cfg = load(a.season)
    team = cfg["teams"][manager(a.manager)]
    drop = find_player(team, a.drop)
    pk = {"date": a.date or date.today().isoformat(), "add": a.add, "drop": drop}
    if a.from_game:
        pk["fromGame"] = a.from_game
    team.setdefault("pickups", []).append(pk)
    set_school(cfg, a.add, a.school)
    save(cfg)


def cmd_school(a):
    cfg = load(a.season)
    set_school(cfg, a.player, a.school)
    save(cfg)


def cmd_override(a):
    cfg = load(a.season)
    ovs = [o for o in cfg.setdefault("overrides", [])
           if not (norm_name(o["player"]) == norm_name(a.player) and int(o["game"]) == a.game)]
    if not a.clear:
        o = {"player": a.player, "game": a.game}
        if a.dnp:
            o["dnp"] = True
        elif a.stats:
            o["stats"] = a.stats
        else:
            raise SystemExit("give --stats PTS REB AST STL BLK, --dnp, or --clear")
        if a.opp:
            o["opp"] = a.opp
        ovs.append(o)
    cfg["overrides"] = ovs
    save(cfg)


def cmd_finish(a):
    for mm in (False, True):
        cfg = read_json(cfg_path(a.season, mm))
        if cfg:
            cfg["status"] = "final"
            save(cfg, mm)
    update(a.season, a.source)


def cmd_new_season(a):
    path = cfg_path(a.year)
    if os.path.exists(path):
        raise SystemExit(f"{path} already exists")
    prev = read_json(cfg_path(a.year - 1)) or {}
    cfg = {
        "season": a.year, "slots": 31, "draftOrder": None,
        "pickupDates": [f"{a.year - 1}-12-15", f"{a.year}-01-15", f"{a.year}-02-15"],
        "teams": {m: {"draft": [""] * 7, "bench": [], "pickups": []} for m in prev.get("teams", MANAGERS)},
        "players": {}, "overrides": [],
    }
    save(cfg)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, help="defaults to the newest league/<year>.json")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("show")
    for name in ("draft", "mm-draft"):
        p = sub.add_parser(name)
        p.add_argument("manager")
        p.add_argument("round", type=int)
        p.add_argument("player")
        p.add_argument("--school", required=(name == "mm-draft"))
    p = sub.add_parser("bench")
    p.add_argument("manager")
    p.add_argument("player")
    p.add_argument("--from-game", type=int, required=True)
    p = sub.add_parser("pickup")
    p.add_argument("manager")
    p.add_argument("--add", required=True)
    p.add_argument("--drop", required=True)
    p.add_argument("--date", help="YYYY-MM-DD, defaults to today")
    p.add_argument("--from-game", type=int, help="override the computed first game #")
    p.add_argument("--school")
    p = sub.add_parser("school")
    p.add_argument("player")
    p.add_argument("school")
    p = sub.add_parser("override")
    p.add_argument("player")
    p.add_argument("game", type=int)
    p.add_argument("--stats", type=int, nargs=5, metavar=("PTS", "REB", "AST", "STL", "BLK"))
    p.add_argument("--opp")
    p.add_argument("--dnp", action="store_true")
    p.add_argument("--clear", action="store_true")
    for name in ("update", "finish"):
        p = sub.add_parser(name)
        p.add_argument("--source", choices=["auto", "cbbd", "espn"], default="auto")
    p = sub.add_parser("new-season")
    p.add_argument("year", type=int)

    a = ap.parse_args()
    if a.cmd != "new-season":
        a.season = a.season or latest_season()
    {
        "show": cmd_show, "draft": cmd_draft, "mm-draft": lambda x: cmd_draft(x, mm=True),
        "bench": cmd_bench, "pickup": cmd_pickup, "school": cmd_school, "override": cmd_override,
        "update": lambda x: update(x.season, x.source), "finish": cmd_finish, "new-season": cmd_new_season,
    }[a.cmd](a)


if __name__ == "__main__":
    main()
