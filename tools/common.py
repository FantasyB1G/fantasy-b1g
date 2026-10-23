"""Shared constants and helpers for the tools/ scripts."""
import json
import os
import re
import unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

MANAGERS = ["Waldo", "Michael", "Brett", "Falan"]
LAST_TO_FIRST = {"Vasquez": "Waldo", "Vazquez": "Waldo", "Titus": "Michael", "Gold": "Brett", "Garner": "Falan"}
STATS = ["pts", "reb", "ast", "stl", "blk"]


# Different spellings of the same player across seasons / sheets, as
# norm_name() keys -> canonical norm_name() key.
ALIASES = {
    "zac irvin": "zak irvin",
    "joe weiskamp": "joe wieskamp",
    "jae sean tate": "jaesean tate",
    "ej lidell": "ej liddell",
    "luka garza": "luke garza",
    "joshua dix": "josh dix",
    "muhammad ali abdur rahkmam": "muhammad ali abdur rahkman",
}


# Different people who share a name: "<kind>:<year>:<norm name>" -> their own key.
# kind is "mm" for a March Madness pick (regular-season rows keep the plain key).
DISTINCT = {
    "mm:2017:justin jackson": "justin jackson north carolina",  # UNC, not Maryland's Justin Jackson
}


def player_key(name, kind=None, year=None):
    k = norm_name(name)
    k = ALIASES.get(k, k)
    return DISTINCT.get(f"{kind}:{year}:{k}", k) if kind else k


def season_label(year):
    """2026 -> '2025-26' (seasons are named by the spring they end in)."""
    return f"{year - 1}-{str(year)[2:]}"


def norm_name(name):
    """Loose key for matching player names across sources:
    'Jeremy Fears Jr.' == 'jeremy fears jr' == 'Jeremy Fears, Jr'."""
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-z0-9 ]", "", s.lower().replace("-", " "))
    s = re.sub(r"\b(jr|sr|ii|iii|iv)\b", "", s)
    return re.sub(r"\s+", " ", s).strip()


def read_json(path, default=None):
    if not os.path.exists(path):
        return default
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def pretty_json(obj, indent=0, width=100):
    """indent=2 style, but any list/object that fits on one line stays on one
    line -- keeps hand-edited config files short and readable."""
    flat = json.dumps(obj, ensure_ascii=False)
    if not isinstance(obj, (dict, list)) or len(flat) + indent <= width:
        return flat
    pad, inner = " " * indent, " " * (indent + 2)
    if isinstance(obj, list):
        items = [inner + pretty_json(v, indent + 2, width) for v in obj]
        return "[\n" + ",\n".join(items) + "\n" + pad + "]"
    items = [inner + json.dumps(k, ensure_ascii=False) + ": " + pretty_json(v, indent + 2, width)
             for k, v in obj.items()]
    return "{\n" + ",\n".join(items) + "\n" + pad + "}"


def write_json(path, obj, pretty=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        if pretty:
            f.write(pretty_json(obj))
        else:
            json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
