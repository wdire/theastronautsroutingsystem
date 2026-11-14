"""Spectral overlays for Jezero from CRISM (design departure 5).

    python tools/build_crism.py

CRISM is the imaging spectrometer on Mars Reconnaissance Orbiter. Its map-projected
targeted products (MTRDR, PDS Geosciences Node) come with "browse" composites: three
summary parameters (band depths that respond to a mineral family) as red, green and blue,
already map-projected at 18 or 36 m per pixel. This tool finds the MTRDR observations over
Jezero through the PDS Orbital Data Explorer, fetches two browse composites of each (a few
hundred kB apiece) and lays them into overlay pyramids with transparency where there is
no data:

  public/region/crism/{z}/{x}/{y}.webp           MAF: olivine (red), low-calcium pyroxene
                                                 (green), high-calcium pyroxene (blue)
  public/region/crismCarbonate/{z}/{x}/{y}.webp  CR2: carbonate indicators; magnesium
                                                 carbonate shows yellow to white

Each observation was stretched on its own by the CRISM team, so colours show where a
mineral signature is strong inside one image; they are not comparable between images.
Opacity follows signal strength, so the map shows through where a composite says little.
Run build_region.py --coverage afterwards to list the tiles in coverage.json.
"""

from __future__ import annotations

import json
import re
import sys

import numpy as np

import region as rg
from region import CACHE, OUT, Grid, log
from sources import add_source

ODE = (
    "https://oderest.rsl.wustl.edu/live2/?query=products&target=mars&results=fpm&ihid=MRO&iid=CRISM&pt=MTRDR"
    "&westlon=76.9&eastlon=78.0&minlat=17.9&maxlat=18.9&output=JSON&limit=100"
)
ARCHIVE = "https://pds-geosciences.wustl.edu/mro/mro-m-crism-5-rdr-mptargeted-v1/"
LAYERS = {
    "crism": ("MAF", "olivine (red), low-calcium pyroxene (green), high-calcium pyroxene (blue)"),
    "crismCarbonate": ("CR2", "carbonate indicators: magnesium carbonate shows yellow to white"),
}
ZOOMS = (12, 11, 10, 9)  # zoom 12 is about 19 m per pixel here; the products are 18 and 36 m
CDIR = CACHE / "crism"
FOOTPRINT = 0.12  # least opacity inside an image footprint


def observations():
    path = CDIR / "ode_mtrdr.json"
    body = path.read_bytes() if path.exists() else None
    if body is None:
        body = rg.http_get(ODE)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
    prods = json.loads(body)["ODEResults"].get("Products")
    if not isinstance(prods, dict):
        return []
    ps = prods["Product"]
    ps = [ps] if isinstance(ps, dict) else ps
    out = []
    for p in ps:
        files = {f["FileName"].lower(): f["URL"] for f in p.get("Product_files", {}).get("Product_file", [])}
        out.append({"id": p["pdsid"], "time": p.get("Observation_time", ""), "scale": float(p.get("Map_scale") or 18), "files": files})
    # coarser first, then by date: the last one painted wins where images overlap
    out.sort(key=lambda o: (-o["scale"], o["time"]))
    return out


def load_browse(obs, code):
    """One browse composite as (EqArray rgb uint8, valid mask, band names), or None."""
    want = f"_br{code.lower()}j_mtr3"
    png = next((u for n, u in obs["files"].items() if want in n and n.endswith(".png")), None)
    hdr = next((u for n, u in obs["files"].items() if want in n and n.endswith(".hdr")), None)
    if not png or not hdr:
        return None
    stem = png.rsplit("/", 1)[1][:-4]
    head = rg.fetch_cached(hdr, CDIR / f"{stem}.hdr").decode("latin1")
    body = rg.fetch_cached(png, CDIR / f"{stem}.png", check=rg.check_image)
    im = rg.decode_image(body)
    rgba = np.asarray(im.convert("RGBA"))
    m = re.search(r"map info\s*=\s*\{([^}]*)\}", head)
    p = re.search(r"projection info\s*=\s*\{([^}]*)\}", head)
    if not m or not p:
        return None
    mi = [s.strip() for s in m.group(1).split(",")]
    pi = [s.strip() for s in p.group(1).split(",")]
    # map info: name, ref x, ref y, easting, northing, dx, dy; projection info: 17
    # (equirectangular), radius, standard parallel, central meridian
    east, north, dx, dy = float(mi[3]), float(mi[4]), float(mi[5]), float(mi[6])
    radius, lat_ts, lon_c = float(pi[1]), float(pi[2]), float(pi[3])
    if int(pi[0]) != 17 or float(mi[1]) != 1 or float(mi[2]) != 1:
        return None
    k = radius * np.cos(np.radians(lat_ts))
    eq = rg.EqArray(rgba[..., :3], lon_c + np.degrees(east / k), np.degrees(north / radius), np.degrees(dx / k), np.degrees(dy / radius))
    ignore = re.search(r"data ignore value\s*=\s*(\d+)", head)
    nod = int(ignore.group(1)) if ignore else 255
    valid = (rgba[..., 3] > 127) & ~np.all(rgba[..., :3] == nod, axis=-1) & (rgba[..., :3].max(axis=-1) > 0)
    names = re.search(r"band names\s*=\s*\{([^}]*)\}", head)
    bands = [s.strip() for s in names.group(1).split(",")] if names else []
    return eq, valid, bands


