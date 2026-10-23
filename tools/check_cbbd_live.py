"""
check_cbbd_live.py
==================
Run this WHILE Big Ten games are in progress to see whether CBBD fills in
player box scores during games, or only after they finish.

    python tools/check_cbbd_live.py

Uses 2 API calls: /scoreboard (live team scores, Patreon tier) and
/games/players for today.
"""
import os
import sys
import urllib.parse
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources  # noqa: E402


def get(path, **params):
    key = sources.cbbd_key()
    if not key:
        raise SystemExit("CBBD_API_KEY not set (env var or .env at the repo root)")
    return sources._get(f"{sources.CBBD}{path}?{urllib.parse.urlencode(params)}", headers={"Authorization": f"Bearer {key}"})


def main():
    board = get("/scoreboard", conference="B1G")
    live = [g for g in board if str(g.get("status", "")).lower() in ("in_progress", "inprogress", "live", "halftime", "in progress")]
    print(f"/scoreboard: {len(board)} Big Ten games today, statuses: {sorted({str(g.get('status')) for g in board})}")
    for g in board:
        print(f"  {g['awayTeam']['location']} {g['awayTeam'].get('points')} @ {g['homeTeam']['location']} {g['homeTeam'].get('points')}"
              f"  [{g.get('status')} {g.get('period') or ''} {g.get('clock') or ''}]  id {g['id']}")
    if not board:
        print("No Big Ten games today -- run this on a game night.")
        return
    now = datetime.now(timezone.utc)
    et_day = (now - timedelta(hours=5)).date()  # today in US Eastern
    season = now.year + 1 if now.month >= 8 else now.year
    rows = get("/games/players", season=season, startDateRange=f"{et_day}T05:00:00Z",
               endDateRange=f"{et_day + timedelta(days=1)}T05:00:00Z")
    have = {r["gameId"] for r in rows}
    print(f"\n/games/players: box scores for {len(have)} game(s) so far today")
    for g in board:
        status = "HAS player stats" if g["id"] in have else "no player stats yet"
        print(f"  game {g['id']} ({g.get('status')}): {status}")
    if live:
        verdict = any(g["id"] in have for g in live)
        print("\nVerdict:", "CBBD updates player stats DURING games." if verdict else
              "CBBD player stats are NOT available mid-game (only after).")


if __name__ == "__main__":
    main()
