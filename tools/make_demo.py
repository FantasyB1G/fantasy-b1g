"""
make_demo.py
============
Builds data/demo/: a mock of opening night (Mon 11/2/2026, 8:15 PM ET) so the
live view can be previewed before the season starts. Open the site with
?demo=1 (e.g. http://localhost:8000/?demo=1).

The schedule and matchups are real (ESPN); rosters fill the not-yet-drafted
slots with real players, and the in-game scores / box scores are simulated.
Delete data/demo/ whenever you like -- nothing else depends on it.

    python tools/make_demo.py
"""
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sources  # noqa: E402
from common import ROOT, norm_name, write_json  # noqa: E402
from update import Fetcher, Resolver, compute_season, player_map  # noqa: E402

NOW = datetime(2026, 11, 3, 1, 15, tzinfo=timezone.utc)  # 8:15 PM EST, Mon 11/2
OUT = os.path.join(ROOT, "data", "demo")

CFG = {
    "season": 2027, "slots": 31, "draftOrder": "MWBF", "status": "live",
    "pickupDates": ["2026-12-15", "2027-01-15", "2027-02-15"],
    "teams": {
        "Waldo": {"draft": ["Andrej Stojakovic", "Rodney Rice", "Elliot Cadeau", "Alijah Arenas", "Coen Carr", "Markus Burton", "Pharrel Payne"],
                  "bench": [{"fromGame": 1, "player": "Alijah Arenas"}], "pickups": []},
        "Michael": {"draft": ["Roddy Gayle Jr.", "DJ Wagner", "David Mirkovic", "C.J. Cox", "Cade Tyson", "Tomislav Ivisic", "John Mobley Jr."],
                    "bench": [{"fromGame": 1, "player": "Tomislav Ivisic"}], "pickups": []},
        "Brett": {"draft": ["Isaia Howard", "Wesley Yates III", "Jack Benter", "Josh Reed", "Xavier Booker", "Nolan Winter", "Jamichael Davis"],
                  "bench": [{"fromGame": 1, "player": "Jamichael Davis"}], "pickups": []},
        "Falan": {"draft": ["Jalen Reed", "Sam Alexis", "Taylor Bol Bowen", "Pryce Sandfort", "Connor Essegian", "Angelo Ciaravino", "Jeremy Fears Jr"],
                  "bench": [{"fromGame": 1, "player": "Connor Essegian"}], "pickups": []},
    },
    "players": {"Cade Tyson": {"school": "Minnesota", "id": None}},
    "overrides": [],
}
DNP = {"roddy gayle"}  # sat out his (final) game -> Michael's bench player subs in
STAR = {"stojakovic", "cadeau", "carr", "burton", "wagner", "mirkovic", "cox", "benter", "reed", "winter",
        "sandfort", "fears", "alexis", "howard", "payne", "ivisic"}


def game_state(tip):
    """Simple game clock model: 20-min halves, ~15-min halftime, ~2h total."""
    e = (NOW - tip).total_seconds() / 60
    if e < 0:
        return "pre", 0, None
    if e < 50:
        return "in", e / 120, (1, 20 - e * 20 / 50)
    if e < 65:
        return "half", 0.5, None
    if e < 120:
        return "in", 0.5 + (e - 65) / 110, (2, 20 - (e - 65) * 20 / 55)
    return "post", 1.0, None


def clock(mins):
    m = max(0.0, mins)
    return f"{int(m)}:{int(round((m % 1) * 60)) % 60:02d}"


