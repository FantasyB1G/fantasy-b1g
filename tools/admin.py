"""
admin.py
========
Local admin app for running the league: draft, bench, pickups, stat fixes,
Hall of Fame, plus buttons to update stats and publish.

    python tools/admin.py          # opens http://127.0.0.1:8770/admin

Runs only on your computer (bound to 127.0.0.1). It edits the same files as
tools/league.py: league/<year>.json, league/<year>-mm.json and
data/extras.json (Hall of Fame). The site preview is at http://127.0.0.1:8770/.
"""
import json
import os
import secrets
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

TOOLS = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, TOOLS)
import sources  # noqa: E402
from build import build  # noqa: E402
from common import MANAGERS, ROOT, read_json, write_json  # noqa: E402
from update import latest_season  # noqa: E402

PORT = 8770
TOKEN = secrets.token_urlsafe(16)  # blocks other websites from posting to this local server
ROSTER_CACHE = os.path.join(ROOT, ".cache", "b1g_rosters.json")


def cfg_path(season, mm=False):
    return os.path.join(ROOT, "league", f"{season}{'-mm' if mm else ''}.json")


def git(*args):
    r = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return r.returncode, (r.stdout + r.stderr).strip()


def rosters():
    """Current Big Ten rosters for autocomplete, cached for a day."""
    if os.path.exists(ROSTER_CACHE) and time.time() - os.path.getmtime(ROSTER_CACHE) < 86400:
        return read_json(ROSTER_CACHE)
    out = sorted(sources.big_ten_rosters().values(), key=lambda p: (p["school"], p["name"]))
    write_json(ROSTER_CACHE, out)
    return out


def season_progress(season):
    """Per manager: next game # to be played and the resolved pickups."""
    s = read_json(os.path.join(ROOT, "data", "seasons", f"{season}.json")) or {}
    out = {}
    for m, t in (s.get("teams") or {}).items():
        nxt = len(t["games"]) + 1
        for i, g in enumerate(t["games"]):
            if any(r.get("st") == "pending" for r in g if r.get("p")):
                nxt = i + 1
                break
        out[m] = {"nextGame": nxt, "pickups": t.get("pickups", [])}
    return {"teams": out, "lastUpdate": s.get("lastUpdate"), "slots": s.get("slots", 31)}


def state():
    season = latest_season()
    idx = read_json(os.path.join(ROOT, "data", "index.json"), {})
    extras = read_json(os.path.join(ROOT, "data", "extras.json"), {})
    _, status = git("status", "-sb")
    try:
        schools = sorted(sources.espn_teams())
    except Exception:
        schools = sorted(sources.BIG_TEN)
    return {
        "season": season,
        "managers": MANAGERS,
        "cfg": read_json(cfg_path(season)),
        "mm": read_json(cfg_path(season, True)),
        "hof": extras.get("hof", {}),
        "players": [{k: p[k] for k in ("key", "name", "school", "status", "owner", "years", "gp", "t")}
                    for p in idx.get("players", []) if p.get("status") != "mmOnly"],
        "progress": season_progress(season),
        "bigTen": sorted(sources.BIG_TEN),
        "schools": schools,
        "git": status,
    }


def run_tool(args):
    r = subprocess.run([sys.executable, "-u", *args], cwd=ROOT, capture_output=True, text=True)
    return {"ok": r.returncode == 0, "log": (r.stdout + r.stderr).strip()}


def publish(message):
    log = []
    git("add", "-A", "league", "data")
    staged, _ = git("diff", "--cached", "--quiet")  # exit 1 = something to commit
    if staged:
        code, out = git("commit", "-m", message or "League update")
        log.append(out)
        if code:
            return {"ok": False, "log": "\n".join(filter(None, log))}
    code, out = git("pull", "--rebase", "--autostash")
    log.append(out)
    if code:
        return {"ok": False, "log": "\n".join(filter(None, log)) + "\n\nPull failed -- resolve in a terminal."}
    code, out = git("push")
    log.append(out)
    return {"ok": code == 0, "log": "\n".join(filter(None, log))}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=ROOT, **k)

    def log_message(self, *a):
        pass

    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")  # always show fresh data in the preview
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/admin", "/admin/"):
            html = open(os.path.join(TOOLS, "admin", "index.html"), encoding="utf-8").read().replace("__TOKEN__", TOKEN)
            body = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif path == "/admin/admin.js":
            self.path = "/tools/admin/admin.js"
            super().do_GET()
        elif path == "/api/state":
            self.send_json(state())
        elif path == "/api/rosters":
            try:
                self.send_json(rosters())
            except Exception as e:
                self.send_json({"error": str(e)}, 502)
        else:
            super().do_GET()

    def do_POST(self):
        if self.headers.get("X-Admin-Token") != TOKEN:
            return self.send_json({"error": "bad token -- reload the admin page"}, 403)
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        path = urlparse(self.path).path
        try:
            if path == "/api/save-config":
                season = int(body["cfg"]["season"])
                write_json(cfg_path(season), body["cfg"], pretty=True)
                if body.get("mm"):
                    write_json(cfg_path(season, True), body["mm"], pretty=True)
                self.send_json({"ok": True})
            elif path == "/api/save-hof":
                p = os.path.join(ROOT, "data", "extras.json")
                extras = read_json(p, {})
                extras["hof"] = body["hof"]
                write_json(p, extras)
                build()
                self.send_json({"ok": True})
            elif path == "/api/update":
                args = ["tools/update.py"] + (["--source", body["source"]] if body.get("source") else [])
                self.send_json(run_tool(args))
            elif path == "/api/build":
                self.send_json(run_tool(["tools/build.py"]))
            elif path == "/api/publish":
                self.send_json(publish(body.get("message")))
            else:
                self.send_json({"error": "unknown"}, 404)
        except Exception as e:  # show the problem in the page instead of a dead request
            self.send_json({"ok": False, "error": f"{type(e).__name__}: {e}"}, 500)


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/admin"
    print(f"Fantasy B1G admin running at {url}  (site preview: http://127.0.0.1:{PORT}/)")
    print("Press Ctrl+C to stop.")
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
