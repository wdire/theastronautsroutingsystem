"""Shared helpers for the Areo tile package (tools/build_region.py and friends).

Bounds, Web Mercator tile maths on the Mars sphere, tile IO (WebP), terrarium
elevation encoding, separable resampling between equirectangular sources and
Mercator tiles, polite retrying HTTP with range reads, and a reader for the
uncompressed strip GeoTIFFs the USGS serves (so only the window is fetched).

TLS verification is never turned off.
"""

from __future__ import annotations

import hashlib
import io
import json
import math
import os
import pathlib
import random
import struct
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import requests
from PIL import Image, ImageFile

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
CACHE = TOOLS / ".cache" / "region"
OUT = ROOT / "public" / "region"

R_MARS = 3_396_190.0  # metres, IAU sphere
TILE = 256

# Boxes are [west, south, east, north] in degrees, east longitude, planetocentric
# latitude on the sphere.
REGION = (71.8, 13.1, 83.1, 23.8)
CORE = (76.2, 17.3, 78.7, 19.6)
CENTRE = (77.45, 18.45)

UA = "areo-tile-builder/1.0 (Mars map data pipeline; python-requests)"
MAX_PER_HOST = 8
IMG_QUALITY = 85  # lossy WebP for imagery: keeps about 93% of the finest detail at zoom 13

Image.MAX_IMAGE_PIXELS = None


def log(*a) -> None:
    print(*a, flush=True)


# --------------------------------------------------------------------------------------
# Web Mercator on the sphere. Tile and pixel coordinates are the usual XYZ scheme.
# --------------------------------------------------------------------------------------


def lon_to_tx(lon, z):
    """Fractional tile x of a longitude."""
    return (np.asarray(lon, dtype=np.float64) + 180.0) / 360.0 * (1 << z)


