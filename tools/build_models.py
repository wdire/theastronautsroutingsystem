"""NASA 3D models for the visor -> public/models/*.glb

Source: github.com/nasa/NASA-3D-Resources ("3D Models/<name>/<name>.glb").
Each model goes through `npx @gltf-transform/cli optimize` with meshopt
compression and 1024 px WebP textures. Meshes are simplified by half, except
the Z2 suit: its thin parts tear, so it is not simplified.

Run: python tools/build_models.py            (needs Node and npx on PATH)
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import urllib.parse

from build_common import CACHE, MODELS, ROOT, add_source, fetch

RAW = "https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master/"
REPO = "https://github.com/nasa/NASA-3D-Resources"
GLTF_TRANSFORM = "@gltf-transform/cli@4"

# out name -> (path in the repo, simplify?, what it is used for)
MODELS_WANTED = {
    "perseverance": ("3D Models/Mars 2020 Perseverance Rover/Mars 2020 Perseverance Rover.glb", True,
                     "Robotic rover in the visor."),
    "ingenuity": ("3D Models/Ingenuity Mars Helicopter/Ingenuity Mars Helicopter.glb", True,
                  "Helicopter in the visor."),
    "sev": ("3D Models/Space Exploration Vehicle/Space Exploration Vehicle.glb", True,
            "Pressurised rover in the visor."),
    "habitat": ("3D Models/Habitat Demonstration Unit/Habitat Demonstration Unit (part 1).glb", True,
                "The base beside the start of a route. Modelled in centimetres: drawn at scale 0.03."),
    "z2": ("3D Models/Z2 Spacesuit/Z2 Spacesuit.glb", False,
           "The suited walkers. Not simplified: thin parts tear."),
}


def optimize(src, dst, simplify: bool) -> None:
    cmd = [
        "npx", "--yes", GLTF_TRANSFORM, "optimize", str(src), str(dst),
        "--compress", "meshopt",
        "--texture-compress", "webp",
        "--texture-size", "1024",
        "--simplify", "true" if simplify else "false",
    ]
    if simplify:
        cmd += ["--simplify-ratio", "0.5", "--simplify-error", "0.001"]
    print(" ".join(cmd[2:]))
    subprocess.run(cmd, check=True, cwd=ROOT)


def main() -> int:
    if not shutil.which("npx"):
        print("npx not found: install Node, then run again", file=sys.stderr)
        return 1
    MODELS.mkdir(parents=True, exist_ok=True)
    only = set(sys.argv[1:])
    failed, total = [], 0
    for out, (path, simplify, use) in MODELS_WANTED.items():
        if only and out not in only:
            continue
        url = RAW + urllib.parse.quote(path)
        try:
            fetch(url, f"models/{out}.src.glb", timeout=300)
            src = CACHE / "models" / f"{out}.src.glb"
            dst = MODELS / f"{out}.glb"
            optimize(src, dst, simplify)
        except Exception as e:
            print(f"FAILED {out}: {e}", file=sys.stderr)
            failed.append(out)
            continue
        size = dst.stat().st_size
        total += size
        print(f"wrote public/models/{out}.glb  {size / 1e6:.2f} MB (from {src.stat().st_size / 1e6:.1f} MB)")
        add_source(
            id=f"model-{out}",
            name=path.split("/")[-1].removesuffix(".glb") + " 3D model",
            mission="NASA 3D Resources",
            product=path,
            url=f"{REPO}/tree/master/" + urllib.parse.quote(path.rsplit("/", 1)[0]),
            licence="NASA media, free to use under NASA's media usage guidelines (not copyrighted in the United States).",
            notes=f"{use} Optimised with gltf-transform: meshopt compression, 1024 px WebP textures, "
            + ("meshes simplified by half." if simplify else "no mesh simplification."),
        )
    print(f"total {total / 1e6:.2f} MB" + (f"; failed: {', '.join(failed)}" if failed else ""))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
