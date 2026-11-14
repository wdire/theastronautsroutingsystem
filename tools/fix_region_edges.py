"""Find and repair smeared edges in the region tiles.

When a tile is sampled past the end of its source window and the sampler clamps, the last
real row or column is repeated to the tile edge: streaks of colour and height that frame
the region on the globe. A smeared column equals its neighbour along its whole length (exactly in lossless terrain;
within compression noise in imagery, see region.smear_flags).

    python tools/fix_region_edges.py              check and repair public/region
    python tools/fix_region_edges.py --dry-run    report only
    python tools/fix_region_edges.py --self-test  clamp a scratch copy on purpose, repair it

For each zoom of img and terrain this stitches the tiles, walks in from each side to where
real data begins, and refills everything outside from the planet package (planetImg,
planetTerrain), colour-gain matched (imagery) or level-offset matched (terrain) along the
edge and feathered over 0.35 degrees inside it. build_region.py --edges runs the same code.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import sys

import numpy as np

import region as rg
from region import OUT, TILE, Grid, log

FEATHER_DEG = 0.35
PLANET = {"img": ("planetImg", 4), "terrain": ("planetTerrain", 3)}
TERRAIN_QUANTUM = 0.125


def data_window(kind, z, rect, root):
    """Pixels of smear on each side of a zoom's tile rectangle: (west, north, east, south).

    Walks in from each side one row or column of tiles at a time, so a deep zoom is never
    stitched whole just to be checked."""
    x0, y0, x1, y1 = rect
    terrain = kind == "terrain"

    def walk(side):
        total = 0
        steps = range(x0, x1 + 1) if side in "we" else range(y0, y1 + 1)
        steps = steps if side in "wn" else reversed(steps)
        for t in steps:
            strip = (t, y0, t, y1) if side in "we" else (x0, t, x1, t)
            m = rg.read_mosaic(kind, z, strip, root, terrain=terrain)
            eq = rg.smear_flags(m, 1 if side in "we" else 0, terrain)
            if side in "es":
                eq = eq[::-1]
            n = 0
            while n < len(eq) and eq[n]:
                n += 1
            total += n
            if n < len(eq):  # real data begins inside this strip
                break
        # the last flagged line is the real one that was repeated
        return total - 1 if total >= rg.SMEAR_MIN[terrain] else 0

    return walk("w"), walk("n"), walk("e"), walk("s")


def planet_layer(kind, grid, root):
    """The planet package resampled onto a grid (cubic)."""
    product, z = PLANET[kind]
    w, s, e, n = grid.bounds()
    eps = 1e-6
    rect = rg.tiles_for_box((w + eps, max(s, -85.0) + eps, e - eps, min(n, 85.0) - eps), z)
    # one tile of margin where the planet has it, so the cubic never clamps
    m = (1 << z) - 1
    rect = (max(0, rect[0] - 1), max(0, rect[1] - 1), min(m, rect[2] + 1), min(m, rect[3] + 1))
    mosaic = rg.read_mosaic(product, z, rect, root, terrain=(kind == "terrain"))
    fr, fc = grid.frac_in(Grid.of_tiles(z, rect))
    return rg.sample_sep(np.asarray(mosaic, dtype=np.float32), fr, fc, order=3)


def refill(m, grid, smear, kind, root):
    """Replace everything outside the real-data window with the matched planet layer,
    feathered over FEATHER_DEG inside the window's smeared edges."""
    west, north, east, south = smear
    h, w = m.shape[:2]
    real = np.asarray(m, dtype=np.float32)
    planet = planet_layer(kind, grid, root)
    lons, lats = grid.lons(), grid.lats()
    # distance, in degrees, inside each edge where the data ends (large where it does not)
    big = 1e9
    dx = np.full(w, big)
    dy = np.full(h, big)
    if west:
        dx = np.minimum(dx, lons - lons[west])
    if east:
        dx = np.minimum(dx, lons[w - 1 - east] - lons)
    if north:
        dy = np.minimum(dy, lats[north] - lats)
    if south:
        dy = np.minimum(dy, lats - lats[h - 1 - south])
    d = np.minimum(dx[None, :], dy[:, None])
    b = grid.bounds()
    feather = min(FEATHER_DEG, 0.25 * min(b[2] - b[0], b[3] - b[1]))  # a small cover gets a narrower feather
    wgt = rg.smoothstep(d / feather).astype(np.float32)  # 0 at and beyond the edge, 1 well inside
    band = (d > 0) & (d < feather)
    if kind == "terrain":
        off = float((real - planet)[band].mean()) if band.any() else 0.0
        matched = planet + off
        note = f"level offset {off:+.1f} m"
        out = wgt * real + (1 - wgt) * matched
    else:
        gain = real[band].mean(axis=0) / np.maximum(planet[band].mean(axis=0), 1.0) if band.any() else np.ones(3)
        matched = planet * gain.astype(np.float32)
        note = "colour gain " + ", ".join(f"{g:.2f}" for g in gain)
        out = np.clip(wgt[..., None] * real + (1 - wgt[..., None]) * matched, 0, 255)
    return out, note