def box_for(team_id, points, frac, rng, rostered):
    roster = sources._get(f"{sources.ESPN}/teams/{team_id}/roster").get("athletes", [])
    # rostered fantasy players first, then a normal rotation
    roster.sort(key=lambda a: (norm_name(a["fullName"]) not in rostered, rng.random()))
    rotation = roster[:9]
    weights = []
    for a in rotation:
        k = norm_name(a["fullName"])
        star = any(s in k for s in STAR) and k in rostered
        weights.append(rng.uniform(2.2, 3.2) if star else rng.uniform(0.5, 1.6))
    athletes = []
    left = points
    for i, (a, w) in enumerate(zip(rotation, weights)):
        k = norm_name(a["fullName"])
        if any(d in k for d in DNP):
            athletes.append({"athlete": {"id": a["id"], "displayName": a["fullName"]}, "didNotPlay": True, "stats": []})
            continue
        pts = left if i == len(rotation) - 1 else min(left, round(points * w / sum(weights)))
        left -= pts
        mins = round(32 * frac * (w / 3 + 0.4))
        reb, ast = round(rng.uniform(1, 9) * frac), round(rng.uniform(0, 6) * frac)
        stl, blk = rng.choice([0, 0, 1, 1, 2]) if frac > 0.3 else 0, rng.choice([0, 0, 0, 1, 2]) if frac > 0.3 else 0
        athletes.append({"athlete": {"id": a["id"], "displayName": a["fullName"]}, "didNotPlay": False, "starter": i < 5,
                         "stats": [str(mins), str(pts), "", "", "", str(reb), str(ast), "0", str(stl), str(blk), "", "", ""]})
    return {"team": {"id": str(team_id)}, "statistics": [{
        "names": ["MIN", "PTS", "FG", "3PT", "FT", "REB", "AST", "TO", "STL", "BLK", "OREB", "DREB", "PF"],
        "athletes": athletes}]}


def main():
    os.makedirs(os.path.join(OUT, "summary"), exist_ok=True)
    print("season (all games still pending on opening night)...")
    resolver = Resolver(CFG)
    season = compute_season(CFG, Fetcher(2027, "espn"), resolver)
    season["players"] = player_map(resolver)
    season["lastUpdate"] = "2026-11-02 06:00 ET"
    write_json(os.path.join(OUT, "season.json"), season)

    print("schedules...")
    sched = {}
    for school in sorted({i["school"] for i in season["players"].values() if i.get("school")}):
        sched[school] = {"teamId": str(sources.espn_teams()[school]), "games": sources.espn_schedule(school, 2027)}
    write_json(os.path.join(OUT, "schedule.json"), sched)

    print("scoreboard + box scores...")
    board = sources._get(f"{sources.ESPN}/scoreboard?dates=20261102&groups=7&limit=100")
    rostered = {norm_name(n) for n in season["players"]}
    rng = random.Random(1102)
    for ev in board["events"]:
        c = ev["competitions"][0]
        tip = datetime.strptime(ev["date"], "%Y-%m-%dT%H:%MZ").replace(tzinfo=timezone.utc)
        state, frac, clk = game_state(tip + timedelta(minutes=rng.uniform(-3, 9)))  # games never tip exactly on time
        st = c["status"]
        if state == "pre":
            continue
        for x in c["competitors"]:
            strong = x["team"].get("conferenceId") == "7" or x["team"]["location"] in sources.BIG_TEN
            final = rng.randint(74, 92) if strong else rng.randint(58, 74)
            if x["team"]["location"] in ("Gonzaga", "Arizona"):
                final = rng.randint(76, 88)
            x["score"] = str(round(final * frac))
        if state == "post":
            st.update({"period": 2, "displayClock": "0:00"})
            st["type"].update({"name": "STATUS_FINAL", "state": "post", "completed": True, "description": "Final",
                               "detail": "Final", "shortDetail": "Final"})
        elif state == "half":
            st.update({"period": 1, "displayClock": "0:00"})
            st["type"].update({"name": "STATUS_HALFTIME", "state": "in", "description": "Halftime",
                               "detail": "Halftime", "shortDetail": "Halftime"})
        else:
            per, mins = clk
            st.update({"period": per, "displayClock": clock(mins)})
            st["type"].update({"name": "STATUS_IN_PROGRESS", "state": "in", "description": "In Progress",
                               "detail": f"{clock(mins)} - {'1st' if per == 1 else '2nd'} Half",
                               "shortDetail": f"{clock(mins)} - {'1st' if per == 1 else '2nd'}"})
        summary = {"boxscore": {"players": [box_for(x["id"], int(x["score"]), frac, rng, rostered) for x in c["competitors"]]}}
        write_json(os.path.join(OUT, "summary", f"{ev['id']}.json"), summary)
        print(f"  {ev['shortName']:14} {st['type']['shortDetail']}")
    write_json(os.path.join(OUT, "scoreboard.json"), board)
    write_json(os.path.join(OUT, "meta.json"), {"now": NOW.strftime("%Y-%m-%dT%H:%M:%SZ"),
                                                 "label": "Mon, Nov 2 - 8:15 PM ET (opening night)"})
    print("wrote", os.path.relpath(OUT, ROOT))


if __name__ == "__main__":
    main()
