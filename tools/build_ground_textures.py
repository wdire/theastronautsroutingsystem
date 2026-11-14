"""Close-up ground detail for Rover View -> public/textures/ground/*.webp

Three CC0 materials from ambientCG, used only for their shape: the colour of the ground comes from
HiRISE and the orbital mosaics, never from these photographs. Each material is packed into one
1024 px RGBA WebP:

  R, G  surface normal x and y (OpenGL convention; z is rebuilt in the shader)
  B     brightness of the photograph, its mean moved to 128 and its spread normalised
  A     height (the material's displacement map)

Run: tools/.venv/bin/python tools/build_ground_textures.py
"""

from __future__ import annotations

import io
import pathlib
import sys
import zipfile

from PIL import Image, ImageOps, ImageStat

from build_common import ROOT, add_source, fetch

OUT = ROOT / "public" / "textures" / "ground"
SIZE = 1024

# out name -> (ambientCG id, what it stands for)
MATERIALS = {
    "regolith": ("Ground079S", "fine regolith with grit and small pebbles"),
    "gravel": ("Ground110", "a pebble-strewn pavement"),
    "bedrock": ("Rock062", "cracked, weathered bedrock"),
}


def member(z: zipfile.ZipFile, suffix: str) -> Image.Image:
    name = next(n for n in z.namelist() if n.endswith(suffix))
    return Image.open(io.BytesIO(z.read(name)))


def build(out: str, asset: str) -> None:
    url = f"https://ambientcg.com/get?file={asset}_2K-JPG.zip"
    data = fetch(url, name=f"ambientcg-{asset}-2K.zip")
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        colour = member(z, "_Color.jpg").convert("L").resize((SIZE, SIZE), Image.LANCZOS)
        normal = member(z, "_NormalGL.jpg").convert("RGB").resize((SIZE, SIZE), Image.LANCZOS)
        height = member(z, "_Displacement.jpg").convert("L").resize((SIZE, SIZE), Image.LANCZOS)
    stat = ImageStat.Stat(colour)
    mean, sd = stat.mean[0], max(1.0, stat.stddev[0])
    # Brightness as a ratio around the mean: 128 is the material's own average, 32 steps one spread.
    lum = colour.point(lambda v: max(0, min(255, round(128 + (v - mean) / sd * 32))))
    height = ImageOps.autocontrast(height, cutoff=0.5)
    r, g, _ = normal.split()
    packed = Image.merge("RGBA", (r, g, lum, height))
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / f"{out}.webp"
    packed.save(target, "WEBP", quality=90, method=6, exact=True)
    print(f"{target.relative_to(ROOT)} {target.stat().st_size // 1024} KB")


def main() -> int:
    for out, (asset, what) in MATERIALS.items():
        build(out, asset)
    add_source(
        id="ground-detail-textures",
        name="Close-up ground detail (ambientCG Ground079S, Ground110, Rock062)",
        mission="ambientCG (Lennart Demes)",
        product=", ".join(f"{a} ({w})" for a, w in MATERIALS.values()),
        url="https://ambientcg.com/",
        licence="CC0 1.0 (public domain dedication)",
        notes=(
            "Shape only: their surface normals, height and brightness add grain below the 25 cm of HiRISE "
            "within a few tens of metres of the viewer in Rover View. They are photographs of Earth materials, "
            "drawn in, not measured; the colour comes from the orbital data."
        ),
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
