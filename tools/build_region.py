"""Build the Areo tile package under public/region.

    python tools/build_region.py                 every stage that is not done yet
    python tools/build_region.py --img --force   rebuild one stage
    python tools/build_region.py --edges         only the edge repair (fix_region_edges.py)

Stages: --planet-terrain --planet-img --terrain --terrain-hirise --img --edges --coverage.
Raw downloads are cached under tools/.cache/region and each finished stage leaves a
marker there, so a rerun after a dropped connection picks up where it stopped.

Products (XYZ Web Mercator, 256 px WebP):
  planetTerrain  zoom 0-3    MOLA MEGDR                                    terrarium, lossless
  planetImg      zoom 0-4    Viking MDIM 2.1 colour, hue pulled toward ochre
  terrain        zoom 6-9    HRSC and MOLA blend, 200 m (region)           terrarium, lossless
                 zoom 10     the same, over the core
                 zoom 12-13  Mars 2020 CTX DTM, 20 m (crater)
                 zoom 14     Mars 2020 HiRISE DTM, read at 5 m
  img            zoom 5-8    Viking colour, hue pulled toward ochre (region)
                 zoom 9-10   parent upsampled x high-pass of THEMIS day IR
                 zoom 11-13  parent upsampled x high-pass of CTX (core)
                 zoom 14     parent upsampled x high-pass of the Mars 2020 CTX ortho (crater)
Overlays made by other tools (build_crism.py) are listed by --coverage if they are there.

No tile is ever filled by clamping past the end of its source. Every source window is
read out to the edge of the tiles it feeds (plus a margin), so region tiles hold real data
edge to edge; where a finer product ends inside a tile (the CTX and HiRISE models, the
ortho) it is feathered into the coarser product beneath it, level-matched first. --edges
then looks for smeared edges anyway and would refill them from the planet package.

After a build: python tools/check_region.py, then python tools/sources.py --merge.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import numpy as np
from scipy import ndimage

import region as rg
import region_sources as src
from region import CACHE, CORE, OUT, REGION, TILE, Grid, log

STAGES = ["planet-terrain", "planet-img", "terrain", "terrain-hirise", "img", "edges", "coverage"]
PRODUCTS = ["img", "terrain", "planetImg", "planetTerrain"]

GRADE_PLANET = True  # grade planet and region alike, so the region does not show as a rectangle
FEATHER_DEG = 0.35  # without GRADE_PLANET, the grade fades out over this distance beyond the region box
DETAIL_FLOOR = 90.0  # detail is scaled as if the ground were at least this bright (0..255)
PAD = 8  # pixels of padding on every detail pass
OCHRE = np.array([0.800, 0.565, 0.365], dtype=np.float32)
OCHRE_PULL = 0.62

# Terrarium steps. Fractions of a metre keep slopes smooth where tiles are finer than
# their source; powers of two keep the blue channel cheap to store without loss.
Q_PLANET, Q_REGION, Q_CRATER, Q_HIRISE = 1.0, 0.25, 0.125, 0.0625

# THEMIS is thermal, not visible light: its high-pass is used at reduced strength and with
# a tight limit, or sunlit slopes blow out and warm patches read as albedo.
THEMIS_DETAIL = dict(gain=0.6, lo=0.7, hi=1.4)

BOXES_FILE = CACHE / "boxes.json"


# --------------------------------------------------------------------------------------
# Stage bookkeeping
# --------------------------------------------------------------------------------------


def marker(stage):
    return CACHE / "stages" / f"{stage}.done"


def done(stage, info=None):
    m = marker(stage)
    m.parent.mkdir(parents=True, exist_ok=True)
    m.write_text(json.dumps(info or {}) + "\n")


def load_boxes():
    return json.loads(BOXES_FILE.read_text()) if BOXES_FILE.exists() else {}


def save_boxes(**kw):
    b = load_boxes()
    b.update(kw)
    BOXES_FILE.parent.mkdir(parents=True, exist_ok=True)
    BOXES_FILE.write_text(json.dumps(b, indent=1) + "\n")


def wrap_lon(eq, n=4):
    """Pad a global -180..180 raster by n columns of its other side, so sampling at the
    date line interpolates across it instead of clamping."""
    d = eq.data
    data = np.concatenate([d[:, -n:], d, d[:, :n]], axis=1)
    return rg.EqArray(data, eq.lon0 - n * eq.dlon, eq.lat0, eq.dlon, eq.dlat)


# --------------------------------------------------------------------------------------
# Planet
# --------------------------------------------------------------------------------------


def stage_planet_terrain():
    eq = wrap_lon(src.megdr())
    g = Grid.of_tiles(5, (0, 0, 31, 31))
    m = np.empty((g.h, g.w), dtype=np.float32)
    for r0 in range(0, g.h, 1024):  # sample at zoom 5, then average down: no aliasing
        m[r0 : r0 + 1024] = eq.sample(g.rows(r0, r0 + 1024), order=1)
    n = 0
    for z in (4, 3, 2, 1, 0):
        m = rg.reduce2(m)
        if z <= 3:
            n += rg.write_tiles("planetTerrain", z, Grid.of_tiles(z, (0, 0, (1 << z) - 1, (1 << z) - 1)), m, (0, 0, (1 << z) - 1, (1 << z) - 1), "terrain", Q_PLANET)
    log(f"planetTerrain: {n} tiles, zoom 0 to 3; heights {m.min():.0f} to {m.max():.0f} m at zoom 0")
    return {"tiles": n}


def stage_planet_img():
    # Mercator stretches toward the poles, so the source level rises with latitude: level 4
    # matches zoom 5 at the equator, level 6 keeps the polar rows from being a blur.
    g5 = Grid.of_tiles(5, (0, 0, 31, 31))
    band = 256
    lats = g5.lats()
    level_of = lambda a: 4 if a < 50 else 5 if a < 72 else 6  # noqa: E731
    bands = [(r0, level_of(float(np.abs(lats[r0 : r0 + band]).max()))) for r0 in range(0, g5.h, band)]
    eqs = {}
    for lv in (4, 5, 6):
        for sign in (1, -1):
            rows = [r0 for r0, l in bands if l == lv and np.sign(lats[r0 + band // 2]) == sign]
            if not rows:
                continue
            la = lats[min(rows) : max(rows) + band]
            box = (-180.0, max(-90.0, float(la.min()) - 0.5), 180.0, min(90.0, float(la.max()) + 0.5))
            eq, valid = src.viking(lv, box, 0, f"Viking planet level {lv} {'north' if sign > 0 else 'south'}")
            if not valid.all():
                log(f"  warning: {100 * (1 - valid.mean()):.2f}% of this mosaic is missing")
            eqs[lv, sign] = wrap_lon(eq)
    m = np.empty((g5.h // 2, g5.w // 2, 3), dtype=np.float32)
    for r0, lv in bands:
        gb = g5.rows(r0, r0 + band)
        eq = eqs[lv, int(np.sign(lats[r0 + band // 2]))]
        assert eq.inside(gb, margin=1).all()
        raw = eq.sample(gb, order=1)
        m[r0 // 2 : (r0 + band) // 2] = rg.reduce2(ochre_grade(raw, grade_weight(gb, raw)))
    n = 0
    for z in (4, 3, 2, 1, 0):
        full = (0, 0, (1 << z) - 1, (1 << z) - 1)
        n += rg.write_tiles("planetImg", z, Grid.of_tiles(z, full), m, full, "img")
        m = rg.reduce2(m)
    log(f"planetImg: {n} tiles, zoom 0 to 4")
    return {"tiles": n}


# --------------------------------------------------------------------------------------
# Terrain
# --------------------------------------------------------------------------------------


def fill_invalid(a, ok):
    """Copy the nearest valid value into invalid cells (so interpolation next to a hole
    never mixes in a no-data number). The mask travels separately."""
    if ok.all():
        return a
    idx = ndimage.distance_transform_edt(~ok, return_distances=False, return_indices=True)
    return a[tuple(idx)]


def sample_masked(eq, ok, grid, order=3):
    """Sample a raster with holes: values, and a mask of the targets that sit on real
    data (inside the raster, away from holes)."""
    filled = fill_invalid(np.asarray(eq.data, dtype=np.float32), ok)
    v = eq.sample(grid, order, data=filled)
    m = eq.sample(grid, 1, data=ok.astype(np.float32)) > 0.999
    m &= eq.inside(grid, margin=1.0)
    return v, m


def merge_fine(base, fine, mask, sigma_px, feather_px, name):
    """Lay a finer model over a coarser one: level-match first (the smoothed difference
    is added to the finer model, so its long wavelengths follow the coarser one and there
    is no step), then feather over feather_px inside the edge of the finer data."""
    d = np.where(mask, base - fine, 0).astype(np.float32)
    m = mask.astype(np.float32)
    med = float(np.median((base - fine)[mask]))
    num = ndimage.gaussian_filter(d, sigma_px, mode="constant")
    den = ndimage.gaussian_filter(m, sigma_px, mode="constant")
    corr = num / np.maximum(den, 1e-3)
    resid = (base - fine - corr)[mask]
    w = rg.smoothstep(ndimage.distance_transform_edt(mask) / feather_px).astype(np.float32)
    log(
        f"  {name}: median level offset {med:+.1f} m (coarser minus finer), local correction "
        f"{float(corr[mask].min()):+.1f} to {float(corr[mask].max()):+.1f} m, residual rms {float(resid.std()):.1f} m"
    )
    return base + w * (fine + corr - base), med


def load_hrsc():
    """The HRSC and MOLA blend over the zoom 6 tiles of the region, as float metres."""
    cover6 = rg.tiles_for_box(REGION, 6)
    eq_h, nodata = src.hrsc(rg.rect_bounds(6, cover6))
    h = eq_h.data.astype(np.float32)
    ok = eq_h.data != (nodata if nodata is not None else -32768)
    if not ok.all():
        log(f"  HRSC window: {int((~ok).sum())} no-data cells filled from their neighbours")
        h = fill_invalid(h, ok)
    return rg.EqArray(h, eq_h.lon0, eq_h.lat0, eq_h.dlon, eq_h.dlat)


def crater_composite(eq_h):
    """Zoom 13 over the zoom 12 tiles of the crater box: the CTX model laid on the blend.
    Returns (crater box, zoom 12 tile rectangle, padded grid, heights on it, offset)."""
    eq_c, ok_c = src.ctx_dtm()
    crater = src.clip_box(src.valid_box(eq_c, ok_c), CORE)
    cover12 = rg.tiles_for_box(crater, 12)
    g13p = Grid.of_tiles(13, rg.child_rect(cover12)).padded(PAD)
    base = eq_h.sample(g13p, order=3)
    fine, mask = sample_masked(eq_c, ok_c, g13p)
    res13 = rg.ground_res(13, 18.45)
    m13p, off = merge_fine(base, fine, mask, 1500 / res13, 600 / res13, "CTX DTM on the HRSC and MOLA blend")
    return crater, cover12, g13p, m13p, off


def stage_terrain():
    """Zoom 6 to 13: region, core and crater."""
    n_by_zoom = {}
    eq_h = load_hrsc()

    # Region, zoom 9 down to 6: built at zoom 9 over the whole zoom 6 cover, then averaged.
    rect = rg.tiles_for_box(REGION, 6)
    for _ in range(3):
        rect = rg.child_rect(rect)
    g = Grid.of_tiles(9, rect)
    assert eq_h.inside(g, margin=2).all(), "HRSC window does not cover the zoom 6 tiles"
    m = eq_h.sample(g, order=3)
    for z in (9, 8, 7, 6):
        n_by_zoom[z] = rg.write_tiles("terrain", z, g, m, rg.tiles_for_box(REGION, z), "terrain", Q_REGION)
        if z > 6:
            m = rg.reduce2(m)
            g = g.parent()

    # Core, zoom 10.
    rect10 = rg.tiles_for_box(CORE, 10)
    g10 = Grid.of_tiles(10, rect10)
    n_by_zoom[10] = rg.write_tiles("terrain", 10, g10, eq_h.sample(g10, order=3), rect10, "terrain", Q_REGION)

    # Crater, zoom 13 and 12: the CTX model over the blend.
    crater, cover12, g13p, m13p, off_ctx = crater_composite(eq_h)
    g13 = g13p.padded(-PAD)
    m13 = m13p[PAD:-PAD, PAD:-PAD]
    n_by_zoom[13] = rg.write_tiles("terrain", 13, g13, m13, rg.tiles_for_box(crater, 13), "terrain", Q_CRATER)
    n_by_zoom[12] = rg.write_tiles("terrain", 12, g13.parent(), rg.reduce2(m13), cover12, "terrain", Q_CRATER)

    save_boxes(crater=src.round_box(crater), ctx_level_offset_m=round(off_ctx, 2))
    log("terrain:", ", ".join(f"z{z} {n}" for z, n in sorted(n_by_zoom.items())))
    log("  crater box", src.round_box(crater))
    return {"tiles": n_by_zoom}


def stage_terrain_hirise():
    """Zoom 14: the 1 m HiRISE model (read at 5 m) over the crater composite."""
    eq_hi, ok_hi = src.hirise_dtm()
    hirise = src.valid_box(eq_hi, ok_hi)
    _, _, g13p, m13p, _ = crater_composite(load_hrsc())
    rect14 = rg.tiles_for_box(hirise, 14)
    g14 = Grid.of_tiles(14, rect14)
    fr, fc = g14.frac_in(g13p)
    assert rg.inside(fr, fc, m13p.shape, margin=1).all(), "the HiRISE tiles reach past the crater composite"
    base14 = rg.sample_sep(m13p, fr, fc, order=3)
    fine14, mask14 = sample_masked(eq_hi, ok_hi, g14)
    res14 = rg.ground_res(14, 18.45)
    m14, off_hi = merge_fine(base14, fine14, mask14, 300 / res14, 150 / res14, "HiRISE DTM on the crater composite")
    n = rg.write_tiles("terrain", 14, g14, m14, rect14, "terrain", Q_HIRISE)
    save_boxes(hirise=src.round_box(hirise), hirise_level_offset_m=round(off_hi, 2))
    log(f"terrain: z14 {n}; HiRISE box", src.round_box(hirise))
    return {"tiles": {14: n}}


# --------------------------------------------------------------------------------------
# Imagery: the detail pyramid
# --------------------------------------------------------------------------------------


def soft_clip(rgb):
    """Keep colours in range without flat patches: where a channel would pass 255 the
    pixel is half dimmed (hue kept) and half moved toward the grey of its own luminance,
    so bright dust stays pale tan instead of burning out to orange or white."""
    rgb = np.maximum(rgb, 0)
    mx = rgb.max(axis=-1)
    over = mx > 255.0
    if over.any():
        o = rgb[over]
        m = mx[over][:, None]
        o = o * (0.5 + 0.5 * 255.0 / m)  # half of the way down by dimming
        lum = np.minimum(rg.luminance(o), 255.0)[:, None]
        m = o.max(axis=-1, keepdims=True)
        t = np.where(m > 255.0, (255.0 - lum) / np.maximum(m - lum, 1e-3), 1.0)
        rgb[over] = lum + (o - lum) * t
    return np.clip(rgb, 0, 255)


def roll_off(lum, knee=160.0, span=90.0):
    """Compress highlights: Viking's sunlit rims sit at full white, and upsampled thirty
    times they would be blank smears."""
    over = np.maximum(lum - knee, 0)
    return np.minimum(lum, knee) + over / (1 + over / span)


def ochre_grade(rgb, weight):
    """Pull the hue toward ochre, keep the luminance (highlights rolled off). weight
    (h, w) in 0..1: the grade fades out with it."""
    lum = rg.luminance(rgb)
    lum2 = lum + (roll_off(lum) - lum) * weight
    target = (OCHRE / rg.luminance(OCHRE)) * lum2[..., None]
    out = rgb + (target - rgb) * (OCHRE_PULL * weight)[..., None]
    out *= (lum2 / np.maximum(rg.luminance(out), 1e-3))[..., None]
    return soft_clip(out)


def grade_weight(grid, rgb):
    """How much of the ochre grade each pixel gets.

    With GRADE_PLANET the whole planet is graded alike (a graded region on an ungraded
    planet shows from orbit as an ochre rectangle on mauve), except polar ice: bright,
    colourless pixels poleward of about 60 degrees keep their white. Without it the grade
    covers the region box and fades out over FEATHER_DEG beyond it."""
    if not GRADE_PLANET:
        return (1 - rg.smoothstep(rg.box_distance_deg(grid.lons(), grid.lats(), REGION) / FEATHER_DEG)).astype(np.float32)
    polar = rg.smoothstep((np.abs(grid.lats()) - 50.0) / 15.0).astype(np.float32)[:, None]
    if not polar.any():
        return np.ones((grid.h, grid.w), dtype=np.float32)
    lum = rg.luminance(rgb)
    mx = rgb.max(axis=-1)
    sat = (mx - rgb.min(axis=-1)) / np.maximum(mx, 1.0)
    ice = rg.smoothstep((lum - 140.0) / 50.0) * (1 - rg.smoothstep((sat - 0.10) / 0.15))
    return (1 - polar * ice).astype(np.float32)


def reduce_eq(eq, valid):
    """Halve an 8-bit equirectangular mosaic and its mask."""
    d = eq.data
    h, w = d.shape[0] // 2 * 2, d.shape[1] // 2 * 2
    s = d[0:h:2, 0:w:2].astype(np.uint16) + d[1:h:2, 0:w:2] + d[0:h:2, 1:w:2] + d[1:h:2, 1:w:2]
    v = valid[0:h:2, 0:w:2] & valid[1:h:2, 0:w:2] & valid[0:h:2, 1:w:2] & valid[1:h:2, 1:w:2]
    return rg.EqArray(((s + 2) >> 2).astype(np.uint8), eq.lon0, eq.lat0, eq.dlon * 2, eq.dlat * 2), v


class Detail:
    """A finer greyscale source turned into a normalised high-pass: the ratio of each pixel
    to its local mean (a Gaussian of sigma pixels at the tile's zoom, cut at PAD pixels, so
    a pass padded by PAD gives the same pixels however the area is cut up)."""

    def __init__(self, eq, valid, gain=1.0, sigma=2.5, lo=0.6, hi=1.6):
        self.eq, self.valid, self.gain, self.sigma, self.lo, self.hi = eq, valid, gain, sigma, lo, hi
        self.validf = valid.view(np.uint8)

    def ratio(self, grid):
        """(ratio - 1, weight) on a padded grid."""
        s = self.eq.sample(grid, 1).astype(np.float32) + 1.0
        m = (self.eq.sample(grid, 1, data=self.validf) > 0.999) & self.eq.inside(grid, margin=0.5)
        m = m.astype(np.float32)
        kw = dict(sigma=self.sigma, truncate=PAD / self.sigma, mode="nearest")
        den = ndimage.gaussian_filter(m, **kw)
        mean = ndimage.gaussian_filter(s * m, **kw) / np.maximum(den, 1e-3)
        r = np.clip(s / np.maximum(mean, 4.0), self.lo, self.hi) - 1.0
        w = np.clip((den - 0.75) * 4.0, 0.0, 1.0) * m  # fades out next to missing data
        return r * self.gain, w


def detail_pass(z, rect, parent, parent_grid, details, band=1024):
    """One level of the pyramid: the parent upsampled, times the high-pass of the finer
    source. details is a list of Detail in order of preference; each fills in where the
    ones before it have no data. Worked in bands padded by PAD pixels."""
    g = Grid.of_tiles(z, rect)
    out = np.empty((g.h, g.w, 3), dtype=np.uint8)
    cover = 0.0
    for r0 in range(0, g.h, band):
        gp = g.rows(r0, min(g.h, r0 + band)).padded(PAD)
        fr, fc = gp.frac_in(parent_grid)
        up = rg.sample_sep(parent, fr, fc, order=3)
        total = np.zeros((gp.h, gp.w), dtype=np.float32)
        room = np.ones((gp.h, gp.w), dtype=np.float32)
        for d in details:
            r, w = d.ratio(gp)
            total += r * w * room
            room *= 1 - w
        cover += float((1 - room[PAD:-PAD, PAD:-PAD]).sum())
        # In dark ground a plain ratio leaves detail too faint to survive compression: scale
        # it as if the ground were at least DETAIL_FLOOR bright.
        lum = rg.luminance(up)
        mult = np.clip(1.0 + total * np.maximum(lum, DETAIL_FLOOR) / np.maximum(lum, 1.0), 0.25, 4.0)
        res = soft_clip(up * mult[..., None])
        out[r0 : r0 + gp.h - 2 * PAD] = np.rint(res[PAD:-PAD, PAD:-PAD]).astype(np.uint8)
    return out, g, cover / (g.h * g.w)


def cached_level(z, rect, make):
    """A finished zoom level as a uint8 mosaic, kept in the cache so a rerun resumes."""
    path = CACHE / "levels" / f"img_z{z}_{'_'.join(map(str, rect))}.npy"
    if path.exists():
        return np.load(path, mmap_mode="r"), True
    a = make()
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, a)
    return a, False


def stage_img(force=False):
    n_by_zoom = {}
    if force:
        for p in (CACHE / "levels").glob("img_z*.npy"):
            p.unlink()

    # Zoom 8 down to 5: Viking colour, graded, over the whole zoom 5 cover.
    cover5 = rg.tiles_for_box(REGION, 5)
    rect = cover5
    for _ in range(3):
        rect = rg.child_rect(rect)
    g8 = Grid.of_tiles(8, rect)

    def make8():
        eq_v, valid = src.viking(7, rg.rect_bounds(5, cover5), 0.1, "Viking region")
        assert valid.all(), "Viking tiles are missing over the region"
        assert eq_v.inside(g8, margin=1).all()
        raw = eq_v.sample(g8, order=1)
        return np.rint(ochre_grade(raw, grade_weight(g8, raw))).astype(np.uint8)

    v8, cached = cached_level(8, rect, make8)
    m, g = np.asarray(v8, dtype=np.float32), g8
    for z in (8, 7, 6, 5):
        n_by_zoom[z] = rg.write_tiles("img", z, g, m, rg.tiles_for_box(REGION, z), "img")
        if z > 5:
            m, g = rg.reduce2(m), g.parent()
    log("img: zoom 5 to 8 written")

    parent, parent_grid = v8, g8

    def level(z, rect, details_fn):
        nonlocal parent, parent_grid

        def make():
            a, _, cover = detail_pass(z, rect, parent, parent_grid, details_fn())
            log(f"  zoom {z}: finer detail on {100 * cover:.1f}% of the pixels")
            return a

        t0 = time.time()
        a, was_cached = cached_level(z, rect, make)
        g = Grid.of_tiles(z, rect)
        n_by_zoom[z] = rg.write_tiles("img", z, g, a, rect, "img")
        log(f"img: zoom {z}, {n_by_zoom[z]} tiles ({'from cache' if was_cached else f'{time.time() - t0:.0f} s'})")
        parent, parent_grid = a, g

    # Zoom 9 and 10: THEMIS day IR over the region.
    rect9 = rg.tiles_for_box(REGION, 9)
    th = {}

    def themis():
        if not th:
            th["full"] = src.themis(rg.rect_bounds(9, rect9))
            th["half"] = reduce_eq(*th["full"])
        return th

    level(9, rect9, lambda: [Detail(*themis()["half"], **THEMIS_DETAIL)])
    level(10, rg.tiles_for_box(REGION, 10), lambda: [Detail(*themis()["full"], **THEMIS_DETAIL)])
    th.clear()

    # Zoom 11 to 13: CTX over the core.
    rect11 = rg.tiles_for_box(CORE, 11)
    cx = {}

    def ctx(k):
        if not cx:
            cx[0] = src.ctx_esri(11, rg.rect_bounds(11, rect11), label="CTX level 11")
            cx[1] = reduce_eq(*cx[0])
            cx[2] = reduce_eq(*cx[1])
        return cx[k]

    level(11, rect11, lambda: [Detail(*ctx(2), sigma=4.0)])
    level(12, rg.tiles_for_box(CORE, 12), lambda: [Detail(*ctx(1), sigma=3.0)])
    level(13, rg.tiles_for_box(CORE, 13), lambda: [Detail(*ctx(0))])
    cx.clear()

    # Zoom 14: the Mars 2020 CTX ortho over the crater; the CTX mosaic where it has none.
    eq_c, ok_c = src.ctx_dtm()
    crater = src.clip_box(src.valid_box(eq_c, ok_c), CORE)
    rect14 = rg.tiles_for_box(crater, 14)

    def z14():
        eq_o, ok_o = src.ctx_ortho()
        e12, v12 = src.ctx_esri(12, rg.rect_bounds(14, rect14), label="CTX level 12")
        return [Detail(eq_o, ok_o), Detail(e12, v12)]

    level(14, rect14, z14)
    save_boxes(crater=src.round_box(crater))
    log("img:", ", ".join(f"z{z} {n}" for z, n in sorted(n_by_zoom.items())))
    return {"tiles": n_by_zoom}


# --------------------------------------------------------------------------------------
# Edges and coverage
# --------------------------------------------------------------------------------------


def stage_edges():
    import fix_region_edges

    return {"refilled": fix_region_edges.fix(OUT)}


def rectangles(tiles):
    """Cover a set of (x, y) tiles with rectangles [x0, y0, x1, y1]: one if the set is a
    full rectangle, else one per run of equal rows."""
    xs = [t[0] for t in tiles]
    ys = [t[1] for t in tiles]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    if len(tiles) == (x1 - x0 + 1) * (y1 - y0 + 1):
        return [[x0, y0, x1, y1]]
    have = set(tiles)
    rows = {}
    for y in range(y0, y1 + 1):
        runs, x = [], x0
        while x <= x1:
            if (x, y) in have:
                s = x
                while (x + 1, y) in have:
                    x += 1
                runs.append((s, x))
            x += 1
        rows[y] = tuple(runs)
    out, y = [], y0
    while y <= y1:
        e = y
        while e + 1 <= y1 and rows[e + 1] == rows[y]:
            e += 1
        out += [[a, y, b, e] for a, b in rows[y]]
        y = e + 1
    return out


def stage_coverage(root=None):
    root = root or OUT
    boxes = load_boxes()
    if "crater" not in boxes or "hirise" not in boxes:
        raise SystemExit("coverage: the crater and HiRISE boxes are not known yet; run --terrain and --terrain-hirise first")
    products = {}
    extra = sorted(d.name for d in root.iterdir() if d.is_dir() and d.name not in PRODUCTS)  # overlays, e.g. crism
    for product in PRODUCTS + extra:
        zooms = {}
        pdir = root / product
        if not pdir.is_dir():
            continue
        for zdir in sorted((d for d in pdir.iterdir() if d.name.isdigit()), key=lambda d: int(d.name)):
            tiles = [(int(p.parent.name), int(p.stem)) for p in zdir.glob("*/*.webp")]
            if tiles:
                zooms[zdir.name] = rectangles(tiles)
        products[product] = zooms
    version, n = rg.package_version(root)
    cov = {
        "version": version,
        "boxes": {"region": list(REGION), "core": list(CORE), "crater": boxes["crater"], "hirise": boxes["hirise"]},
        "products": products,
    }
    rg.write_json(root / "coverage.json", cov)
    log(f"coverage.json: version {version}, {n} tiles")
    for p, zs in products.items():
        log(f"  {p}: zoom {', '.join(zs)}")
    return {"version": version, "tiles": n}


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    for s in STAGES:
        ap.add_argument(f"--{s}", action="store_true", help=f"run the {s} stage")
    ap.add_argument("--force", action="store_true", help="rerun the chosen stages even if they are marked done")
    args = ap.parse_args(argv)
    chosen = [s for s in STAGES if getattr(args, s.replace("-", "_"))]
    explicit = bool(chosen)
    chosen = chosen or STAGES
    fns = {
        "planet-terrain": stage_planet_terrain,
        "planet-img": stage_planet_img,
        "terrain": stage_terrain,
        "terrain-hirise": stage_terrain_hirise,
        "img": lambda: stage_img(args.force),
        "edges": stage_edges,
        "coverage": stage_coverage,
    }
    for s in chosen:
        always = s in ("edges", "coverage")  # cheap, and they must see the latest tiles
        if marker(s).exists() and not args.force and not always and not explicit:
            log(f"[{s}] done already (use --{s} --force to rebuild)")
            continue
        if marker(s).exists() and not args.force and not always and explicit:
            log(f"[{s}] done already; add --force to rebuild")
            continue
        log(f"[{s}]")
        t0 = time.time()
        info = fns[s]()
        done(s, info)
        log(f"[{s}] finished in {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
