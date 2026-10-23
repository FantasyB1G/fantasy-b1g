"""
sources.py
==========
Box-score fetching. Two interchangeable sources, both keyed by ESPN athlete id:

  cbbd  CollegeBasketballData API -- one call per team per season. Needs an
        API key in CBBD_API_KEY (env var, or a .env file at the repo root).
  espn  ESPN's public site API -- no key, but one call per game. Finished
        games are cached in .cache/espn/ so reruns only fetch new games.

team_games(school, season, source) returns
    {"regular": [game, ...], "ncaa": [game, ...]}      (completed games, by date)
    game = {"date": "YYYY-MM-DD", "opp": "vs Purdue", "players": {espn_id: {"name", "s": [pts, reb, ast, stl, blk]}}}
"regular" includes conference tournament games; "ncaa" is the NCAA tournament.
"""
import json
import os
import time
from datetime import datetime, timedelta
import urllib.error
import urllib.parse
import urllib.request

from common import ROOT, norm_name

ESPN = "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball"
CBBD = "https://api.collegebasketballdata.com"
CACHE = os.path.join(ROOT, ".cache")

# ESPN team ids. School names are the same in ESPN ("location") and CBBD ("school").
BIG_TEN = {
    "Illinois": 356, "Indiana": 84, "Iowa": 2294, "Maryland": 120, "Michigan": 130,
    "Michigan State": 127, "Minnesota": 135, "Nebraska": 158, "Northwestern": 77,
    "Ohio State": 194, "Oregon": 2483, "Penn State": 213, "Purdue": 2509, "Rutgers": 164,
    "UCLA": 26, "USC": 30, "Washington": 264, "Wisconsin": 275,
}


def _get(url, headers=None, tries=4):
    req = urllib.request.Request(url, headers={"accept": "application/json", "User-Agent": "fantasy-b1g", **(headers or {})})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            if e.code == 429 and "quota" in body.lower():
                raise SystemExit(f"CBBD call quota exhausted: {body.strip()}  (try --source espn)")
            if e.code not in (429, 500, 502, 503, 504) or attempt == tries - 1:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == tries - 1:
                raise
        time.sleep(2 ** attempt)


def cbbd_key():
    key = os.environ.get("CBBD_API_KEY")
    env = os.path.join(ROOT, ".env")
    if not key and os.path.exists(env):
        for line in open(env, encoding="utf-8"):
            if line.strip().startswith("CBBD_API_KEY="):
                key = line.split("=", 1)[1].strip()
    return key


def pick_source(requested):
    if requested == "auto":
        return "cbbd" if cbbd_key() else "espn"
    if requested == "cbbd" and not cbbd_key():
        raise SystemExit("CBBD_API_KEY not set (env var or .env at the repo root). Use --source espn instead.")
    return requested


# ---------------------------------------------------------------- rosters

