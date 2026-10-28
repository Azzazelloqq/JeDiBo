# Пиксельные иллюстрации Карт Кармы: docs/redesign/assets/card-illustrations/<cardId>.jpg → public/cards/pixel/<cardId>.png
# Запуск вручную (не в build), нужен Pillow. Без влияния на систему:
#   python -m pip install --target <scratch>/pylib pillow
#   python -I scripts/pixelize-cards.py <scratch>/pylib [cardId ...]
# Шаги: кадр по таблице CROP → BOX-уменьшение до окна карты → контраст → квантование к палитре без дизеринга
# → чистка одиночных пикселей → 1-px контур ink у тёмных силуэтов на светлом фоне.
# Ручная доводка PNG: нет (если понадобится — перечислить здесь карты и что правилось).
import os
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")
if len(sys.argv) > 1 and os.path.isdir(sys.argv[1]):
    sys.path.insert(0, sys.argv[1])
    only = set(sys.argv[2:])
else:
    only = set(sys.argv[1:])
from PIL import Image, ImageEnhance  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "redesign", "assets", "card-illustrations")
DST = os.path.join(ROOT, "public", "cards", "pixel")

# Окно иллюстрации = карта 52×72 минус рамка-плита 2 px по тиру (ui/card.ts).
W, H = 48, 68
CONTRAST = 1.18

# Палитра — токены тёмной палитры из src/render/palette.ts (одна на обе темы: у иллюстраций своя гамма —
# оранжевый, графит, белый). Бренд-оранжевый logo (#FF3600) обязателен.
TOKENS = ["void", "slab800", "slab600", "concrete600", "concrete400", "concrete200", "bone",
          "brand800", "brand700", "logo", "brand400", "brand100"]

# Кадр: центр интереса (доли исходника) и масштаб (1 — вся ширина исходника), чтобы фигура/жест были крупно.
CROP = {
    "barrier": (0.58, 0.55, 1.00),
    "betrayal": (0.55, 0.62, 1.25),
    "blitzkrieg": (0.50, 0.45, 1.10),
    "careerDown": (0.55, 0.55, 1.00),
    "careerUp": (0.50, 0.42, 1.30),
    "deathLine": (0.55, 0.55, 1.05),
    "depression": (0.50, 0.62, 1.00),
    "devaluation": (0.50, 0.52, 1.10),
    "doubleDeath": (0.50, 0.55, 1.05),
    "doubleDeathEnemy": (0.50, 0.50, 1.15),
    "freshBlood": (0.55, 0.45, 1.15),
    "gift": (0.55, 0.50, 1.00),
    "immortal": (0.50, 0.50, 1.10),
    "jumper": (0.50, 0.48, 1.05),
    "resurrection": (0.42, 0.45, 1.15),
    "retreat": (0.36, 0.62, 1.10),
    "roundProtection": (0.50, 0.55, 1.05),
    "sideChange": (0.50, 0.58, 1.05),
    "skipMove": (0.48, 0.62, 1.15),
    "snail": (0.50, 0.65, 1.10),
    "spy": (0.66, 0.55, 1.25),
}


def palette():
    text = open(os.path.join(ROOT, "src", "render", "palette.ts"), encoding="utf-8").read()
    dark = text[text.index("const DARK"):text.index("const LIGHT")]
    vals = dict(re.findall(r"(\w+):\s*'#([0-9a-fA-F]{6})'", dark))
    return [tuple(int(vals[t][i:i + 2], 16) for i in (0, 2, 4)) for t in TOKENS]


def crop(im, cx, cy, zoom):
    sw, sh = im.size
    cw = sw / zoom
    ch = cw * H / W
    if ch > sh:
        ch = sh
        cw = ch * W / H
    x0 = min(max(cx * sw - cw / 2, 0), sw - cw)
    y0 = min(max(cy * sh - ch / 2, 0), sh - ch)
    return im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch)))


def lum(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def clean(px, pal_rgb):
    """Одиночный пиксель, отличный от всех 4 соседей, → преобладающий цвет соседей."""
    out = [row[:] for row in px]
    for y in range(H):
        for x in range(W):
            n = [px[y + dy][x + dx] for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)) if 0 <= x + dx < W and 0 <= y + dy < H]
            if len(n) == 4 and all(c != px[y][x] for c in n):
                out[y][x] = max(set(n), key=n.count)
    return out


def ink_outline(px, ink, dark_idx):
    """1-px контур ink по краю тёмных силуэтов на светлом фоне."""
    out = [row[:] for row in px]
    for y in range(H):
        for x in range(W):
            if px[y][x] in dark_idx:
                continue
            if lum(px[y][x]) < 150:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if 0 <= x + dx < W and 0 <= y + dy < H and px[y + dy][x + dx] in dark_idx and px[y + dy][x + dx] != ink:
                    out[y][x] = ink
                    break
    return out


def main():
    pal = palette()
    pimg = Image.new("P", (1, 1))
    flat = [c for t in pal for c in t]
    pimg.putpalette(flat + [0] * (768 - len(flat)))
    os.makedirs(DST, exist_ok=True)
    ink = pal[TOKENS.index("void")]
    dark = {pal[TOKENS.index(t)] for t in ("void", "slab800", "slab600")}
    for card, (cx, cy, z) in CROP.items():
        if only and card not in only:
            continue
        im = Image.open(os.path.join(SRC, card + ".jpg")).convert("RGB")
        small = crop(im, cx, cy, z).resize((W, H), Image.Resampling.BOX)
        small = ImageEnhance.Contrast(small).enhance(CONTRAST)
        q = small.quantize(palette=pimg, dither=Image.Dither.NONE).convert("RGB")
        px = [[q.getpixel((x, y)) for x in range(W)] for y in range(H)]
        px = clean(px, pal)
        px = ink_outline(px, ink, dark)
        out = Image.new("RGB", (W, H))
        for y in range(H):
            for x in range(W):
                out.putpixel((x, y), px[y][x])
        out.save(os.path.join(DST, card + ".png"), optimize=True)
        print("ok", card)


main()
