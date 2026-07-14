#!/usr/bin/env python3
"""App icon: LIV spelled in three ivory Scrabble tiles on a tile-rack tan ground.
Writes icons/icon-{180,192,512}.png."""
from PIL import Image, ImageDraw, ImageFont
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

IVORY, INK, TAN = (240, 229, 201), (51, 41, 26), (196, 178, 138)

def font(size):
    return ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", size)

def text_center(d, xy, s, f, fill):
    box = d.textbbox((0, 0), s, font=f)
    d.text((xy[0] - (box[2] - box[0]) / 2 - box[0], xy[1] - (box[3] - box[1]) / 2 - box[1]), s, font=f, fill=fill)

for size in (180, 192, 512):
    img = Image.new("RGB", (size, size), TAN)
    d = ImageDraw.Draw(img)

    w = size * 0.25            # tile width; height is the classic 1.15 ratio
    gap = size * 0.035
    x0 = (size - (3 * w + 2 * gap)) / 2
    y0 = (size - w * 1.15) / 2

    for i, ch in enumerate("LIV"):
        x = x0 + i * (w + gap)
        d.rectangle([x, y0, x + w, y0 + w * 1.15], fill=IVORY)
        text_center(d, (x + w / 2, y0 + w * 1.15 / 2), ch, font(int(w * 0.62)), INK)

    img.save(OUT / f"icon-{size}.png")
    print(f"icon-{size}.png")