def signal_alpha(code, rgb):
    """Opacity from signal strength, so the map underneath shows through where a
    composite says little. The colours stay the CRISM team's; this transparency is ours.
    A faint tint (FOOTPRINT) is kept everywhere an image has data, to show its footprint.

    MAF: the strongest of the three mafic indices. CR2: the weaker of the two carbonate
    band minima (both must be raised for a carbonate; the blue index alone is high nearly
    everywhere and would hide the map)."""
    if code == "CR2":
        sig = np.minimum(rgb[..., 0], rgb[..., 1])
        s = rg.smoothstep((sig - 35.0) / 110.0)
    else:
        sig = rgb.max(axis=-1)
        s = rg.smoothstep((sig - 70.0) / 120.0)
    return FOOTPRINT + (1 - FOOTPRINT) * s


def reduce_rgba(a):
    """Halve an RGBA mosaic, averaging colour by coverage."""
    al = a[..., 3:4].astype(np.float32) / 255.0
    pm = rg.reduce2(a[..., :3].astype(np.float32) * al)
    ar = rg.reduce2(al)
    rgb = pm / np.maximum(ar, 1e-3)
    return np.concatenate([np.clip(np.rint(rgb), 0, 255), np.clip(np.rint(ar * 255), 0, 255)], axis=-1).astype(np.uint8)


def build():
    obs = observations()
    if not obs:
        log("crism: the Orbital Data Explorer lists no MTRDR product over Jezero")
        return 1
    log(f"crism: {len(obs)} MTRDR observations over Jezero")
    for product, (code, legend) in LAYERS.items():
        loaded = []
        for o in obs:
            try:
                got = load_browse(o, code)
            except IOError as e:
                log(f"  {o['id']}: {e}")
                got = None
            if got is None:
                log(f"  {o['id']}: no {code} browse product")
                continue
            loaded.append((o, *got))
        if not loaded:
            continue
        w = min(e.bounds()[0] for _, e, _, _ in loaded)
        s = min(e.bounds()[1] for _, e, _, _ in loaded)
        e_ = max(e.bounds()[2] for _, e, _, _ in loaded)
        n = max(e.bounds()[3] for _, e, _, _ in loaded)
        z = ZOOMS[0]
        rect = rg.tiles_for_box((w, s, e_, n), ZOOMS[-1])
        for _ in range(z - ZOOMS[-1]):
            rect = rg.child_rect(rect)
        g = Grid.of_tiles(z, rect)
        mosaic = np.zeros((g.h, g.w, 4), dtype=np.uint8)
        bands = []
        for o, eq, valid, b in loaded:
            bands = b or bands
            fr, fc = eq.frac(g.lons(), g.lats())
            r_in = np.nonzero((fr > 0) & (fr < eq.data.shape[0] - 1))[0]
            c_in = np.nonzero((fc > 0) & (fc < eq.data.shape[1] - 1))[0]
            if not len(r_in) or not len(c_in):
                continue
            rs, cs = slice(r_in[0], r_in[-1] + 1), slice(c_in[0], c_in[-1] + 1)
            rgb = rg.sample_sep(eq.data, fr[rs], fc[cs], 1)
            ok = rg.sample_sep(valid.astype(np.float32), fr[rs], fc[cs], 1) > 0.999
            view = mosaic[rs, cs]
            view[ok, :3] = np.clip(np.rint(rgb[ok]), 0, 255).astype(np.uint8)
            view[ok, 3] = np.rint(255 * signal_alpha(code, rgb[ok])).astype(np.uint8)
        total = 0
        a = mosaic
        for zz in ZOOMS:
            gz = Grid.of_tiles(zz, rect)
            total += rg.write_tiles(product, zz, gz, a, rect, "rgba")
            if zz != ZOOMS[-1]:
                a = reduce_rgba(a)
                rect = (rect[0] // 2, rect[1] // 2, rect[2] // 2, rect[3] // 2)
        cov = float((mosaic[..., 3] > 0).mean())
        log(f"  {product}: {len(loaded)} images, bands {bands}, {total} tiles at zoom {ZOOMS[-1]} to {ZOOMS[0]}, box {[round(v, 4) for v in (w, s, e_, n)]}")
        add_source(
            id="crism-mtrdr-" + ("mafic" if code == "MAF" else "carbonate"),
            name=f"CRISM targeted observations of Jezero, {code} browse composite",
            mission="Mars Reconnaissance Orbiter (CRISM)",
            product=f"MRO-M-CRISM-5-RDR-MPTARGETED-V1.0 browse products BR{code}J_MTR3: " + ", ".join(o["id"].split("_")[0].upper() for o, *_ in loaded),
            url=ARCHIVE,
            licence="Public domain (NASA/JPL/JHUAPL; PDS Geosciences Node; Seelos et al. 2016, Viviano-Beck et al. 2014)",
            notes=f"Spectral overlay, zoom {ZOOMS[-1]} to {ZOOMS[0]}: red, green, blue are the summary parameters "
            f"{', '.join(bands)}; {legend}. Each image keeps the CRISM team's own stretch, so colours are not "
            f"comparable between images. Opacity follows signal strength (our choice, to let the map show through); "
            f"a faint tint marks each image's footprint. Found through the PDS Orbital Data Explorer. "
            f"Images cover {100 * cov:.0f}% of the tile area.",
        )
    return 0


if __name__ == "__main__":
    sys.exit(build())
