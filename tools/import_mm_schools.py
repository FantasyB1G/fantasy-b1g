"""
import_mm_schools.py
====================
One-time import: the school of every past March Madness pick, from CBBD's
season rosters (narrowed to that year's NCAA tournament teams). The site uses
it for the School column and logos of tournament-only players. New March
Madness drafts record schools themselves (league.py mm-draft --school).

    python tools/import_mm_schools.py      # ~2 CBBD calls per tournament year

Writes data/mm_schools.json: {"<year>": {"<player as drafted>": "<school>"}}.
"""
import collections
import difflib
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources  # noqa: E402
from common import ROOT, norm_name, player_key, read_json, write_json  # noqa: E402


def cbbd(path, **q):
    key = sources.cbbd_key()
    if not key:
        raise SystemExit("CBBD_API_KEY not set (env var or .env at the repo root)")
    return sources._get(f"{sources.CBBD}{path}?{urllib.parse.urlencode(q)}", headers={"Authorization": f"Bearer {key}"})


def main():
    out, misses = {}, []
    for y in range(2016, 2027):
        mm = read_json(os.path.join(ROOT, "data", "mm", f"{y}.json"))
        if not mm or mm.get("status") == "cancelled":
            continue
        names = sorted({r["p"] for t in mm["teams"].values() for g in t["games"] for r in g if r.get("p")} |
                       {p for t in mm["teams"].values() for p in t.get("draft", []) if p})
        games = cbbd("/games", season=y, seasonType="postseason", tournament="NCAA")
        ncaa = {g[k] for g in games for k in ("homeTeam", "awayTeam") if g.get(k)}
        by_name = collections.defaultdict(set)   # player key -> schools
        ncaa_players = {}                         # player key -> school (tournament teams only)
        for t in cbbd("/teams/roster", season=y):
            for p in t.get("players", []):
                k = player_key(p["name"])
                by_name[k].add(t["team"])
                if t["team"] in ncaa:
                    ncaa_players[k] = t["team"]
        # each tournament team's opponents, to break ties between same-named players
        opps = collections.defaultdict(set)
        for g in games:
            if g.get("homeTeam") and g.get("awayTeam"):
                opps[g["homeTeam"]].add(norm_name(g["awayTeam"]))
                opps[g["awayTeam"]].add(norm_name(g["homeTeam"]))
        played = collections.defaultdict(set)  # drafted name -> opponents in our data
        for t in mm["teams"].values():
            for g in t["games"]:
                for r in g:
                    if r.get("p") and r.get("o"):
                        played[r["p"]].add(norm_name(r["o"].replace("vs ", "").replace("@ ", "")))
        schools = {}
        for n in names:
            k = player_key(n)
            cands = by_name.get(k, set())
            in_ncaa = [s for s in cands if s in ncaa]
            if len(in_ncaa) > 1 and played.get(n):
                best = max(in_ncaa, key=lambda s: len(opps[s] & played[n]))
                if len(opps[best] & played[n]):
                    in_ncaa = [best]
            if len(in_ncaa) == 1:
                schools[n] = in_ncaa[0]
            elif len(cands) == 1:
                schools[n] = next(iter(cands))
            else:
                # sheet typos ("Chet Holgrem"): closest name among tournament players
                close = difflib.get_close_matches(k, list(ncaa_players), n=1, cutoff=0.85)
                if close:
                    schools[n] = ncaa_players[close[0]]
                    print(f"  {y}: '{n}' matched to '{close[0]}' ({schools[n]})")
                else:
                    misses.append((y, n, sorted(cands)))
        out[str(y)] = schools
        print(f"{y}: {len(schools)}/{len(names)} players, {len(ncaa)} tournament teams")
    write_json(os.path.join(ROOT, "data", "mm_schools.json"), out, pretty=True)
    for y, n, c in misses:
        print(f"  NOT FOUND {y}: {n} {c or ''}")


if __name__ == "__main__":
    main()
