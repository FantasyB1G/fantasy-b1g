# Fantasy B1G (instructions for Claude)

Static GitHub Pages site for a 4-person fantasy Big Ten basketball league:
https://fantasyb1g.github.io/fantasy-b1g/ . See README.md for the full tour.

## The league
- Managers (always use first names): Waldo (Vasquez), Michael (Titus, the owner of
  this repo), Brett (Gold), Falan (Garner).
- Season files are named by the spring year: 2027 = the 2026-27 season.
- 7 players per team. Score = PTS + REB + AST + STL + BLK.
- A player's game # is his school's game # (conference tournament included, NCAA
  tournament excluded), 31 game slots.
- 6 starters count. The owner picks 1 bench player by game # (`bench` in the config).
  The bench player's game N counts only if a starter doesn't play his game N.
- Pickups (usually 12/15, 1/15, 2/15): count each player's games through the pickup
  date (that day included). The new player counts from the next game # after the
  larger count, and the dropped player fills every game # before that.
- March Madness is a separate 7-player draft of NCAA tournament players; every game counts.

## Making league changes (the usual request)
Edit `league/<year>.json` with the CLI, never by hand-editing `data/`:

```bash
python tools/league.py show
python tools/league.py draft Waldo 3 "Player Name"          # --school X if not a current Big Ten player
python tools/league.py bench Michael "Player Name" --from-game 12
python tools/league.py pickup Brett --add "New Guy" --drop "Old Guy" --date 2026-12-15 [--school Iowa]
python tools/league.py override "Player Name" 10 --stats 12 5 3 1 0   # or --dnp / --clear
python tools/league.py mm-draft Falan 1 "Player Name" --school Duke
```

Then commit `league/` and push to `main`. **Pushing a change under `league/` to
`main` triggers the "Update stats" GitHub Action**, which fetches box scores (it has
the CBBD key as a secret), rebuilds `data/`, commits, and the site redeploys a few
minutes later. You don't need to run `tools/update.py` yourself, and in a cloud
session it may not have network access or the API key anyway.

- Player names should match ESPN spelling (e.g. "Jeremy Fears Jr", "Roddy Gayle Jr.").
- `league.py` errors if a bench/drop player isn't on that roster. Read the message
  and fix the name; don't bypass it.
- Before pushing, run `python tools/league.py show` and summarize the change for the
  user.

## Don't
- Don't edit `data/` by hand. It's generated (`tools/update.py`, `tools/build.py`).
  Exceptions: Hall of Fame entries live in `data/extras.json` under `hof`. Rebuild
  with `python tools/build.py` after editing it.
- Don't commit `.env` or the spreadsheet (both git-ignored).
- Don't re-run `tools/import_xlsx.py` or `tools/import_schools.py`. They were
  one-time imports of history.
- `data/demo/` and `tools/make_demo.py` are a preview mock. Never commit `data/demo/`.

## Code
- Site: `index.html`, `assets/app.js` (vanilla JS, no build step), `assets/style.css`.
  Hash routes like `#/season/2026`, `#/team/Purdue`, `#/player/<key>`.
- Live scores come from ESPN's public API in the browser (`applyLive` in app.js).
  Official numbers come from `data/seasons/<year>.json`.
- Tools: `tools/league.py` (CLI), `tools/update.py` (stats + rules),
  `tools/build.py` (index.json), `tools/sources.py` (CBBD/ESPN), `tools/admin.py`
  (local-only admin app).
