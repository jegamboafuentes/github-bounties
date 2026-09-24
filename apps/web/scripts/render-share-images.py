#!/usr/bin/env python3
"""Rasterize share and tab icons from the homepage light-UI wordmark.

Source is public/brand/logo-1.png (same bytes as public/logo-wordmark.png):
dark scanline "GitHub Bounties" on transparent. Cards use #fafafa.

WhatsApp's link bubble shows a square center-crop of og:image, not the full
1200×630 frame. The wordmark is fitted inside that center square so the thumb
is the whole black mark, and the ink is thickened slightly so scanline gaps
do not average back to white at thumb size.

Do not use logo-3 (light mark, invisible on white) or logo-6 (for zinc-950).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "brand" / "logo-1.png"
BG = (250, 250, 250, 255)  # tailwind zinc-50 / #fafafa
# Master square. og.png pastes this into the center of 1200×630 (WhatsApp crop).
MASTER = 1260
FILL = 0.94
# Min/max filter radius on the master. ~1px at the 630 crop; keeps small thumbs black.
THICKEN = 2


def content_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
    if bbox is None:
        raise SystemExit(f"{SOURCE} has no opaque pixels")
    return bbox


def thicken_ink(image: Image.Image, radius: int) -> Image.Image:
    if radius <= 0:
        return image
    size = radius * 2 + 1
    ink = image.convert("L").point(lambda lum: 255 if lum < 220 else 0)
    mask = ink.filter(ImageFilter.MaxFilter(size))
    darker = image.filter(ImageFilter.MinFilter(size))
    return Image.composite(darker, image, mask)


def master_square(mark: Image.Image) -> Image.Image:
    scale = min((MASTER * FILL) / mark.width, (MASTER * FILL) / mark.height)
    resized = mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (MASTER, MASTER), BG)
    canvas.alpha_composite(resized, ((MASTER - resized.width) // 2, (MASTER - resized.height) // 2))
    return thicken_ink(canvas.convert("RGB"), THICKEN)


def square_tile(master: Image.Image, side: int) -> Image.Image:
    return master.resize((side, side), Image.Resampling.LANCZOS)


def og_card(master: Image.Image) -> Image.Image:
    side = 630
    tile = square_tile(master, side)
    card = Image.new("RGB", (1200, side), BG[:3])
    card.paste(tile, ((1200 - side) // 2, 0))
    return card


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    mark = source.crop(content_bbox(source))
    master = master_square(mark)

    outputs: list[tuple[Path, Image.Image]] = [
        (ROOT / "public" / "og.png", og_card(master)),
        (ROOT / "public" / "icon.png", square_tile(master, 512)),
        (ROOT / "public" / "apple-touch-icon.png", square_tile(master, 180)),
        (ROOT / "src" / "app" / "icon.png", square_tile(master, 512)),
        (ROOT / "src" / "app" / "apple-icon.png", square_tile(master, 180)),
    ]
    for dest, image in outputs:
        dest.parent.mkdir(parents=True, exist_ok=True)
        image.save(dest, "PNG", optimize=True)
        print(f"wrote {dest.relative_to(ROOT)} {image.size} {dest.stat().st_size} bytes")

    # Next's app/favicon.ico decoder rejects RGB PNGs embedded in an ICO.
    ico_images = [square_tile(master, side).convert("RGBA") for side in (48, 32, 16)]
    for dest in (ROOT / "public" / "favicon.ico", ROOT / "src" / "app" / "favicon.ico"):
        ico_images[0].save(
            dest,
            format="ICO",
            sizes=[(48, 48), (32, 32), (16, 16)],
            append_images=ico_images[1:],
        )
        print(f"wrote {dest.relative_to(ROOT)} {dest.stat().st_size} bytes")


if __name__ == "__main__":
    main()
