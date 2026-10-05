#!/usr/bin/env python3
"""Generate CanaryGrid's deterministic vector wordmark from a Latin script font."""

from pathlib import Path
from xml.sax.saxutils import escape

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[1]
FONT = Path("/System/Library/Fonts/Supplemental/Brush Script.ttf")
WORD = "canary"
BRAND = "#2563eb"


def word_paths(font: TTFont) -> tuple[list[tuple[str, float]], float]:
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    metrics = font["hmtx"].metrics
    paths: list[tuple[str, float]] = []
    cursor = 0.0

    for character in WORD:
        glyph_name = cmap[ord(character)]
        pen = SVGPathPen(glyphs)
        glyphs[glyph_name].draw(pen)
        paths.append((pen.getCommands(), cursor))
        advance, _ = metrics[glyph_name]
        cursor += advance * 0.88

    return paths, cursor


def render_wordmark(font: TTFont) -> str:
    paths, width = word_paths(font)
    units = font["head"].unitsPerEm
    scale = 45 / units
    translated = "\n".join(
        f'    <path d="{escape(path)}" transform="translate({64 + x * scale:.3f} 53) '
        f'scale({scale:.6f} {-scale:.6f})" />'
        for path, x in paths
    )
    view_width = 78 + width * scale

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 8 {view_width:.0f} 52" role="img" aria-labelledby="title description">
  <title id="title">CanaryGrid</title>
  <desc id="description">A mathematical grid mark followed by the cursive word canary.</desc>
  <g fill="{BRAND}">
    <rect x="8" y="18" width="9" height="9" rx="2" opacity=".38" />
    <rect x="21" y="18" width="9" height="9" rx="2" opacity=".62" />
    <rect x="34" y="18" width="9" height="9" rx="2" />
    <rect x="8" y="31" width="9" height="9" rx="2" opacity=".62" />
    <rect x="21" y="31" width="9" height="9" rx="2" />
    <rect x="34" y="31" width="9" height="9" rx="2" opacity=".62" />
    <rect x="8" y="44" width="9" height="9" rx="2" />
    <rect x="21" y="44" width="9" height="9" rx="2" opacity=".62" />
    <path d="M34 53 C47 51 50 39 58 35 C53 44 55 50 64 52 C55 56 45 58 34 53Z" />
{translated}
  </g>
</svg>
"""


def render_mark() -> str:
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-labelledby="title">
  <title id="title">CanaryGrid</title>
  <rect width="64" height="64" rx="14" fill="{BRAND}" />
  <g fill="white">
    <rect x="13" y="13" width="10" height="10" rx="2" opacity=".55" />
    <rect x="27" y="13" width="10" height="10" rx="2" opacity=".78" />
    <rect x="41" y="13" width="10" height="10" rx="2" />
    <rect x="13" y="27" width="10" height="10" rx="2" opacity=".78" />
    <rect x="27" y="27" width="10" height="10" rx="2" />
    <rect x="41" y="27" width="10" height="10" rx="2" opacity=".78" />
    <rect x="13" y="41" width="10" height="10" rx="2" />
    <rect x="27" y="41" width="10" height="10" rx="2" opacity=".78" />
    <path d="M41 51 C51 49 53 40 58 35 C55 45 58 49 62 51 C54 56 47 56 41 51Z" />
  </g>
</svg>
"""


def main() -> None:
    if not FONT.exists():
        raise SystemExit(f"Required source font was not found: {FONT}")
    font = TTFont(FONT)
    public = ROOT / "public"
    public.mkdir(exist_ok=True)
    (public / "canarygrid-logo.svg").write_text(render_wordmark(font), encoding="utf-8")
    (public / "canarygrid-mark.svg").write_text(render_mark(), encoding="utf-8")


if __name__ == "__main__":
    main()