def espn_teams():
    """All D1 teams: {school: espn_id}, plus loose-name lookups."""
    path = os.path.join(CACHE, "espn_teams.json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 30 * 86400:
        return json.load(open(path, encoding="utf-8"))
    d = _get(f"{ESPN}/teams?limit=500")
    out = {}
    for t in d["sports"][0]["leagues"][0]["teams"]:
        t = t["team"]
        out[t["location"]] = int(t["id"])
    os.makedirs(CACHE, exist_ok=True)
    json.dump(out, open(path, "w", encoding="utf-8"))
    return out


def find_school(name):
    """Resolve a user-typed school ('Michigan St', 'UConn') to the canonical name."""
    teams = espn_teams()
    if name in teams:
        return name
    n = norm_name(name).replace(" st", " state").replace("saint ", "st ")
    for school in teams:
        if norm_name(school) == n or norm_name(school).replace("saint ", "st ") == n:
            return school
    raise SystemExit(f"Unknown school '{name}'. Use the ESPN school name, e.g. 'Michigan State', 'UConn'.")


def big_ten_rosters():
    """{norm_name: {"name", "id", "school"}} for every current Big Ten player."""
    out = {}
    for school, tid in BIG_TEN.items():
        d = _get(f"{ESPN}/teams/{tid}/roster")
        for a in d.get("athletes", []):
            out[norm_name(a["fullName"])] = {"name": a["fullName"], "id": str(a["id"]), "school": school}
    return out


def school_roster(school):
    tid = espn_teams()[school]
    d = _get(f"{ESPN}/teams/{tid}/roster")
    return {norm_name(a["fullName"]): {"name": a["fullName"], "id": str(a["id"]), "school": school}
            for a in d.get("athletes", [])}


# ---------------------------------------------------------------- box scores

def _local_date(iso):
    """UTC timestamp -> US Eastern calendar date (fixed UTC-5 is close enough
    to keep late tip-offs on the right day)."""
    dt = datetime.strptime(iso[:16], "%Y-%m-%dT%H:%M") - timedelta(hours=5)
    return dt.strftime("%Y-%m-%d")


def _opp(is_home, neutral, opp):
    return f"{'vs' if is_home or neutral else '@'} {opp}"


def _cbbd_games(school, season):
    qs = urllib.parse.urlencode({"season": season, "team": school})
    data = _get(f"{CBBD}/games/players?{qs}", headers={"Authorization": f"Bearer {cbbd_key()}"})
    out = {"regular": [], "ncaa": []}
    for g in sorted(data, key=lambda x: x["startDate"]):
        if g["seasonType"] == "regular":
            bucket = "regular"
        elif g["seasonType"] == "postseason" and g.get("tournament") == "NCAA":
            bucket = "ncaa"
        else:
            continue  # NIT / CBI / exhibitions
        players = {}
        for p in g["players"]:
            if not p.get("minutes"):
                continue
            players[str(p["athleteSourceId"])] = {
                "name": p["name"],
                "s": [p.get("points") or 0, (p.get("rebounds") or {}).get("total") or 0,
                      p.get("assists") or 0, p.get("steals") or 0, p.get("blocks") or 0],
            }
        out[bucket].append({"date": _local_date(g["startDate"]), "opp": _opp(g["isHome"], g["neutralSite"], g["opponent"]),
                            "players": players})
    return out


def _espn_box(event_id):
    path = os.path.join(CACHE, "espn", f"{event_id}.json")
    if os.path.exists(path):
        return json.load(open(path, encoding="utf-8"))
    d = _get(f"{ESPN}/summary?event={event_id}")
    teams = {}
    for t in d.get("boxscore", {}).get("players", []):
        st = t["statistics"][0]
        idx = {n: i for i, n in enumerate(st["names"])}
        ps = {}
        for a in st["athletes"]:
            if a.get("didNotPlay") or not a.get("stats"):
                continue
            v = a["stats"]
            num = lambda k: int(v[idx[k]]) if v[idx[k]] not in ("", "--") else 0  # noqa: E731
            if num("MIN") == 0 and all(num(k) == 0 for k in ("PTS", "REB", "AST", "STL", "BLK")):
                continue
            ps[str(a["athlete"]["id"])] = {"name": a["athlete"]["displayName"],
                                           "s": [num("PTS"), num("REB"), num("AST"), num("STL"), num("BLK")]}
        teams[str(t["team"]["id"])] = ps
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(teams, open(path, "w", encoding="utf-8"))
    return teams


def _espn_games(school, season):
    tid = str(espn_teams()[school])
    out = {"regular": [], "ncaa": []}
    for stype, bucket in ((2, "regular"), (3, "ncaa")):
        d = _get(f"{ESPN}/teams/{tid}/schedule?season={season}&seasontype={stype}")
        for e in sorted(d.get("events", []), key=lambda x: x["date"]):
            c = e["competitions"][0]
            if c["status"]["type"]["name"] != "STATUS_FINAL":
                continue
            if bucket == "ncaa" and not any("NCAA Men's Basketball Championship" in (n.get("headline") or "")
                                            for n in c.get("notes", [])):
                continue
            me = next(x for x in c["competitors"] if str(x["id"]) == tid)
            opp = next(x for x in c["competitors"] if str(x["id"]) != tid)
            box = _espn_box(e["id"])
            out[bucket].append({
                "date": _local_date(e["date"]),
                "opp": _opp(me["homeAway"] == "home", c.get("neutralSite"), opp["team"]["location"]),
                "players": box.get(tid, {}),
            })
    return out


def espn_schedule(school, season):
    """Every regular-season game (played or not) for the live layer:
    [{"id", "date" (UTC ISO), "opp", "oppId", "home", "neutral", "tv"}]."""
    tid = str(espn_teams()[school])
    d = _get(f"{ESPN}/teams/{tid}/schedule?season={season}&seasontype=2")
    out = []
    for e in sorted(d.get("events", []), key=lambda x: x["date"]):
        c = e["competitions"][0]
        me = next(x for x in c["competitors"] if str(x["id"]) == tid)
        opp = next(x for x in c["competitors"] if str(x["id"]) != tid)
        tv = [n for b in c.get("broadcasts", []) for n in ([b["media"]["shortName"]] if b.get("media") else b.get("names", []))]
        out.append({"id": e["id"], "date": e["date"], "opp": opp["team"]["location"], "oppId": str(opp["id"]),
                    "home": me["homeAway"] == "home", "neutral": bool(c.get("neutralSite")), "tv": ", ".join(tv)})
    return out


def team_games(school, season, source):
    return _cbbd_games(school, season) if source == "cbbd" else _espn_games(school, season)
