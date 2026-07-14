#!/usr/bin/env python3
"""App icons: a Scrabble-ivory tile with a heavy L and a slot index — the app's
own visual language. Writes icons/icon-{180,192,512}.png."""
from PIL import Image, ImageDraw, ImageFont
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

IVORY, INK = (240, 229, 201), (51, 41, 26)

def font(size):
    for path in ["/System/Library/Fonts/Supplemental/Arial Bold.ttf",
                 "/System/Library/Fonts/Helvetica.ttc"]:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    raise SystemExit("no bold font found")

for size in (180, 192, 512):
    img = Image.new("RGB", (size, size), IVORY)
    d = ImageDraw.Draw(img)

    # heavy centered L
    f = font(int(size * 0.62))
    box = d.textbbox((0, 0), "L", font=f)
    w, h = box[2] - box[0], box[3] - box[1]
    d.text(((size - w) / 2 - box[0], (size - h) / 2 - box[1]), "L", font=f, fill=INK)

    # slot index in the corner, like the app's slots
    fi = font(int(size * 0.14))
    d.text((size * 0.08, size * 0.055), "1", font=fi, fill=INK)

    img.save(OUT / f"icon-{size}.png")
    print(f"icon-{size}.png")
