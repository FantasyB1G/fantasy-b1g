# Fantasy B1G

Static website for our fantasy Big Ten basketball league: live standings,
game-by-game box scores, every season since 2015-16, March Madness, records,
the player index and the Hall of Fame. It runs on GitHub Pages with no
server, database or build step. The site is plain HTML/JS that reads the
JSON files in `data/`.

## How it works

```
league/2027.json      <- you edit this: draft, bench, pickups (or use tools/league.py)
league/2027-mm.json   <- March Madness draft (created by `mm-draft`)
        |
        |  python tools/update.py   (fetches box scores, applies the rules)
        v
data/seasons/*.json   data/mm/*.json   data/index.json   <- the site reads these
```

Historical seasons (2016-2026) were imported once from the old Google Sheet
with `tools/import_xlsx.py` and don't change.

## Admin app (point and click)

```bash
python tools/admin.py
```

This opens a local admin page at http://127.0.0.1:8770/admin with tabs for:
- **Draft:** autocomplete from Big Ten rosters, plus the March Madness draft
- **Bench:** each team's next game #, one click to set the bench
- **Pickups:** add/drop with a date
- **Stat fixes:** manual overrides
- **Hall of Fame:** members, ballots, "start next year's ballot", induct

Every change saves to the same files as the commands below. The **Update
stats** and **Publish** buttons replace `update` and `git commit/push`. It runs
only on your computer; press Ctrl+C in the terminal to stop it.

## Season workflow

```bash
# draft / keepers (round 1-7)
python tools/league.py draft Waldo 3 "Braden Smith"
python tools/league.py show

# pick the bench player (by game #; change it any time)
python tools/league.py bench Michael "Cade Tyson" --from-game 1
python tools/league.py bench Michael "David Mirkovic" --from-game 12

# pickups (date defaults to today)
python tools/league.py pickup Brett --add "Kwame Evans" --drop "Nolan Winter" --date 2026-12-15

# pull stats + rebuild, then publish
python tools/league.py update
git add -A && git commit -m "Update stats" && git push
```

Managers can be named by first or last name. Players are matched to their
school automatically from current Big Ten rosters. If a player can't be
found (a transfer, or a name that doesn't match ESPN's spelling), set the
school yourself:

```bash
python tools/league.py school "Joe Smith" Iowa
```

Fixing a stat line by hand (overrides whatever the API says):

```bash
python tools/league.py override "Joe Smith" 10 --stats 12 5 3 1 0
python tools/league.py override "Joe Smith" 10 --dnp
python tools/league.py override "Joe Smith" 10 --clear
```

March Madness: draft with `mm-draft` (school required, since players can be
from anywhere), and `update` picks up NCAA tournament games automatically:

```bash
python tools/league.py mm-draft Falan 1 "Cameron Boozer" --school Duke
```

End of the year: `python tools/league.py finish` marks the season final (so
its champion shows in the history), and `python tools/league.py new-season 2028`
starts next year's config.

## Live scores

On game days the home page shows a live Big Ten scoreboard, who's playing
now and later, and standings that include tonight's provisional points. The
visitor's browser pulls these straight from ESPN's public scoreboard and box
scores, every 30 seconds while games are on and every 5 minutes before tip-off.
No server is needed. The bench rule is applied live as well. Live points are
provisional; the official numbers come from `update` (or the nightly GitHub
Action), which also refreshes each rostered team's schedule in
`data/schedule/<year>.json` for "next game" times.

Why ESPN and not CBBD for live: CBBD's live `/scoreboard` has team scores
only, no player stats, and calling CBBD needs the API key, which can't go
in a public website. To see whether CBBD's player box scores fill in during
games, run `python tools/check_cbbd_live.py` while games are on.

To preview it before the season starts, run `python tools/make_demo.py`, then open the site with `?demo=1`
(e.g. `http://localhost:8000/?demo=1`). That's a mock of opening night (Mon 11/2,
8:15 PM ET). It uses the real schedule,
filler rosters and simulated box scores. Delete `data/demo/` whenever you
want; nothing else depends on it.

## Scoring rules (what update.py applies)

* 7 players per team. A player's game # is his team's game # (conference
  tournament included, NCAA tournament excluded), up to 31 games.
* Score = PTS + REB + AST + STL + BLK.
* 6 starters count. The bench player only counts when a starter doesn't play
  his game N. The bench player's game N fills in, even if it was played before
  the starter's game.
* Pickups: count each player's team games through the pickup date (games that
  day included). The new player counts from the next game # after the larger
  of the two counts. The dropped player fills every game # before that, so
  each game # counts exactly once. Add `"fromGame": N` to a pickup in the
  config to override.
* March Madness: 7 players, every NCAA tournament game counts.

## Stats source

`update` uses the CollegeBasketballData API (one call per team) when
`CBBD_API_KEY` is set, either as an environment variable or as a line in a
`.env` file at the repo root (`.env` is git-ignored). Without a key it falls
back to ESPN's public API (no key, one call per game; finished games are
cached in `.cache/`). Force either one with `--source cbbd` or `--source espn`.

## Publishing on GitHub Pages

1. Create a new repo on GitHub (e.g. `fantasy-b1g`) and push this folder:
   ```bash
   git remote add origin https://github.com/<you>/fantasy-b1g.git
   git push -u origin main
   ```
2. In the repo: **Settings > Pages > Build and deployment > Deploy from a
   branch**, branch `main`, folder `/ (root)`.
3. The site goes live at `https://<you>.github.io/fantasy-b1g/` a minute
   or so after each push.

### Automatic updates

`.github/workflows/update.yml` fetches stats and commits them every morning
(Nov-Apr) and whenever you push a change to `league/` (draft, bench, pickups,
stat fixes). The site stays current even if you publish a lineup change
without clicking Update stats first. Add
your key under **Settings > Secrets and variables > Actions > New repository
secret** as `CBBD_API_KEY`. It also runs from the Actions tab on demand.
If you use it, `git pull` before editing lineups. Delete the file if you'd
rather update by hand.

## Preview locally

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Files

| Path | What |
|---|---|
| `index.html`, `assets/` | the website |
| `league/<year>.json` | current season config: draft, bench, pickups, player schools, overrides |
| `data/seasons/<year>.json` | every player row for every game # of a season |
| `data/mm/<year>.json` | March Madness contests |
| `data/extras.json` | Hall of Fame, ballots, schools (from the sheet) |
| `data/season_schools.json` | each player's school in each past season, so transfers credit the right school (built once by `tools/import_schools.py`; live seasons record it automatically) |
| `data/mm_schools.json` | the school of every past March Madness pick (built once by `tools/import_mm_schools.py`) |
| `assets/logos/` | 64px school logos. After a March Madness draft adds new schools, run `python tools/copy_logos.py <folder of School.png logos>`; a missing logo just doesn't show |
| `data/index.json` | generated by `tools/build.py`: standings, records, player index |
| `tools/` | `league.py` (CLI), `update.py`, `build.py`, `sources.py`, `import_xlsx.py` |
