"""
copy_logos.py
=============
Copies a 64px logo into assets/logos/ for every school the site mentions
(regular-season and March Madness), from a folder of <School>.png files.
Re-run after a March Madness draft adds new schools.

    python tools/copy_logos.py "C:/Users/micha/Desktop/cbb_model/cbb_model/update/docs/logos"

Needs Pillow (pip install pillow). Existing logos are left alone.
"""
import os
import re
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, read_json  # noqa: E402

DST = os.path.join(ROOT, "assets", "logos")
# site school name -> logo filename (without .png) where they differ
ALIASES = {"UConn": "Connecticut", "Miami": "Miami FL", "Pennsylvania": "Penn"}


def slug(school):
    return re.sub(r"[^a-z0-9]+", "-", school.lower()).strip("-")


def needed():
    idx = read_json(os.path.join(ROOT, "data", "index.json"), {})
    out = set()
    for p in idx.get("players", []):
        out.update(s for s in (p.get("schools") or []) + [p.get("school")] if s)
        out.update(x["school"] for x in p.get("seasons", []) + p.get("mm", []) if x.get("school"))
    return sorted(out)


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    src = sys.argv[1]
    files = {f[:-4].lower(): f for f in os.listdir(src) if f.lower().endswith(".png")}
    os.makedirs(DST, exist_ok=True)
    added, missing = 0, []
    for school in needed():
        out = os.path.join(DST, slug(school) + ".png")
        if os.path.exists(out):
            continue
        name = ALIASES.get(school, school)
        f = next((files[c.lower()] for c in (name, name.replace(" State", " St."), name.replace("Saint ", "St. "))
                  if c.lower() in files), None)
        if not f:
            missing.append(school)
            continue
        im = Image.open(os.path.join(src, f)).convert("RGBA")
        im.thumbnail((64, 64), Image.LANCZOS)
        im.save(out, optimize=True)
        added += 1
    print(f"added {added} logos ({len(os.listdir(DST))} total)")
    if missing:
        print("no logo found for:", ", ".join(missing), "(add to ALIASES)")


if __name__ == "__main__":
    main()
