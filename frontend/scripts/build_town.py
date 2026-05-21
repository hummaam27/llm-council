"""One-off generator for the Sandbox town.

Composites coherent building PNGs from the AI Town rpg-tileset (same art set as
the terrain, so nothing clashes) and writes a clean grass town.json.
Run once: `python build_town.py`. Output is committed.
"""
import json
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
PUB = os.path.normpath(os.path.join(ROOT, "..", "public", "ai-town"))
TS = Image.open(os.path.join(PUB, "rpg-tileset.png")).convert("RGBA")
T = 16
os.makedirs(os.path.join(PUB, "buildings"), exist_ok=True)


def tilecrop(x0, y0, x1, y1):
    return TS.crop((x0 * T, y0 * T, x1 * T, y1 * T))


# Coherent regions cropped whole from the tileset — already drawn by the artist.
WALL_PALE = tilecrop(50, 12, 53, 14)    # solid pale wall swatch
WALL_BROWN = tilecrop(48, 23, 51, 26)   # solid brown wall swatch
_roof_raw = tilecrop(51, 14, 59, 22)
ROOF = _roof_raw.crop(_roof_raw.getbbox())  # the hipped roof, tight


def tint(img, mult):
    r, g, b, a = img.convert("RGBA").split()
    r = r.point(lambda v: min(255, int(v * mult[0])))
    g = g.point(lambda v: min(255, int(v * mult[1])))
    b = b.point(lambda v: min(255, int(v * mult[2])))
    return Image.merge("RGBA", (r, g, b, a))


def tile_to(swatch, w, h):
    out = Image.new("RGBA", (w, h))
    sw, sh = swatch.size
    for y in range(0, h, sh):
        for x in range(0, w, sw):
            out.alpha_composite(swatch, (x, y))
    return out


def make_building(fw, fh, wall, wall_tint, roof_tint):
    """fw/fh = wall footprint in px. Returns a finished building image."""
    wall_img = tile_to(tint(wall, wall_tint), fw, fh)
    roof_w = int(fw * 1.2)
    # squash the roof so cottages aren't roof-heavy / over-tall
    roof_h = int(ROOF.size[1] * roof_w / ROOF.size[0] * 0.62)
    roof_img = tint(ROOF.resize((roof_w, roof_h), Image.NEAREST), roof_tint)

    total_h = fh + roof_h - 8
    canvas = Image.new("RGBA", (roof_w, total_h))
    canvas.alpha_composite(wall_img, ((roof_w - fw) // 2, roof_h - 8))
    canvas.alpha_composite(roof_img, (0, 0))

    d = ImageDraw.Draw(canvas)
    dw, dh = 22, 30
    dx, dy = (roof_w - dw) // 2, total_h - dh
    d.rounded_rectangle([dx, dy, dx + dw, dy + dh], 4, fill=(70, 48, 35, 255))
    d.rounded_rectangle([dx + 3, dy + 4, dx + dw - 3, dy + dh], 3, fill=(110, 76, 54, 255))
    d.ellipse([dx + dw - 9, dy + dh // 2, dx + dw - 5, dy + dh // 2 + 4], fill=(240, 210, 120, 255))
    for wx in (dx - 30, dx + dw + 8):
        d.rectangle([wx, dy + 6, wx + 18, dy + 24], fill=(150, 200, 222, 255),
                    outline=(70, 48, 35, 255), width=2)
        d.line([wx + 9, dy + 6, wx + 9, dy + 24], fill=(70, 48, 35, 255), width=1)
        d.line([wx, dy + 15, wx + 18, dy + 15], fill=(70, 48, 35, 255), width=1)
    return canvas


# Six buildings — same art set, distinguished by footprint, wall and tint.
BUILDINGS = {
    "market":     dict(fw=124, fh=68, wall=WALL_PALE,  wt=(1.0, 0.98, 0.9),  rt=(1.05, 0.82, 0.6)),
    "town_hall":  dict(fw=156, fh=86, wall=WALL_PALE,  wt=(0.96, 0.98, 1.04), rt=(0.78, 0.84, 0.96)),
    "temple":     dict(fw=120, fh=96, wall=WALL_PALE,  wt=(1.08, 1.05, 0.94), rt=(1.12, 1.0, 0.72)),
    "archive":    dict(fw=132, fh=74, wall=WALL_BROWN, wt=(0.92, 0.95, 1.02), rt=(0.74, 0.8, 0.92)),
    "tavern":     dict(fw=128, fh=72, wall=WALL_BROWN, wt=(1.06, 0.9, 0.7),   rt=(1.0, 0.76, 0.48)),
    "backstreet": dict(fw=104, fh=62, wall=WALL_BROWN, wt=(0.62, 0.6, 0.62),  rt=(0.5, 0.48, 0.52)),
}

for key, p in BUILDINGS.items():
    img = make_building(p["fw"], p["fh"], p["wall"], p["wt"], p["rt"])
    img.save(os.path.join(PUB, "buildings", key + ".png"))
    print(f"building {key}: {img.size}")

# Clean 25x25 all-grass terrain — no stray fence, no random path.
GRID = 25
GRASS_GID = 204  # tileset tile (3,2) — flat grass, the most common in AI Town's map
town = {
    "size": GRID, "tile": 16,
    "layers": {
        "terrain": [GRASS_GID] * (GRID * GRID),
        "bridge": [0] * (GRID * GRID),
        "deco": [0] * (GRID * GRID),
    },
}
json.dump(town, open(os.path.join(PUB, "town.json"), "w"))
print(f"town.json written: {GRID}x{GRID} grass")

# A contact sheet of the buildings for quick visual review.
review = Image.new("RGBA", (1100, 320), (90, 130, 80, 255))
x = 10
for key in BUILDINGS:
    b = Image.open(os.path.join(PUB, "buildings", key + ".png"))
    review.alpha_composite(b, (x, 300 - b.size[1]))
    x += b.size[0] + 16
review.convert("RGB").save(os.path.join(ROOT, "_review.png"))
print("review sheet: scripts/_review.png")
