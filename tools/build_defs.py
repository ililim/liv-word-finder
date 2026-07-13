#!/usr/bin/env python3
"""Build per-letter definition chunks for the app.

Reads NWL2023.txt + CSW21.txt (word + inline definition) and enable1.txt
(membership only), merges into data/defs/{a-z}.json:
    { "word": ["definition text", "NCE"] }
flags: N = NWL2023, C = CSW21, E = ENABLE. Definition prefers NWL, falls
back to CSW, empty string if the word is ENABLE-only.
Also writes data/meta.json with counts.
"""
import json, pathlib, collections

ROOT = pathlib.Path(__file__).resolve().parent.parent
WL = ROOT / "wordlists"
OUT = ROOT / "data" / "defs"
OUT.mkdir(parents=True, exist_ok=True)

def read_defs(path):
    d = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split(None, 1)
        w = parts[0].lower()
        if not w.isalpha():
            continue
        d[w] = parts[1] if len(parts) > 1 else ""
    return d

nwl = read_defs(WL / "NWL2023.txt")
csw = read_defs(WL / "CSW21.txt")
enable = {w.strip().lower() for w in (WL / "enable1.txt").read_text().splitlines()
          if w.strip().isalpha()}

allwords = set(nwl) | set(csw) | enable
chunks = collections.defaultdict(dict)
for w in allwords:
    flags = ("N" if w in nwl else "") + ("C" if w in csw else "") + ("E" if w in enable else "")
    definition = nwl.get(w) or csw.get(w) or ""
    chunks[w[0]][w] = [definition, flags]

total = 0
for letter, words in sorted(chunks.items()):
    p = OUT / f"{letter}.json"
    p.write_text(json.dumps(dict(sorted(words.items())), separators=(",", ":")))
    total += len(words)
    print(f"{letter}: {len(words):>6} words  {p.stat().st_size/1024:8.0f} KB")

(ROOT / "data" / "meta.json").write_text(json.dumps({
    "total": total, "nwl": len(nwl), "csw": len(csw), "enable": len(enable)}))
print(f"total {total} words across {len(chunks)} chunks")
