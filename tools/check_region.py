"""Prove the tile package under public/region is whole.

    python tools/check_region.py [--root public/region]

Checks, and prints the result of each:
  1. every tile listed in coverage.json exists and decodes at 256 x 256 (and no tile sits
     on disk unlisted); the version matches the sha1 of every tile's path and size;
  2. no imagery tile is a single flat colour;
  3. no tile has smeared edges: a run of rows or columns, reaching the tile edge, each
     equal to its neighbour along its whole length (what clamping past the end of a source
     window leaves). Exact in lossless terrain; within compression noise in imagery
     (region.smear_flags). The test is proved on a deliberately clamped copy by
     fix_region_edges.py --self-test;
  4. terrain decodes to plausible Mars elevations: planet range, the Jezero floor near
     -2,600 m at every zoom that covers it, the rim higher, zooms agreeing with each other
     and no step where a finer product begins;
  5. total size per product and zoom.
Exit status 0 only if every check passes.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
from concurrent.futures import ThreadPoolExecutor

import numpy as np

import region as rg
from region import OUT, TILE, log

FLOOR = (77.45, 18.44)  # Jezero floor, east of the delta
RIM = (77.03, 18.47)  # the western rim crest
DELTA = (77.36, 18.50)  # top of the western delta
OUTSIDE = (79.5, 21.0)  # Nili Planum, well outside the crater


def confirmed_smear(root, product, z, x, y, a, terrain):
    """Length in lines of a smear in this tile, 0 if none.

    Terrain repeats exactly, so the tile alone settles it. In lossy imagery a featureless
    tile can pass for a smear, so a suspect is tested again stitched to its neighbours
    along the repeated lines: the end of a source window is a straight line that crosses
    them too, while a patch of smooth ground does not."""
    worst = 0
    for axis in (0, 1):
        n = rg.edge_run(rg.smear_flags(a, axis, terrain))
        if n < rg.SMEAR_MIN[terrain]:
            continue
        if not terrain:
            parts = []
            for d in (-1, 0, 1):
                nx, ny = (x + d, y) if axis == 0 else (x, y + d)
                p = rg.tile_path(product, z, nx, ny, root)
                if d == 0:
                    parts.append(a)
                elif p.exists():
                    parts.append(rg.load_tile(p)[..., :3])
            if len(parts) > 1:
                n = rg.edge_run(rg.smear_flags(np.concatenate(parts, axis=1 - axis), axis, False))
                if n < rg.SMEAR_MIN[False]:
                    continue
        worst = max(worst, n)
    return worst


def check_tile(job):
    product, z, x, y, path, terrain, alpha, root = job
    r = {"key": f"{product}/{z}/{x}/{y}", "product": product, "z": z, "size": 0, "problems": []}
    if not path.exists():
        r["problems"].append("missing")
        return r
    r["size"] = path.stat().st_size
    try:
        a = rg.load_tile(path)
    except Exception as e:
        r["problems"].append(f"does not decode ({e})")
        return r
    if a.shape[0] != TILE or a.shape[1] != TILE:
        r["problems"].append(f"is {a.shape[1]} x {a.shape[0]}")
        return r
    if alpha:  # overlays: transparent where there is no data, so only decoding is checked
        return r
    rgb = a[..., :3]
    if terrain:
        e = rg.terrarium_decode(rgb)
        r["min"], r["max"] = float(e.min()), float(e.max())
        n = confirmed_smear(root, product, z, x, y, e, True)
        if n:
            r["problems"].append(f"smeared edge ({n} rows or columns repeat exactly)")
    else:
        if int(rgb.max()) - int(rgb.min()) < 4 or float(rgb.std()) < 0.5:
            r["problems"].append("single flat colour")
        else:
            n = confirmed_smear(root, product, z, x, y, rgb, False)
            if n:
                r["problems"].append(f"smeared edge ({n} rows or columns repeat)")
    return r


def check_tiles(root, tiles):
    """Check a list of (product, z, x, y). Used by main() and by the edge self-test."""
    jobs = []
    for product, z, x, y in tiles:
        terrain = product.lower().endswith("terrain")
        alpha = product not in ("img", "terrain", "planetImg", "planetTerrain")
        jobs.append((product, z, x, y, rg.tile_path(product, z, x, y, root), terrain, alpha, root))
    with ThreadPoolExecutor(6) as ex:
        return list(ex.map(check_tile, jobs))


def elevation_at(root, cov, product, z, lon, lat):
    """Bilinear height at a point from one zoom, or None if that zoom has no tile there."""
    fx = float(rg.lon_to_tx(lon, z)) * TILE - 0.5
    fy = float(rg.lat_to_ty(lat, z)) * TILE - 0.5
    x0, y0 = int(np.floor(fx)), int(np.floor(fy))
    vals = []
    for py in (y0, y0 + 1):
        for px in (x0, x0 + 1):
            p = rg.tile_path(product, z, px // TILE, py // TILE, root)
            if not p.exists():
                return None
            vals.append(float(rg.load_terrain_tile(p)[py % TILE, px % TILE]))
    tx, ty = fx - x0, fy - y0
    return (vals[0] * (1 - tx) + vals[1] * tx) * (1 - ty) + (vals[2] * (1 - tx) + vals[3] * tx) * ty


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--root", default=str(OUT))
    args = ap.parse_args()
    root = pathlib.Path(args.root)
    failures = []

    def verdict(ok, text):
        log(("PASS  " if ok else "FAIL  ") + text)
        if not ok:
            failures.append(text)

    cov = json.loads((root / "coverage.json").read_text())
    for key in ("version", "boxes", "products"):
        if key not in cov:
            raise SystemExit(f"coverage.json has no {key}")
    boxes = cov["boxes"]
    shape_ok = all(k in boxes and len(boxes[k]) == 4 for k in ("region", "core", "crater", "hirise")) and all(
        p in cov["products"] for p in ("img", "terrain", "planetImg", "planetTerrain")
    )
    verdict(shape_ok, "coverage.json has version, the four boxes and the four products")
    for k in ("region", "core", "crater", "hirise"):
        log(f"      {k:7s} {boxes[k]}")
    nest = lambda a, b: a[0] >= b[0] and a[1] >= b[1] and a[2] <= b[2] and a[3] <= b[3]  # noqa: E731
    verdict(nest(boxes["hirise"], boxes["crater"]) and nest(boxes["crater"], boxes["core"]) and nest(boxes["core"], boxes["region"]), "boxes nest: HiRISE in crater in core in region")

    tiles, listed = [], set()
    for product, zooms in cov["products"].items():
        for z, rects in zooms.items():
            for x0, y0, x1, y1 in rects:
                for x in range(x0, x1 + 1):
                    for y in range(y0, y1 + 1):
                        listed.add(rg.tile_path(product, int(z), x, y, root))
                        tiles.append((product, int(z), x, y))
    jobs = tiles
    results = check_tiles(root, tiles)

    on_disk = set(root.rglob("*.webp"))
    stray = sorted(str(p.relative_to(root)) for p in on_disk - listed)
    bad = lambda word: [r["key"] for r in results if any(word in p for p in r["problems"])]  # noqa: E731
    missing, undec = bad("missing"), bad("does not decode") + bad(" x ")
    verdict(not missing and not undec, f"all {len(jobs)} tiles listed in coverage.json exist and decode at 256 x 256" + (f"; missing {missing[:5]} bad {undec[:5]}" if missing or undec else ""))
    verdict(not stray, "no tile on disk is missing from coverage.json" + (f"; stray {stray[:5]} ({len(stray)})" if stray else ""))
    version, n = rg.package_version(root)
    verdict(version == cov["version"], f"version {cov['version'][:12]} is the sha1 of the {n} tile paths and sizes")
    flat = bad("flat")
    n_img = sum(1 for r in results if not r["product"].lower().endswith("terrain"))
    verdict(not flat, f"no imagery tile is a single flat colour ({n_img} checked)" + (f"; flat {flat[:8]} ({len(flat)})" if flat else ""))
    smear = bad("smeared")
    verdict(not smear, f"no tile has smeared edges: no run of rows or columns repeats its neighbour along its whole length ({len(jobs)} checked)" + (f"; smeared {smear[:8]} ({len(smear)})" if smear else ""))

    # Elevations.
    def rng(product):
        rs = [r for r in results if r["product"] == product and "min" in r]
        return (min(r["min"] for r in rs), max(r["max"] for r in rs)) if rs else (None, None)

    lo, hi = rng("planetTerrain")
    verdict(lo is not None and -8600 < lo < -6500 and 19000 < hi < 21500, f"planet heights run {lo:.0f} to {hi:.0f} m (Hellas floor to Olympus Mons)")
    lo, hi = rng("terrain")
    verdict(lo is not None and -6000 < lo < -2500 and -1500 < hi < 5000, f"region heights run {lo:.0f} to {hi:.0f} m")

    zooms = sorted(int(z) for z in cov["products"]["terrain"])
    table = {}
    for name, (lon, lat) in (("floor", FLOOR), ("delta", DELTA), ("rim", RIM), ("outside", OUTSIDE)):
        table[name] = {z: elevation_at(root, cov, "terrain", z, lon, lat) for z in zooms}
        table[name][3] = elevation_at(root, cov, "planetTerrain", 3, lon, lat)
        log(f"      {name:8s} " + "  ".join(f"z{z} {v:.0f} m" for z, v in sorted(table[name].items()) if v is not None))
    fl = [v for z, v in table["floor"].items() if v is not None and z >= 6]
    rm = [v for z, v in table["rim"].items() if v is not None and z >= 6]
    verdict(len(fl) >= 6 and all(-2750 < v < -2450 for v in fl), f"Jezero floor reads {min(fl):.0f} to {max(fl):.0f} m at zoom 6 to 14 (about -2,600 m expected)")
    verdict(bool(rm) and min(rm) > max(fl) + 300, f"the western rim is higher: {min(rm):.0f} to {max(rm):.0f} m")
    verdict(max(fl) - min(fl) < 40, f"zooms agree at the floor point within {max(fl) - min(fl):.0f} m")

    # No step where a finer product begins: along the edge of each finer rectangle the
    # finer zoom, averaged down, must match its coarser ancestor.
    steps = []
    for zf, zc in ((10, 9), (13, 10), (14, 13)):
        rf = cov["products"]["terrain"].get(str(zf))
        rc = cov["products"]["terrain"].get(str(zc))
        if not rf or not rc:
            continue
        x0, y0, x1, y1 = rf[0]
        fine = rg.read_mosaic("terrain", zf, (x0, y0, x1, y1), root, terrain=True)
        k = 1 << (zf - zc)
        cx0, cy0, cx1, cy1 = x0 // k, y0 // k, x1 // k, y1 // k
        coarse = rg.read_mosaic("terrain", zc, (cx0, cy0, cx1, cy1), root, terrain=True)
        gf = rg.Grid.of_tiles(zf, (x0, y0, x1, y1))
        fr, fc = gf.frac_in(rg.Grid.of_tiles(zc, (cx0, cy0, cx1, cy1)))
        up = rg.sample_sep(coarse, fr, fc, order=1)
        d = fine - up
        ring = np.concatenate([d[:8].ravel(), d[-8:].ravel(), d[:, :8].ravel(), d[:, -8:].ravel()])
        steps.append((zf, zc, float(np.abs(ring).mean()), float(np.abs(ring).max()), float(d.mean())))
        log(f"      zoom {zf} against zoom {zc} along the outer 8 px: mean |difference| {steps[-1][2]:.2f} m, largest {steps[-1][3]:.1f} m; whole-area mean {steps[-1][4]:+.2f} m")
    verdict(bool(steps) and all(s[2] < 6 and abs(s[4]) < 5 for s in steps), "no level step where a finer elevation product begins")

    # Sizes.
    log("")
    log("size per product and zoom")
    total = 0
    for product in cov["products"]:
        rs = [r for r in results if r["product"] == product]
        size = sum(r["size"] for r in rs)
        total += size
        zs = sorted({r["z"] for r in rs})
        log(f"  {product:14s} {len(rs):5d} tiles  {size / 1e6:7.1f} MB  zoom {zs[0]} to {zs[-1]}")
        for z in zs:
            zr = [r for r in rs if r["z"] == z]
            log(f"      z{z:<2d} {len(zr):5d} tiles  {sum(r['size'] for r in zr) / 1e6:7.2f} MB  {cov['products'][product][str(z)]}")
    log(f"  total          {len(results):5d} tiles  {total / 1e6:7.1f} MB")
    log("")
    if failures:
        log(f"FAILED: {len(failures)} check(s)")
        for f in failures:
            log("  - " + f)
        return 1
    log("ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