def lat_to_ty(lat, z):
    """Fractional tile y of a latitude."""
    s = np.sin(np.radians(np.asarray(lat, dtype=np.float64)))
    return (0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * (1 << z)


def tx_to_lon(tx, z):
    return np.asarray(tx, dtype=np.float64) / (1 << z) * 360.0 - 180.0


def ty_to_lat(ty, z):
    n = math.pi * (1 - 2 * np.asarray(ty, dtype=np.float64) / (1 << z))
    return np.degrees(np.arctan(np.sinh(n)))


def tile_bounds(z, x, y):
    """[w, s, e, n] of a tile."""
    return (float(tx_to_lon(x, z)), float(ty_to_lat(y + 1, z)), float(tx_to_lon(x + 1, z)), float(ty_to_lat(y, z)))


def tiles_for_box(box, z):
    """Inclusive tile rectangle [x0, y0, x1, y1] of the tiles that touch a box."""
    w, s, e, n = box
    eps = 1e-9
    x0 = int(math.floor(float(lon_to_tx(w, z)) + eps))
    x1 = int(math.ceil(float(lon_to_tx(e, z)) - eps)) - 1
    y0 = int(math.floor(float(lat_to_ty(n, z)) + eps))
    y1 = int(math.ceil(float(lat_to_ty(s, z)) - eps)) - 1
    m = (1 << z) - 1
    return (max(0, x0), max(0, y0), min(m, max(x0, x1)), min(m, max(y0, y1)))


def rect_bounds(z, rect):
    """[w, s, e, n] of an inclusive tile rectangle."""
    x0, y0, x1, y1 = rect
    return (float(tx_to_lon(x0, z)), float(ty_to_lat(y1 + 1, z)), float(tx_to_lon(x1 + 1, z)), float(ty_to_lat(y0, z)))


def child_rect(rect):
    x0, y0, x1, y1 = rect
    return (x0 * 2, y0 * 2, x1 * 2 + 1, y1 * 2 + 1)


def ground_res(z, lat=0.0):
    """Metres per pixel on the ground at a latitude."""
    return 2 * math.pi * R_MARS * math.cos(math.radians(lat)) / (TILE << z)


class Grid:
    """A window of the global Mercator pixel grid at one zoom: px0, py0 is the top-left
    pixel, w and h its size. Pixel centres sit at +0.5."""

    def __init__(self, z, px0, py0, w, h):
        self.z, self.px0, self.py0, self.w, self.h = int(z), int(px0), int(py0), int(w), int(h)

    @classmethod
    def of_tiles(cls, z, rect, pad=0):
        x0, y0, x1, y1 = rect
        return cls(z, x0 * TILE - pad, y0 * TILE - pad, (x1 - x0 + 1) * TILE + 2 * pad, (y1 - y0 + 1) * TILE + 2 * pad)

    def lons(self):
        return tx_to_lon((self.px0 + np.arange(self.w) + 0.5) / TILE, self.z)

    def lats(self):
        return ty_to_lat((self.py0 + np.arange(self.h) + 0.5) / TILE, self.z)

    def bounds(self):
        return (
            float(tx_to_lon(self.px0 / TILE, self.z)),
            float(ty_to_lat((self.py0 + self.h) / TILE, self.z)),
            float(tx_to_lon((self.px0 + self.w) / TILE, self.z)),
            float(ty_to_lat(self.py0 / TILE, self.z)),
        )

    def rows(self, r0, r1):
        return Grid(self.z, self.px0, self.py0 + r0, self.w, r1 - r0)

    def padded(self, pad):
        return Grid(self.z, self.px0 - pad, self.py0 - pad, self.w + 2 * pad, self.h + 2 * pad)

    def parent(self):
        """The parent-zoom grid covering this one (this grid must be even-aligned)."""
        assert self.px0 % 2 == 0 and self.py0 % 2 == 0 and self.w % 2 == 0 and self.h % 2 == 0
        return Grid(self.z - 1, self.px0 // 2, self.py0 // 2, self.w // 2, self.h // 2)

    def frac_in(self, other):
        """Fractional row and column indices of this grid's pixel centres inside another
        Mercator grid (any zoom)."""
        s = 2.0 ** (other.z - self.z)
        fc = (self.px0 + np.arange(self.w) + 0.5) * s - 0.5 - other.px0
        fr = (self.py0 + np.arange(self.h) + 0.5) * s - 0.5 - other.py0
        return fr, fc


def box_distance_deg(lons, lats, box):
    """Distance in degrees outside a box (0 inside), as an (h, w) array."""
    w, s, e, n = box
    dx = np.maximum(np.maximum(w - lons, lons - e), 0.0)[None, :]
    dy = np.maximum(np.maximum(s - lats, lats - n), 0.0)[:, None]
    return np.hypot(dx, dy)


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


# --------------------------------------------------------------------------------------
# Resampling. Equirectangular sources and Mercator tiles are both separable in longitude
# and latitude, so every warp here is a separable lookup.
# --------------------------------------------------------------------------------------


def _taps(f, n, order):
    f = np.asarray(f, dtype=np.float64)
    i0 = np.floor(f).astype(np.int64)
    t = (f - i0).astype(np.float32)
    if order == 0:
        idx, wts = [np.rint(f).astype(np.int64)], [np.ones_like(t)]
    elif order == 1:
        idx, wts = [i0, i0 + 1], [1 - t, t]
    else:  # Catmull-Rom
        idx = [i0 - 1, i0, i0 + 1, i0 + 2]
        wts = [
            ((-t + 2) * t - 1) * t * 0.5,
            ((3 * t - 5) * t * t + 2) * 0.5,
            ((-3 * t + 4) * t + 1) * t * 0.5,
            (t - 1) * t * t * 0.5,
        ]
    return [np.clip(i, 0, n - 1) for i in idx], wts


def sample_sep(src, fr, fc, order=1):
    """Resample src (H, W[, C]) at fractional rows fr and columns fc (pixel centres at
    whole numbers). Indices are clamped at the source edge, so callers must read a source
    window with a margin: check inside() when the source can end inside the target."""
    src = np.asarray(src)
    fr = np.asarray(fr, dtype=np.float64)
    fc = np.asarray(fc, dtype=np.float64)
    H, W = src.shape[:2]
    c_lo = int(max(0, math.floor(fc.min()) - 2))
    c_hi = int(min(W, math.ceil(fc.max()) + 3))
    r_lo = int(max(0, math.floor(fr.min()) - 2))
    r_hi = int(min(H, math.ceil(fr.max()) + 3))
    sub = src[r_lo:r_hi, c_lo:c_hi]
    ri, rw = _taps(fr - r_lo, sub.shape[0], order)
    ci, cw = _taps(fc - c_lo, sub.shape[1], order)
    extra = (1,) * (sub.ndim - 2)
    tmp = None
    for i, w in zip(ri, rw):
        part = sub[i].astype(np.float32) * w.reshape((-1, 1) + extra)
        tmp = part if tmp is None else tmp + part
    out = None
    for i, w in zip(ci, cw):
        part = tmp[:, i] * w.reshape((1, -1) + extra)
        out = part if out is None else out + part
    return out


def inside(fr, fc, shape, margin=0.0):
    """(h, w) mask of the targets whose source position lies inside the source array."""
    H, W = shape[:2]
    okr = (fr >= margin) & (fr <= H - 1 - margin)
    okc = (fc >= margin) & (fc <= W - 1 - margin)
    return okr[:, None] & okc[None, :]


def reduce2(a):
    """Halve an array by averaging 2 x 2 blocks."""
    a = np.asarray(a, dtype=np.float32)
    h, w = a.shape[0] // 2 * 2, a.shape[1] // 2 * 2
    a = a[:h, :w]
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) * 0.25


def luminance(rgb):
    rgb = np.asarray(rgb, dtype=np.float32)
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


class EqArray:
    """An equirectangular raster in degrees: pixel (r, c) has its centre at
    lat0 - (r + 0.5) * dlat, lon0 + (c + 0.5) * dlon."""

    def __init__(self, data, lon0, lat0, dlon, dlat=None):
        self.data = data
        self.lon0, self.lat0, self.dlon, self.dlat = float(lon0), float(lat0), float(dlon), float(dlat or dlon)

    def frac(self, lons, lats):
        fc = (np.asarray(lons) - self.lon0) / self.dlon - 0.5
        fr = (self.lat0 - np.asarray(lats)) / self.dlat - 0.5
        return fr, fc

    def sample(self, grid, order=1, data=None):
        fr, fc = self.frac(grid.lons(), grid.lats())
        return sample_sep(self.data if data is None else data, fr, fc, order)

    def inside(self, grid, margin=0.0):
        fr, fc = self.frac(grid.lons(), grid.lats())
        return inside(fr, fc, self.data.shape, margin)

    def bounds(self):
        h, w = self.data.shape[:2]
        return (self.lon0, self.lat0 - h * self.dlat, self.lon0 + w * self.dlon, self.lat0)


# --------------------------------------------------------------------------------------
# Terrarium elevation and tile IO.
# --------------------------------------------------------------------------------------


def terrarium_encode(elev, quantum=None):
    """Metres -> RGB uint8 with elevation = R * 256 + G + B / 256 - 32768. quantum rounds
    the heights to a step (a power of two fraction of a metre keeps the blue channel
    compressible)."""
    e = np.asarray(elev, dtype=np.float64)
    if quantum:
        e = np.round(e / quantum) * quantum
    v = np.clip(np.round((e + 32768.0) * 256.0), 0, 256**3 - 1).astype(np.uint32)
    out = np.empty(e.shape + (3,), dtype=np.uint8)
    out[..., 0] = v >> 16
    out[..., 1] = (v >> 8) & 255
    out[..., 2] = v & 255
    return out


def terrarium_decode(rgb):
    rgb = np.asarray(rgb)
    return (
        rgb[..., 0].astype(np.float32) * 256.0 + rgb[..., 1].astype(np.float32) + rgb[..., 2].astype(np.float32) / 256.0
    ) - 32768.0


def tile_path(product, z, x, y, root=None):
    return (root or OUT) / product / str(z) / str(x) / f"{y}.webp"


def _save(img, path, **kw):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    img.save(tmp, "WEBP", **kw)
    os.replace(tmp, path)


def save_img_tile(path, rgb, quality=IMG_QUALITY):
    """Lossy WebP for imagery."""
    a = np.clip(np.rint(rgb), 0, 255).astype(np.uint8) if rgb.dtype != np.uint8 else rgb
    _save(Image.fromarray(a, "RGB"), path, quality=quality, method=6)


def save_terrain_tile(path, elev, quantum=None):
    """Terrarium in lossless WebP: every decoded pixel is exactly the encoded height."""
    _save(Image.fromarray(terrarium_encode(elev, quantum), "RGB"), path, lossless=True, quality=80, method=5, exact=True)


def save_rgba_tile(path, rgba, quality=82):
    """Lossy colour with a lossless alpha plane, for overlays."""
    _save(Image.fromarray(rgba, "RGBA"), path, quality=quality, method=6, alpha_quality=100, exact=False)


def load_tile(path):
    with Image.open(path) as im:
        im.load()
        return np.asarray(im.convert("RGBA" if im.mode in ("RGBA", "LA", "PA") else "RGB"))


def load_terrain_tile(path):
    return terrarium_decode(load_tile(path)[..., :3])


def write_tiles(product, z, grid, array, rect, kind, quantum=None, quality=None, root=None, workers=6):
    """Cut tiles of an inclusive tile rectangle out of an array laid on a grid and save
    them. kind is 'img', 'terrain' or 'rgba'. Returns the number written."""
    x0, y0, x1, y1 = rect
    jobs = []
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            r, c = ty * TILE - grid.py0, tx * TILE - grid.px0
            if r < 0 or c < 0 or r + TILE > grid.h or c + TILE > grid.w:
                raise ValueError(f"tile {z}/{tx}/{ty} is outside the array it is cut from")
            jobs.append((tx, ty, r, c))

    def one(job):
        tx, ty, r, c = job
        cut = array[r : r + TILE, c : c + TILE]
        path = tile_path(product, z, tx, ty, root)
        if kind == "terrain":
            save_terrain_tile(path, cut, quantum)
        elif kind == "rgba":
            if cut[..., 3].max() == 0:
                return 0
            save_rgba_tile(path, cut, quality or 82)
        else:
            save_img_tile(path, cut, quality or IMG_QUALITY)
        return 1

    with ThreadPoolExecutor(workers) as ex:
        return sum(ex.map(one, jobs))


def read_mosaic(product, z, rect, root=None, terrain=False):
    """Stitch the tiles of an inclusive rectangle from disk. Missing tiles raise."""
    x0, y0, x1, y1 = rect
    first = load_tile(tile_path(product, z, x0, y0, root))
    ch = first.shape[2]
    out = np.zeros(((y1 - y0 + 1) * TILE, (x1 - x0 + 1) * TILE, ch), dtype=np.uint8)
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            out[(ty - y0) * TILE : (ty - y0 + 1) * TILE, (tx - x0) * TILE : (tx - x0 + 1) * TILE] = load_tile(
                tile_path(product, z, tx, ty, root)
            )
    return terrarium_decode(out[..., :3]) if terrain else out


SMEAR_WINDOW = 8  # lines
SMEAR_TOL = 0.4  # median difference between neighbouring lossy lines, 0..255
SMEAR_RATIO = 0.35  # ... and against the variation along those lines


def smear_flags(a, axis, terrain):
    """Where a sampler clamps past the end of its source, the last real line repeats.
    Returns a boolean per line: True where line i is part of such a run across `axis`
    (axis 0: rows repeat downward; axis 1: columns repeat sideways).

    Terrain is lossless, so repeats are exact: a line equal to the next along its whole
    length (and not itself flat). Imagery is lossy, so the test is statistical: over a
    window of SMEAR_WINDOW lines the median difference between neighbours is under
    SMEAR_TOL and well under the variation along the lines themselves. Flat ground, which
    varies little both ways, is not a smear; a streak, which varies only one way, is."""
    a = np.asarray(a, dtype=np.float32)
    if a.ndim == 2:
        a = a[..., None]
    if axis == 1:
        a = a.transpose(1, 0, 2)
    perp = np.abs(a[1:] - a[:-1])
    n = a.shape[0]
    flags = np.zeros(n, dtype=bool)
    if terrain:
        same = (perp.max(axis=(1, 2)) == 0) & (np.ptp(a[:-1], axis=(1, 2)) > 0)
        flags[:-1] |= same
        flags[1:] |= same
        return flags
    dperp = perp.mean(axis=(1, 2))
    dpar = np.abs(a[:, 1:] - a[:, :-1]).mean(axis=(1, 2))
    w = SMEAR_WINDOW
    for i in range(0, n - w):
        mp = float(np.median(dperp[i : i + w]))
        if mp < SMEAR_TOL and mp < SMEAR_RATIO * float(np.median(dpar[i : i + w + 1])):
            flags[i : i + w + 1] = True
    return flags


SMEAR_MIN = {True: 3, False: 16}  # lines in a row before it counts: terrain (exact), imagery (statistical)


def edge_run(flags):
    """Length of the flagged run that touches either end (a smear runs from where the
    data ends to the edge of the tile, so it always touches an edge)."""
    n = len(flags)
    a = 0
    while a < n and flags[a]:
        a += 1
    b = 0
    while b < n and flags[n - 1 - b]:
        b += 1
    return max(a, b)


def smear_length(a, terrain):
    """Longest smear in one tile over rows and columns, in lines (0 if none): a run of
    repeated lines that touches the tile edge and is at least SMEAR_MIN long."""
    worst = max(edge_run(smear_flags(a, axis, terrain)) for axis in (0, 1))
    return worst if worst >= SMEAR_MIN[bool(terrain)] else 0


def package_version(root=None, products=None):
    """sha1 of every tile's path and size, in path order."""
    root = root or OUT
    h = hashlib.sha1()
    n = 0
    for p in sorted(root.rglob("*.webp"), key=lambda p: p.relative_to(root).as_posix()):
        rel = p.relative_to(root).as_posix()
        if products is not None and rel.split("/")[0] not in products:
            continue
        h.update(f"{rel}:{p.stat().st_size}\n".encode())
        n += 1
    return h.hexdigest(), n


# --------------------------------------------------------------------------------------
# HTTP: retries with backoff, at most MAX_PER_HOST requests in flight per host, range
# reads, an on-disk cache. Certificates are always verified.
# --------------------------------------------------------------------------------------

_tls = threading.local()
_host_gates: dict[str, threading.BoundedSemaphore] = {}
_gate_lock = threading.Lock()


class NotFound(Exception):
    pass


def _session():
    s = getattr(_tls, "session", None)
    if s is None:
        s = requests.Session()
        s.headers["User-Agent"] = UA
        s.headers["Accept"] = "*/*"
        _tls.session = s
    return s


def _gate(url):
    host = urllib.parse.urlsplit(url).netloc
    with _gate_lock:
        g = _host_gates.get(host)
        if g is None:
            g = _host_gates[host] = threading.BoundedSemaphore(MAX_PER_HOST)
    return g


def http_get(url, headers=None, tries=7, timeout=(15, 90), expect=None, check=None):
    """GET with retries. expect is the exact byte count wanted (range reads); check is
    called with the body and may raise to ask for another try. 404 raises NotFound."""
    last = None
    for attempt in range(tries):
        try:
            with _gate(url):
                r = _session().get(url, headers=headers, timeout=timeout, allow_redirects=True)
                body = r.content
            if r.status_code in (400, 403, 404, 410):  # asking again will not help
                raise NotFound(f"{url} (HTTP {r.status_code})")
            if r.status_code not in (200, 206):
                raise IOError(f"HTTP {r.status_code}")
            if headers and "Range" in headers and r.status_code != 206:
                raise IOError("server ignored the Range header")
            cl = r.headers.get("Content-Length")
            if cl is not None and r.headers.get("Content-Encoding") is None and len(body) != int(cl):
                raise IOError(f"short read: {len(body)} of {cl} bytes")
            if expect is not None and len(body) != expect:
                raise IOError(f"got {len(body)} bytes, wanted {expect}")
            if check is not None:
                check(body)
            return body
        except NotFound:
            raise
        except Exception as e:  # resets, timeouts, short reads, 5xx
            last = e
            if attempt + 1 < tries:
                time.sleep(min(60.0, 1.5 * 2**attempt) * (0.7 + 0.6 * random.random()))
    raise IOError(f"could not download {url}: {last}")


def resolve(url):
    """Follow redirects once and return (final url, size in bytes)."""
    last = None
    for attempt in range(6):
        try:
            with _gate(url):
                r = _session().head(url, timeout=(15, 60), allow_redirects=True)
            if r.status_code == 200:
                return r.url, int(r.headers["Content-Length"])
            last = IOError(f"HTTP {r.status_code}")
        except Exception as e:
            last = e
        time.sleep(min(60.0, 1.5 * 2**attempt))
    raise IOError(f"could not reach {url}: {last}")


def fetch_range(url, start, end):
    """Bytes start..end inclusive."""
    return http_get(url, headers={"Range": f"bytes={start}-{end}"}, expect=end - start + 1)


def fetch_cached(url, path, check=None, tries=7):
    """Download to a cache file once. A 404 is remembered (returns None)."""
    path = pathlib.Path(path)
    if path.exists():
        return path.read_bytes()
    miss = path.with_name(path.name + ".404")
    if miss.exists():
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        body = http_get(url, check=check, tries=tries)
    except NotFound:
        miss.write_bytes(b"")
        return None
    tmp = path.with_name(path.name + f".{threading.get_ident()}.tmp")
    tmp.write_bytes(body)
    os.replace(tmp, path)
    return body


def fetch_file(url, path, chunk=8 << 20):
    """Download a whole (modest) file with range requests, resumable, to a cache file."""
    path = pathlib.Path(path)
    if path.exists():
        return path
    final, size = resolve(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    with open(part, "ab") as f:
        while have < size:
            end = min(size, have + chunk) - 1
            f.write(fetch_range(final, have, end))
            have = end + 1
    os.replace(part, path)
    return path


def parallel(fn, items, workers=MAX_PER_HOST, label=None, every=200):
    """Run fn over items on a thread pool, in order, with a progress line."""
    items = list(items)
    out = []
    t0 = time.time()
    with ThreadPoolExecutor(workers) as ex:
        for i, res in enumerate(ex.map(fn, items)):
            out.append(res)
            if label and (i + 1) % every == 0:
                log(f"  {label}: {i + 1}/{len(items)} ({time.time() - t0:.0f} s)")
    return out


def is_complete(body):
    """True when image bytes end the way their format says they should (PNG IEND chunk,
    JPEG end-of-image marker). Some servers store files that were cut short."""
    if body[:8] == b"\x89PNG\r\n\x1a\n":
        return body[-8:] == b"IEND\xaeB`\x82"
    if body[:2] == b"\xff\xd8":
        return body.rstrip(b"\0")[-2:] == b"\xff\xd9"
    return True


ImageFile.LOAD_TRUNCATED_IMAGES = True  # completeness is checked by is_complete(), not by PIL


def decode_image(body):
    """Decode image bytes fully. A file that is cut short raises."""
    if not is_complete(body):
        raise IOError("image file is cut short")
    im = Image.open(io.BytesIO(body))
    im.load()
    return im


def check_image(body):
    decode_image(body)


# --------------------------------------------------------------------------------------
# Uncompressed strip GeoTIFF over HTTP ranges (classic TIFF and BigTIFF).
# --------------------------------------------------------------------------------------

_TIFF_TYPES = {1: "B", 2: "c", 3: "H", 4: "I", 5: "II", 6: "b", 7: "B", 8: "h", 9: "i", 11: "f", 12: "d", 16: "Q", 17: "q", 18: "Q"}


class StripTiff:
    """Reads windows of an uncompressed, strip-organised GeoTIFF by HTTP range (or from a
    local file). Only the bytes of the window are fetched."""

    def __init__(self, src):
        self.src = str(src)
        self.local = not self.src.startswith("http")
        if self.local:
            self.url, self.size = self.src, os.path.getsize(self.src)
        else:
            self.url, self.size = resolve(self.src)
        self._parse()

    def _read(self, off, n):
        if self.local:
            with open(self.url, "rb") as f:
                f.seek(off)
                return f.read(n)
        return fetch_range(self.url, off, off + n - 1)

    def _parse(self):
        head = self._read(0, 16)
        bo = {b"II": "<", b"MM": ">"}[head[:2]]
        magic = struct.unpack(bo + "H", head[2:4])[0]
        big = magic == 43
        if magic not in (42, 43):
            raise IOError("not a TIFF")
        if big:
            ifd = struct.unpack(bo + "Q", head[8:16])[0]
            n = struct.unpack(bo + "Q", self._read(ifd, 8))[0]
            raw = self._read(ifd + 8, n * 20)
            esz, fmt, inline = 20, "HHQ", 8
        else:
            ifd = struct.unpack(bo + "I", head[4:8])[0]
            n = struct.unpack(bo + "H", self._read(ifd, 2))[0]
            raw = self._read(ifd + 2, n * 12)
            esz, fmt, inline = 12, "HHI", 4
        tags = {}
        for i in range(n):
            e = raw[i * esz : (i + 1) * esz]
            tag, typ, count = struct.unpack(bo + fmt, e[: struct.calcsize("=" + fmt)])
            code = _TIFF_TYPES.get(typ)
            if code is None:
                continue
            per = struct.calcsize("=" + code)
            total = per * count
            valraw = e[esz - inline :]
            if total <= inline:
                data = valraw[:total]
            else:
                off = struct.unpack(bo + ("Q" if big else "I"), valraw)[0]
                data = self._read(off, total)
            if typ == 2:
                tags[tag] = data.split(b"\0")[0].decode("ascii", "replace")
            elif typ == 5:
                v = struct.unpack(bo + "I" * (2 * count), data)
                tags[tag] = [v[2 * k] / v[2 * k + 1] for k in range(count)]
            else:
                tags[tag] = np.frombuffer(data, dtype=np.dtype(bo + code)).copy()
        self.tags = tags
        self.bo = bo
        self.width = int(tags[256][0])
        self.height = int(tags[257][0])
        bits = int(tags[258][0])
        if int(tags.get(259, [1])[0]) != 1:
            raise IOError("compressed TIFF: read it with a GeoTIFF library instead")
        if int(tags.get(277, [1])[0]) != 1:
            raise IOError("more than one sample per pixel")
        fmt_code = int(tags.get(339, [1])[0])
        kind = {1: "u", 2: "i", 3: "f"}[fmt_code]
        self.dtype = np.dtype(f"{bo}{kind}{bits // 8}")
        self.rows_per_strip = int(tags.get(278, [self.height])[0])
        self.strip_offsets = tags[273].astype(np.int64)
        self.nodata = None
        if 42113 in tags:
            try:
                self.nodata = float(tags[42113].strip())
            except ValueError:
                pass
        scale, tie = tags[33550], tags[33922]
        self.sx, self.sy = float(scale[0]), float(scale[1])
        self.x0 = float(tie[3]) - float(tie[0]) * self.sx  # left edge of column 0
        self.y0 = float(tie[4]) + float(tie[1]) * self.sy  # top edge of row 0
        keys = tags.get(34735)
        self.projected = False
        if keys is not None:
            k = keys.reshape(-1, 4)
            for key, loc, cnt, val in k[1:]:
                if key == 1024:
                    self.projected = int(val) == 1

    # Georeferencing: geographic degrees, or metres on an equirectangular projection with
    # the standard parallel and central meridian at 0 (x = R * lon, y = R * lat).
    def _deg(self, v):
        return np.degrees(np.asarray(v) / R_MARS) if self.projected else np.asarray(v)

    def _native(self, deg):
        return np.radians(np.asarray(deg)) * R_MARS if self.projected else np.asarray(deg)

    def bounds(self):
        return (
            float(self._deg(self.x0)),
            float(self._deg(self.y0 - self.height * self.sy)),
            float(self._deg(self.x0 + self.width * self.sx)),
            float(self._deg(self.y0)),
        )

    def col_of_lon(self, lon):
        """Fractional column index (centres at whole numbers)."""
        return (self._native(lon) - self.x0) / self.sx - 0.5

    def row_of_lat(self, lat):
        return (self.y0 - self._native(lat)) / self.sy - 0.5

    def eq(self, data, r0, c0, row_step=1, col_step=1):
        """Wrap a window read from this file as an EqArray in degrees."""
        dlon = float(self._deg(self.sx * col_step))
        dlat = float(self._deg(self.sy * row_step))
        return EqArray(data, float(self._deg(self.x0 + c0 * self.sx)), float(self._deg(self.y0 - r0 * self.sy)), dlon, dlat)

    def _row_offset(self, row):
        s, within = divmod(row, self.rows_per_strip)
        return int(self.strip_offsets[s]) + within * self.width * self.dtype.itemsize

    def read_window(self, r0, r1, c0, c1, row_step=1, label=None, part_dir=None, block=250):
        """Rows r0..r1 (exclusive) every row_step, columns c0..c1 (exclusive): one range
        request per row, MAX_PER_HOST at a time. With part_dir, every block of rows is
        saved as it arrives, so a dropped connection costs one block, not the window."""
        r0, r1 = max(0, r0), min(self.height, r1)
        c0, c1 = max(0, c0), min(self.width, c1)
        rows = list(range(r0, r1, row_step))
        isz = self.dtype.itemsize
        native = self.dtype.newbyteorder("=")
        out = np.empty((len(rows), c1 - c0), dtype=native)

        def one(k):
            off = self._row_offset(rows[k]) + c0 * isz
            out[k] = np.frombuffer(self._read(off, (c1 - c0) * isz), dtype=self.dtype)

        t0 = time.time()
        for b0 in range(0, len(rows), block):
            b1 = min(len(rows), b0 + block)
            part = pathlib.Path(part_dir) / f"rows_{r0}_{r1}_{row_step}_{c0}_{c1}_{b0}.npy" if part_dir else None
            if part is not None and part.exists():
                out[b0:b1] = np.load(part)
                continue
            parallel(one, range(b0, b1))
            if part is not None:
                part.parent.mkdir(parents=True, exist_ok=True)
                tmp = part.with_name(part.stem + ".tmp.npy")
                np.save(tmp, out[b0:b1])
                os.replace(tmp, part)
            if label:
                log(f"  {label}: {b1}/{len(rows)} ({time.time() - t0:.0f} s)")
        return out


def cached_array(path, make):
    """np.load a cached array, or make and save it."""
    path = pathlib.Path(path)
    if path.exists():
        return np.load(path)
    a = make()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".tmp.npy")
    np.save(tmp, a)
    os.replace(tmp, path)
    return a


# --------------------------------------------------------------------------------------
# Equirectangular tile services (Mars Trek WMTS, Esri OnMars): fetch and stitch a window.
# --------------------------------------------------------------------------------------


def eq_tile_range(box, level, margin_deg=0.0):
    """Tile rows and columns (inclusive) of a 2 x 1 equirectangular pyramid touching a
    box grown by a margin."""
    t = 180.0 / (1 << level)
    w, s, e, n = box
    c0 = int(math.floor((w - margin_deg + 180.0) / t))
    c1 = int(math.floor((e + margin_deg + 180.0) / t - 1e-9))
    r0 = int(math.floor((90.0 - (n + margin_deg)) / t))
    r1 = int(math.floor((90.0 - (s - margin_deg)) / t - 1e-9))
    return max(0, r0), max(0, c0), min((1 << level) - 1, r1), min(2 * (1 << level) - 1, c1)


def fetch_eq_mosaic(template, level, tile_px, box, cache_dir, ext, margin_deg=0.0, channels=1, label=None, nodata=None, repair=False):
    """Fetch the tiles of an equirectangular service that cover a box and stitch them.

    Returns (EqArray of uint8 data, valid mask). The mask is False where a tile is
    missing (404), where the service sent a transparent or no-data pixel, and where the
    file on the server is cut short (such files turn out to hold the wrong picture, so
    none of their pixels are used). repair fills those holes from the four child tiles
    one level down, averaged, and what is still missing from the parent tile, enlarged."""
    r0, c0, r1, c1 = eq_tile_range(box, level, margin_deg)
    nr, nc = r1 - r0 + 1, c1 - c0 + 1
    shape = (nr * tile_px, nc * tile_px) + ((channels,) if channels > 1 else ())
    data = np.zeros(shape, dtype=np.uint8)
    valid = np.zeros((nr * tile_px, nc * tile_px), dtype=bool)
    cache_dir = pathlib.Path(cache_dir)
    stats = {"missing": 0, "cut": 0, "children": 0, "parent": 0}
    lock = threading.Lock()

    def bump(key):
        with lock:
            stats[key] += 1

    def load(lv, r, c, count=False):
        """One tile as (pixels, valid mask), or None."""
        url = template.format(z=lv, y=r, x=c)
        path = cache_dir / str(lv) / str(r) / f"{c}.{ext}"
        try:
            body = fetch_cached(url, path)
        except IOError as e:
            log(f"  giving up on {url}: {e}")
            body = None
        if not body:
            if count:
                bump("missing")
            return None
        if not is_complete(body):
            if count:
                bump("cut")
            return None
        try:
            im = decode_image(body)
            alpha = None
            if im.mode in ("LA", "RGBA", "PA") or "transparency" in im.info:
                alpha = np.asarray(im.convert("RGBA"))[..., 3]
            a = np.asarray(im.convert("L" if channels == 1 else "RGB"))
        except Exception:
            if count:
                bump("missing")
            return None
        if a.shape[0] != tile_px or a.shape[1] != tile_px:
            return None
        ok = np.ones((tile_px, tile_px), dtype=bool) if alpha is None else alpha > 127
        if nodata is not None:
            ok &= a.reshape(tile_px, tile_px, -1).max(axis=2) != nodata
        return a, ok

    def one(rc):
        r, c = rc
        got = load(level, r, c, count=True)
        y, x = (r - r0) * tile_px, (c - c0) * tile_px
        d = data[y : y + tile_px, x : x + tile_px]
        v = valid[y : y + tile_px, x : x + tile_px]
        if got is not None:
            d[...] = got[0]
            v[...] = got[1]
        if not repair or v.all():
            return
        big = np.zeros((2 * tile_px, 2 * tile_px) + shape[2:], dtype=np.float32)
        bok = np.zeros((2 * tile_px, 2 * tile_px), dtype=bool)
        for dr in (0, 1):
            for dc in (0, 1):
                kid = load(level + 1, 2 * r + dr, 2 * c + dc)
                if kid is not None:
                    big[dr * tile_px : (dr + 1) * tile_px, dc * tile_px : (dc + 1) * tile_px] = kid[0]
                    bok[dr * tile_px : (dr + 1) * tile_px, dc * tile_px : (dc + 1) * tile_px] = kid[1]
        hole = ~v & bok[0::2, 0::2] & bok[1::2, 0::2] & bok[0::2, 1::2] & bok[1::2, 1::2]
        if hole.any():
            d[hole] = np.rint(reduce2(big)).astype(np.uint8)[hole]
            v[hole] = True
            bump("children")
        if v.all() or level == 0:
            return
        up = load(level - 1, r // 2, c // 2)
        if up is not None:
            f = (np.arange(tile_px) + 0.5) / 2 - 0.5
            fr, fc = f + (r % 2) * tile_px / 2, f + (c % 2) * tile_px / 2
            pix = np.rint(sample_sep(up[0], fr, fc, 1)).astype(np.uint8)
            pok = sample_sep(up[1].astype(np.float32), fr, fc, 0) > 0.5
            hole = ~v & pok
            if hole.any():
                d[hole] = pix[hole]
                v[hole] = True
                bump("parent")

    jobs = [(r, c) for r in range(r0, r1 + 1) for c in range(c0, c1 + 1)]
    parallel(one, jobs, label=label, every=250)
    res = 180.0 / (1 << level) / tile_px
    if label:
        log(
            f"  {label}: {len(jobs)} tiles, {stats['missing']} missing, {stats['cut']} cut short on the server; "
            f"{stats['children']} filled from the level below, {stats['parent']} from the level above; "
            f"{100 * valid.mean():.2f}% of the window has data"
        )
    return EqArray(data, -180.0 + c0 * tile_px * res, 90.0 - r0 * tile_px * res, res), valid


def write_json(path, obj):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(obj, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp, path)


if __name__ == "__main__":
    # A quick self-test of the maths.
    z = 9
    rect = tiles_for_box(REGION, z)
    log("region tiles at z9:", rect, "bounds", [round(v, 4) for v in rect_bounds(z, rect)])
    e = np.array([-2600.25, 0.0, 21229.0, -8200.5])
    assert np.allclose(terrarium_decode(terrarium_encode(e)), e)
    assert abs(float(ty_to_lat(lat_to_ty(18.45, 12), 12)) - 18.45) < 1e-9
    log("ok; metres per pixel at z14, 18.45 N:", round(ground_res(14, 18.45), 2))
    sys.exit(0)
