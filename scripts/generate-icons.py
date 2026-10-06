#!/usr/bin/env python3
"""Generate PWA icons (requires Pillow)."""
from PIL import Image, ImageDraw
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "icons"
OUT.mkdir(exist_ok=True)

def make_icon(size, path):
    img = Image.new("RGB", (size, size), "#2563eb")
    draw = ImageDraw.Draw(img)
    margin = size // 8
    draw.ellipse([margin, margin, size - margin, size - margin], fill="#1d4ed8")
    pad = size // 5
    draw.rounded_rectangle([pad, pad + size // 12, size - pad, size - pad], radius=size // 12, fill="white")
    draw.rectangle([pad, pad + size // 12, size - pad, pad + size // 5], fill="#ef4444")
    cell = (size - 2 * pad) // 4
    cy0 = pad + size // 4
    for r in range(3):
        for c in range(3):
            x = pad + cell // 2 + c * cell + cell // 4
            y = cy0 + r * cell + cell // 4
            rdot = max(2, size // 32)
            draw.ellipse([x - rdot, y - rdot, x + rdot, y + rdot], fill="#2563eb")
    img.save(path, "PNG")
    print("Wrote", path)

if __name__ == "__main__":
    make_icon(192, OUT / "icon-192.png")
    make_icon(512, OUT / "icon-512.png")
    make_icon(180, OUT / "apple-touch-icon.png")
