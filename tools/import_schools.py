"""
import_schools.py
=================
One-time import: which school each rostered player was at in each past
season (so transfers credit the right school on the Teams pages). Seasons
the site runs live already record this via update.py.

    python tools/import_schools.py          # 1 CBBD call per season

Writes data/season_schools.json: {"<year>": {"<player as rostered>": "<school>"}}.
Order of evidence: CBBD's roster for that season; failing that, teammates
(players on the same school share the same opponents); failing that, the
school from the old Player Index.
"""
import collections
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources  # noqa: E402
from common import ROOT, player_key, read_json, write_json  # noqa: E402

YEARS = range(2016, 2027)


def cbbd(path, **q):
    key = sources.cbbd_key()
    if not key:
        raise SystemExit("CBBD_API_KEY not set (env var or .env at the repo root)")
    return sources._get(f"{sources.CBBD}{path}?{urllib.parse.urlencode(q)}", headers={"Authorization": f"Bearer {key}"})


def main():
    extras = read_json(os.path.join(ROOT, "data", "extras.json"), {})
    index_school = {player_key(k): v for k, v in extras.get("schools", {}).items()}
    out, how = {}, collections.Counter()
    for year in YEARS:
        season = read_json(os.path.join(ROOT, "data", "seasons", f"{year}.json"))
        rosters = collections.defaultdict(list)  # player key -> [(school, conference)]
        for t in cbbd("/teams/roster", season=year):
            for p in t.get("players", []):
                rosters[player_key(p["name"])].append((t["team"], t.get("conference")))

        # teammates share an opponent sequence: group player-seasons by their first 6 opponents
        opps = {}
        for team in season["teams"].values():
            for gi, g in enumerate(team["games"]):
                for r in g:
                    if r.get("p") and r.get("o") and not r.get("fill"):
                        opps.setdefault(r["p"], {})[gi] = r["o"].replace("vs ", "").replace("@ ", "").strip()
        groups = collections.defaultdict(list)
        for name, o in opps.items():
            sig = tuple(o.get(i) for i in range(6))
            if None not in sig:
                groups[sig].append(name)

        schools = {}
        for name in sorted(opps):
            cands = rosters.get(player_key(name), [])
            b1g = [s for s, conf in cands if conf == "Big Ten"]
            if len(b1g) == 1 or (len(cands) == 1 and not b1g):
                schools[name] = b1g[0] if b1g else cands[0][0]
                how["cbbd"] += 1
        for name in sorted(opps):
            if name in schools:
                continue
            sig = tuple(opps[name].get(i) for i in range(6))
            mates = collections.Counter(schools[m] for m in groups.get(sig, []) if m in schools)
            if mates:
                schools[name] = mates.most_common(1)[0][0]
                how["teammates"] += 1
            elif index_school.get(player_key(name)):
                schools[name] = index_school[player_key(name)]
                how["player index"] += 1
            else:
                how["unknown"] += 1
                print(f"  {year}: no school found for {name}")
        out[str(year)] = schools
        print(f"{year}: {len(schools)} players")
    write_json(os.path.join(ROOT, "data", "season_schools.json"), out, pretty=True)
    print("sources:", dict(how))

    # report Big Ten-to-Big Ten (and other) transfers among rostered players
    by_player = collections.defaultdict(dict)
    for y, m in out.items():
        for name, s in m.items():
            by_player[player_key(name)][int(y)] = (name, s)
    moved = [(k, v) for k, v in by_player.items() if len({s for _, s in v.values()}) > 1]
    print(f"\n{len(moved)} rostered players changed schools between fantasy seasons:")
    for k, v in sorted(moved, key=lambda kv: min(kv[1])):
        print("  " + list(v.values())[0][0] + ": " + ", ".join(f"{y - 1}-{str(y)[2:]} {s}" for y, (_, s) in sorted(v.items())))


if __name__ == "__main__":
    main()
