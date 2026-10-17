"""Render the Windows setup artwork from the app icon (run once; outputs are committed).

    python3 services/edge/deploy/windows/make_art.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ICON = REPO / "apps/ios/RetailGuard/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png"
FONT = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"
TOP, BOTTOM = (34, 22, 92), (8, 8, 26)  # indigo -> near black, matches the icon background
SCALES = (100, 125, 150, 175, 200, 225, 250)


def gradient(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h))
    px = img.load()
    for y in range(h):
        t = y / max(h - 1, 1)
        c = tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3))
        for x in range(w):
            px[x, y] = c
    return img


def side(scale: int) -> Image.Image:
    w, h = round(164 * scale / 100), round(314 * scale / 100)
    img = gradient(w, h)
    # soft violet glow behind the character
    glow = Image.new("L", (w, h), 0)
    ImageDraw.Draw(glow).ellipse((-w * 0.2, h * 0.38, w * 1.2, h * 1.05), fill=120)
    glow = glow.filter(ImageFilter.GaussianBlur(w * 0.18))
    img = Image.composite(Image.new("RGB", (w, h), (110, 70, 255)), img, glow.point(lambda v: v // 2))
    art = Image.open(ICON).convert("RGB")
    side_len = round(w * 1.25)
    art = art.resize((side_len, side_len), Image.LANCZOS)
    # fade the square icon's edges into the gradient
    mask = Image.new("L", art.size, 0)
    m = round(side_len * 0.07)
    ImageDraw.Draw(mask).rounded_rectangle((m, m, side_len - m, side_len - m), radius=side_len // 4, fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(side_len * 0.06))
    img.paste(art, (round((w - side_len) / 2), h - side_len + round(side_len * 0.06)), mask)
    d = ImageDraw.Draw(img)
    big = ImageFont.truetype(FONT, round(19 * scale / 100))
    small = ImageFont.truetype(FONT_REG, round(10.5 * scale / 100))
    x = round(14 * scale / 100)
    d.text((x, round(22 * scale / 100)), "RetailGuard", font=big, fill=(255, 255, 255))
    d.text((x, round(46 * scale / 100)), "EDGE APPLIANCE", font=small, fill=(176, 160, 255))
    d.line((x, round(64 * scale / 100), x + round(28 * scale / 100), round(64 * scale / 100)),
           fill=(124, 92, 255), width=max(1, round(2 * scale / 100)))
    return img


def small(scale: int) -> Image.Image:
    s = round(55 * scale / 100)
    art = Image.open(ICON).convert("RGBA").resize((s, s), Image.LANCZOS)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, s - 1, s - 1), radius=round(s * 0.22), fill=255)
    out = Image.new("RGB", (s, s), (255, 255, 255))  # header background is white
    out.paste(art, (0, 0), mask)
    return out


def main() -> None:
    out = HERE / "art"
    out.mkdir(exist_ok=True)
    for sc in SCALES:
        side(sc).save(out / f"side-{sc}.bmp")
        small(sc).save(out / f"small-{sc}.bmp")
    Image.open(ICON).convert("RGBA").save(out / "retailguard.ico",
                                          sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])


if __name__ == "__main__":
    main()
