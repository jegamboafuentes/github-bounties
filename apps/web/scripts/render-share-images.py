#!/usr/bin/env python3
"""Rasterize share and tab icons from the homepage light-UI wordmark.

Source is public/brand/logo-1.png (same bytes as public/logo-wordmark.png):
dark scanline "GitHub Bounties" on transparent. Cards use the light site
background (#fafafa). Do not use logo-3 (light mark, invisible on white) or
logo-6 (light wordmark meant for zinc-950).
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "brand" / "logo-1.png"
BG = (250, 250, 250, 255)  # tailwind zinc-50 / #fafafa

# (dest, canvas, max content box as a fraction of the canvas)
TARGETS: list[tuple[Path, tuple[int, int], float]] = [
    (ROOT / "public" / "og.png", (1200, 630), 0.88),
    (ROOT / "public" / "icon.png", (512, 512), 0.90),
    (ROOT / "public" / "apple-touch-icon.png", (180, 180), 0.88),
    (ROOT / "src" / "app" / "icon.png", (512, 512), 0.90),
    (ROOT / "src" / "app" / "apple-icon.png", (180, 180), 0.88),
]


def content_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = image.getchannel("A")
    bbox = alpha.point(lambda a: 255 if a > 8 else 0).getbbox()
    if bbox is None:
        raise SystemExit(f"{SOURCE} has no opaque pixels")
    return bbox


def compose(mark: Image.Image, size: tuple[int, int], fill: float) -> Image.Image:
    canvas_w, canvas_h = size
    max_w = int(canvas_w * fill)
    max_h = int(canvas_h * fill)
    scale = min(max_w / mark.width, max_h / mark.height)
    resized = mark.resize(
        (max(1, round(mark.width * scale)), max(1, round(mark.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", size, BG)
    x = (canvas_w - resized.width) // 2
    y = (canvas_h - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas.convert("RGB")


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    mark = source.crop(content_bbox(source))
    for dest, size, fill in TARGETS:
        image = compose(mark, size, fill)
        dest.parent.mkdir(parents=True, exist_ok=True)
        image.save(dest, "PNG", optimize=True)
        print(f"wrote {dest.relative_to(ROOT)} {image.size} {dest.stat().st_size} bytes")

    # Next's app/favicon.ico decoder rejects RGB PNGs embedded in an ICO.
    tile = compose(mark, (180, 180), 0.88).convert("RGBA")
    ico_images = [
        tile.resize(size, Image.Resampling.LANCZOS).convert("RGBA") for size in ((48, 48), (32, 32), (16, 16))
    ]
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