def fix(root=None, dry_run=False):
    """Check every zoom of img and terrain; repair the smeared ones. Returns the list of
    'product/zoom' that needed it."""
    root = pathlib.Path(root or OUT)
    found = []
    for kind in ("img", "terrain"):
        pdir = root / kind
        if not pdir.is_dir():
            continue
        for zdir in sorted((d for d in pdir.iterdir() if d.name.isdigit()), key=lambda d: int(d.name)):
            z = int(zdir.name)
            tiles = [(int(p.parent.name), int(p.stem)) for p in zdir.glob("*/*.webp")]
            if not tiles:
                continue
            xs, ys = [t[0] for t in tiles], [t[1] for t in tiles]
            rect = (min(xs), min(ys), max(xs), max(ys))
            if len(tiles) != (rect[2] - rect[0] + 1) * (rect[3] - rect[1] + 1):
                log(f"  {kind}/{z}: tiles do not form a rectangle; skipped")
                continue
            smear = data_window(kind, z, rect, root)
            if not any(smear):
                continue
            found.append(f"{kind}/{z}")
            west, north, east, south = smear
            log(f"  {kind}/{z}: smeared edge, {west} px west, {north} px north, {east} px east, {south} px south")
            if dry_run:
                continue
            grid = Grid.of_tiles(z, rect)
            m = rg.read_mosaic(kind, z, rect, root, terrain=(kind == "terrain"))
            out, note = refill(m, grid, smear, kind, root)
            n = rg.write_tiles(kind, z, grid, out, rect, kind, quantum=TERRAIN_QUANTUM, root=root)
            log(f"  {kind}/{z}: refilled from the planet package ({note}), {n} tiles rewritten")
    if not found:
        log("edges: no smeared rows or columns; every region tile holds real data to its edge")
    return found


def self_test():
    """Clamp a copy of real tiles on purpose and check that the repair removes the smear."""
    scratch = rg.CACHE / "edge_selftest"
    if scratch.exists():
        shutil.rmtree(scratch)
    for product, z in PLANET.values():
        shutil.copytree(OUT / product / str(z), scratch / product / str(z))
    made = []
    for kind, z in (("img", 7), ("terrain", 7)):
        tiles = [(int(p.parent.name), int(p.stem)) for p in (OUT / kind / str(z)).glob("*/*.webp")]
        rect = (min(t[0] for t in tiles), min(t[1] for t in tiles), max(t[0] for t in tiles), max(t[1] for t in tiles))
        m = rg.read_mosaic(kind, z, rect, OUT, terrain=(kind == "terrain")).astype(np.float32)
        h, w = m.shape[:2]
        west, south = 150, 90  # pretend the source ended here and the sampler clamped
        m[:, :west] = m[:, west : west + 1]
        m[h - south :] = m[h - south - 1 : h - south]
        grid = Grid.of_tiles(z, rect)
        rg.write_tiles(kind, z, grid, m, rect, kind, quantum=0.25, root=scratch)
        made.append((kind, z, rect))
    import check_region

    def flagged():
        tiles = [(k, z, x, y) for k, z, r in made for x in range(r[0], r[2] + 1) for y in range(r[1], r[3] + 1)]
        return sorted(t["key"] for t in check_region.check_tiles(scratch, tiles) if any("smear" in p for p in t["problems"]))

    seen_before = flagged()
    before = fix(scratch, dry_run=True)
    fix(scratch)
    after = fix(scratch, dry_run=True)
    seen_after = flagged()
    ok = len(before) == 2 and not after and len(seen_before) >= 10 and not seen_after
    log(f"  check_region.py's tile test flagged {len(seen_before)} tiles in the clamped copy and {len(seen_after)} after the repair")
    log("self-test:", "passed" if ok else "FAILED", f"(smeared before: {before}; after: {after})")
    return ok


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=str(OUT), help="package directory (default public/region)")
    ap.add_argument("--dry-run", action="store_true", help="report, change nothing")
    ap.add_argument("--self-test", action="store_true")
    a = ap.parse_args()
    if a.self_test:
        sys.exit(0 if self_test() else 1)
    fix(a.root, a.dry_run)
