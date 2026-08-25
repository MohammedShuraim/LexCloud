"""Build docs/banner.gif — same Lady Justice, LexCloud tech ticker. Matches Sentellent's looping hero."""

from __future__ import annotations

import math
import shutil
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(r"C:\Users\user\.cursor\projects\d-LexCloud\assets\lexcloud-banner-tech.png")
FALLBACK = ROOT / "docs" / "banner.jpg"
OUT = ROOT / "docs" / "banner.gif"

W, H = 1280, 480
N_FRAMES = 32
DURATION_MS = 90
BRASS = (212, 175, 106)
PARCHMENT = (243, 234, 214)
INK = (11, 18, 16)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    names = (
        ("segoeuib.ttf", "segoeui.ttf") if bold else ("segoeui.ttf", "seguisb.ttf")
    )
    for name in names:
        path = Path(r"C:\Windows\Fonts") / name
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def load_base() -> Image.Image:
    src = SRC if SRC.exists() else FALLBACK
    im = Image.open(src).convert("RGB")
    # Scale to width, then center-crop to the Sentellent-style wide strip.
    scale = W / im.width
    resized = im.resize((W, max(1, int(im.height * scale))), Image.Resampling.LANCZOS)
    if resized.height < H:
        scale = H / im.height
        resized = im.resize((max(1, int(im.width * scale)), H), Image.Resampling.LANCZOS)
        left = max(0, (resized.width - W) // 2)
        return resized.crop((left, 0, left + W, H))
    top = max(0, int((resized.height - H) * 0.18))
    return resized.crop((0, top, W, top + H))


def gold_glow_layer(rgb: np.ndarray, t: float) -> np.ndarray:
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    gold = (r > 140) & (g > 90) & (r > g) & (b < 160) & ((r.astype(np.int16) - b) > 40)
    pulse = 0.55 + 0.45 * (0.5 + 0.5 * math.sin(t * 2 * math.pi))
    extra = np.zeros_like(rgb, dtype=np.float32)
    extra[gold, 0] = 36 * pulse
    extra[gold, 1] = 22 * pulse
    extra[gold, 2] = 6 * pulse
    return extra


def particles(draw: ImageDraw.ImageDraw, t: float) -> None:
    rng = np.random.default_rng(7)
    for i in range(42):
        seed = rng.random(3)
        x = (seed[0] * W + math.sin(t * 2 * math.pi + i) * 28) % W
        y = (seed[1] * H * 0.85 + math.cos(t * 2 * math.pi * 0.7 + i * 0.4) * 12) % H
        a = 90 + int(110 * (0.5 + 0.5 * math.sin(t * 2 * math.pi + i)))
        size = 1 + int(seed[2] * 2)
        color = (212, 175, 106, a)
        draw.ellipse((x, y, x + size, y + size), fill=color)


def waveform(draw: ImageDraw.ImageDraw, t: float) -> None:
    x0, y0, width, height = 48, H - 78, 320, 36
    draw.rounded_rectangle(
        (x0 - 10, y0 - 8, x0 + width + 10, y0 + height + 8),
        radius=8,
        fill=(11, 18, 16, 150),
        outline=(*BRASS, 140),
        width=1,
    )
    pts = []
    for i in range(width):
        x = x0 + i
        y = y0 + height / 2 + math.sin(i / 9 + t * 2 * math.pi * 2) * 11
        y += math.sin(i / 4.2 + t * 2 * math.pi) * 5
        pts.append((x, y))
    draw.line(pts, fill=(*BRASS, 220), width=2)


def hud(draw: ImageDraw.ImageDraw, t: float, fonts: dict) -> None:
    modes = ["RAG", "TRANSLATE", "CHAT"]
    mode = modes[int(t * 3) % 3]
    draw.rounded_rectangle((36, 28, 430, 118), radius=10, fill=(11, 18, 16, 168), outline=(*BRASS, 150), width=1)
    draw.text((52, 38), "LEXCLOUD", font=fonts["title"], fill=(*PARCHMENT, 245))
    draw.text((52, 68), "AI legal advisor  ·  Indian law  ·  AWS", font=fonts["small"], fill=(*BRASS, 220))
    x = 52
    for name in modes:
        active = name == mode
        tw = 86 if name != "TRANSLATE" else 118
        box = (x, 88, x + tw, 108)
        draw.rounded_rectangle(box, radius=4, fill=(*BRASS, 220) if active else (23, 36, 31, 180))
        fill = INK if active else (*PARCHMENT, 210)
        draw.text((x + 10, 90), name, font=fonts["tiny"], fill=fill)
        x += tw + 8

    # Pipeline ticker — LexCloud product loop
    steps = ["PDF", "EXTRACT", "RAG", "TRANSLATE", "POLLY"]
    active_i = int(t * 5) % 5
    draw.rounded_rectangle((W - 520, 28, W - 36, 118), radius=10, fill=(11, 18, 16, 168), outline=(*BRASS, 150), width=1)
    draw.text((W - 504, 40), "SERVERLESS COUNSEL", font=fonts["tiny"], fill=(*BRASS, 230))
    x = W - 504
    for i, step in enumerate(steps):
        on = i <= active_i
        draw.ellipse((x, 72, x + 10, 82), fill=(*BRASS, 230) if on else (90, 74, 48, 180))
        draw.text((x + 14, 68), step, font=fonts["tiny"], fill=(*PARCHMENT, 235) if on else (180, 168, 140, 160))
        if i < len(steps) - 1:
            draw.line((x + 78, 77, x + 90, 77), fill=(*BRASS, 160), width=1)
        x += 92


def scanline(overlay: Image.Image, t: float) -> None:
    y = int((H + 40) * t) - 20
    draw = ImageDraw.Draw(overlay)
    draw.rectangle((0, y, W, y + 18), fill=(212, 175, 106, 18))


def compose_frame(base: Image.Image, rgb: np.ndarray, t: float, fonts: dict) -> Image.Image:
    glow = gold_glow_layer(rgb, t)
    lit = np.clip(rgb.astype(np.float32) + glow, 0, 255).astype(np.uint8)
    frame = Image.fromarray(lit, "RGB")
    # Slight breathing light on the whole scene
    enhance = 1.0 + 0.035 * math.sin(t * 2 * math.pi)
    frame = ImageEnhance.Brightness(frame).enhance(enhance)

    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    particles(draw, t)
    waveform(draw, t)
    hud(draw, t, fonts)
    scanline(overlay, t)

    out = frame.convert("RGBA")
    out = Image.alpha_composite(out, overlay)
    return out.convert("RGB")


def main() -> None:
    base = load_base()
    rgb = np.array(base)
    fonts = {
        "title": font(22, bold=True),
        "small": font(13),
        "tiny": font(11, bold=True),
    }
    work = Path(tempfile.mkdtemp(prefix="lexcloud-gif-"))
    try:
        for i in range(N_FRAMES):
            t = i / N_FRAMES
            compose_frame(base, rgb, t, fonts).save(work / f"f{i:03d}.png")
        OUT.parent.mkdir(parents=True, exist_ok=True)
        palette = work / "palette.png"
        pattern = str(work / "f%03d.png")
        fps = round(1000 / DURATION_MS, 2)
        vf_use = (
            f"fps={fps},scale={W}:{H}:flags=lanczos,"
            "split[s0][s1];[s0]palettegen=max_colors=64:stats_mode=full[p];"
            "[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
        )
        subprocess.check_call(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-framerate",
                str(fps),
                "-i",
                pattern,
                "-vf",
                vf_use,
                "-loop",
                "0",
                str(OUT),
            ]
        )
    finally:
        shutil.rmtree(work, ignore_errors=True)
    gif = Image.open(OUT)
    print(OUT, OUT.stat().st_size, gif.size, gif.n_frames)


if __name__ == "__main__":
    main()
