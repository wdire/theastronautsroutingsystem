"""The raw products behind the tile package: where they live, how each is fetched (cached
under tools/.cache/region) and its entry for sources.json. Used by build_region.py."""

from __future__ import annotations

import numpy as np

import region as rg
from region import CACHE, CORE, REGION, EqArray, StripTiff, cached_array, log
from sources import add_source

PD = "Public domain (NASA / USGS); credit the instrument teams named"

TREK = "https://trek.nasa.gov/tiles/Mars/EQ/{layer}/1.0.0/default/default028mm/{{z}}/{{y}}/{{x}}.{ext}"
VIKING_LAYER = "Mars_Viking_MDIM21_ClrMosaic_global_232m"
THEMIS_LAYER = "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018"
VIKING_URL = TREK.format(layer=VIKING_LAYER, ext="jpg")
THEMIS_URL = TREK.format(layer=THEMIS_LAYER, ext="png")
ESRI_CTX = "https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer"
ESRI_CTX_URL = ESRI_CTX + "/tile/{z}/{y}/{x}"
MEGDR_DIR = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/"
MEGDR_URL = MEGDR_DIR + "megt90n000eb.img"
USGS = "https://planetarymaps.usgs.gov/mosaic/"
HRSC_URL = USGS + "Mars/HRSC_MOLA_Blend/Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2.tif"
CTX_DTM_URL = USGS + "mars2020_trn/CTX/JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0.tif"
CTX_ORTHO_URL = USGS + "mars2020_trn/CTX/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0.tif"
HIRISE_DTM_URL = USGS + "mars2020_trn/HiRISE/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
HIRISE_STEP = 5  # read the 1 m model at 5 m


def megdr():
    """MOLA MEGDR topography, 16 pixels per degree, as metres above the areoid on a
    -180..180 grid."""

    def make():
        path = rg.fetch_file(MEGDR_URL, CACHE / "megdr" / "megt90n000eb.img")
        a = np.fromfile(path, dtype=">i2").reshape(2880, 5760)
        return np.roll(a, 2880, axis=1).astype(np.int16)  # 0..360 E -> -180..180

    data = cached_array(CACHE / "megdr" / "megt16.npy", make)
    add_source(
        id="mola-megdr",
        name="MOLA Mission Experiment Gridded Data Record, topography at 16 pixels per degree",
        mission="Mars Global Surveyor (MOLA)",
        product="MGS-M-MOLA-5-MEGDR-L3-V1.0, megt90n000eb.img",
        url=MEGDR_DIR,
        licence=PD + " (NASA PDS Geosciences Node; Smith et al. 2003)",
        notes="Planet elevation tiles, zoom 0 to 3. Heights are metres above the MOLA areoid.",
    )
    return EqArray(data, -180.0, 90.0, 1 / 16)


def viking(level, box, margin=0.1, label="Viking"):
    eq, valid = rg.fetch_eq_mosaic(VIKING_URL, level, 256, box, CACHE / "trek" / VIKING_LAYER, "jpg", margin, channels=3, label=label)
    add_source(
        id="viking-mdim21-colour",
        name="Viking MDIM 2.1 colour mosaic, 232 m",
        mission="Viking Orbiters 1 and 2",
        product=VIKING_LAYER + " (NASA Mars Trek WMTS)",
        url="https://trek.nasa.gov/tiles/Mars/EQ/" + VIKING_LAYER + "/1.0.0/WMTSCapabilities.xml",
        licence=PD + " (NASA/JPL/USGS), served by NASA Mars Trek",
        notes="Planet imagery, zoom 0 to 4, and the colour of the region, zoom 5 to 8. The hue is pulled toward "
        "ochre with the luminance kept and the brightest highlights rolled off (polar ice stays white); that "
        "grading is ours, not the product's.",
    )
    return eq, valid


def themis(box, margin=0.06):
    eq, valid = rg.fetch_eq_mosaic(THEMIS_URL, 9, 256, box, CACHE / "trek" / THEMIS_LAYER, "png", margin, channels=1, label="THEMIS day IR")
    add_source(
        id="themis-day-ir",
        name="THEMIS daytime infrared global mosaic, 100 m, version 2",
        mission="2001 Mars Odyssey (THEMIS)",
        product=THEMIS_LAYER + " (NASA Mars Trek WMTS)",
        url="https://trek.nasa.gov/tiles/Mars/EQ/" + THEMIS_LAYER + "/1.0.0/WMTSCapabilities.xml",
        licence=PD + " (NASA/JPL/ASU; Edwards et al. 2011), served by NASA Mars Trek",
        notes="Fine detail of the region imagery at zoom 9 and 10: only its high-pass is used, on Viking colour.",
    )
    return eq, valid


def ctx_esri(level, box, margin=0.01, label="CTX"):
    eq, valid = rg.fetch_eq_mosaic(
        ESRI_CTX_URL, level, 512, box, CACHE / "esri_ctx", "png", margin, channels=1, label=label, nodata=0, repair=True
    )
    add_source(
        id="ctx-global-mosaic",
        name="CTX global mosaic (Murray Lab beta01), about 5 m",
        mission="Mars Reconnaissance Orbiter (CTX)",
        product="Esri OnMars CTX MapServer",
        url=ESRI_CTX,
        licence="NASA/JPL/MSSS/Caltech Murray Lab/Esri; CTX data are public domain, the mosaic is free to use with credit",
        notes="Fine detail of the core imagery at zoom 11 to 13 (high-pass only), and at zoom 14 where the Mars 2020 "
        "ortho has no data. About one tile in six on the server is cut short and holds the wrong picture; those "
        "are rebuilt from the level below, or enlarged from the level above. The app also reads it live outside "
        "the package.",
    )
    return eq, valid


def hrsc(box, margin=0.05):
    """The HRSC and MOLA blended DEM, 200 m: only the window, one range request per row."""
    t = StripTiff(HRSC_URL)
    w, s, e, n = box
    c0 = int(np.floor(t.col_of_lon(w - margin)))
    c1 = int(np.ceil(t.col_of_lon(e + margin))) + 1
    r0 = int(np.floor(t.row_of_lat(n + margin)))
    r1 = int(np.ceil(t.row_of_lat(s - margin))) + 1
    name = f"hrsc_{r0}_{r1}_{c0}_{c1}.npy"
    data = cached_array(CACHE / "usgs" / name, lambda: t.read_window(r0, r1, c0, c1, label="HRSC+MOLA rows", part_dir=CACHE / "usgs" / "parts_hrsc"))
    add_source(
        id="hrsc-mola-blend-dem",
        name="Mars HRSC and MOLA blended digital elevation model, 200 m, version 2",
        mission="Mars Express (HRSC) and Mars Global Surveyor (MOLA)",
        product="Mars_HRSC_MOLA_BlendDEM_Global_200mp_v2",
        url=HRSC_URL,
        licence=PD + " (USGS Astrogeology; Fergason et al. 2018)",
        notes="Region elevation, zoom 6 to 10, read by HTTP ranges for the window only. Metres above the MOLA areoid.",
    )
    return t.eq(data, r0, c0), t.nodata


def _whole(url, name):
    path = rg.fetch_file(url, CACHE / "usgs" / name)
    t = StripTiff(path)
    off = int(t.strip_offsets[0])
    data = np.memmap(path, dtype=t.dtype, mode="r", offset=off, shape=(t.height, t.width))
    if not np.all(np.diff(t.strip_offsets) == t.rows_per_strip * t.width * t.dtype.itemsize):
        raise IOError(f"{name}: strips are not contiguous")
    return t, np.asarray(data).astype(t.dtype.newbyteorder("="))


def ctx_dtm():
    t, data = _whole(CTX_DTM_URL, "JEZ_ctx_B_soc_008_DTM_20m.tif")
    add_source(
        id="m2020-ctx-dtm",
        name="Mars 2020 terrain relative navigation CTX DTM mosaic of Jezero, 20 m",
        mission="Mars 2020 / Mars Reconnaissance Orbiter (CTX)",
        product="JEZ_ctx_B_soc_008_DTM_MOLAtopography_DeltaGeoid_20m_Eqc_latTs0_lon0",
        url=CTX_DTM_URL,
        licence=PD + " (USGS Astrogeology; Fergason et al. 2020)",
        notes="Crater elevation, zoom 12 and 13. Level-matched to the HRSC and MOLA blend (its long wavelengths "
        "follow the blend) and feathered into it at the edge of the model.",
    )
    return t.eq(data, 0, 0), (data > -1e30) & np.isfinite(data)


def ctx_ortho():
    t, data = _whole(CTX_ORTHO_URL, "JEZ_ctx_B_soc_008_orthoMosaic_6m.tif")
    add_source(
        id="m2020-ctx-ortho",
        name="Mars 2020 terrain relative navigation CTX orthomosaic of Jezero, 6 m",
        mission="Mars 2020 / Mars Reconnaissance Orbiter (CTX)",
        product="JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0",
        url=CTX_ORTHO_URL,
        licence=PD + " (USGS Astrogeology; Fergason et al. 2020)",
        notes="Fine detail of the crater imagery at zoom 14 (high-pass only).",
    )
    return t.eq(data, 0, 0), data > 0


def hirise_dtm():
    """The 1 m HiRISE model read at 5 m: every fifth row by range, columns averaged in
    fives. About a fifth of the 1.8 GB file crosses the wire, once."""
    t = StripTiff(HIRISE_DTM_URL)
    step = HIRISE_STEP

    def make():
        rows = t.read_window(step // 2, t.height, 0, t.width, row_step=step, label="HiRISE DTM rows", part_dir=CACHE / "usgs" / "parts_hirise")
        w = t.width // step * step
        a = rows[:, :w].reshape(rows.shape[0], w // step, step).astype(np.float32)
        ok = a > -1e30
        n = ok.sum(axis=2)
        m = np.where(ok, a, 0).sum(axis=2) / np.maximum(n, 1)
        m[n < (step + 1) // 2] = np.nan
        return m.astype(np.float32)

    data = cached_array(CACHE / "usgs" / f"hirise_dtm_{step}m.npy", make)
    add_source(
        id="m2020-hirise-dtm",
        name="Mars 2020 terrain relative navigation HiRISE DTM mosaic of Jezero, 1 m",
        mission="Mars 2020 / Mars Reconnaissance Orbiter (HiRISE)",
        product="JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40",
        url=HIRISE_DTM_URL,
        licence=PD + " (USGS Astrogeology; Fergason et al. 2020)",
        notes="Elevation at zoom 14, read at 5 m by HTTP ranges (every fifth row, columns averaged in fives). "
        "Level-matched to the CTX model beneath it and feathered at its edge.",
    )
    return t.eq(data, 0, 0, row_step=step, col_step=step), np.isfinite(data)


def valid_box(eq, valid):
    """[w, s, e, n] of the valid pixels of an EqArray."""
    rows = np.nonzero(valid.any(axis=1))[0]
    cols = np.nonzero(valid.any(axis=0))[0]
    return (
        eq.lon0 + cols[0] * eq.dlon,
        eq.lat0 - (rows[-1] + 1) * eq.dlat,
        eq.lon0 + (cols[-1] + 1) * eq.dlon,
        eq.lat0 - rows[0] * eq.dlat,
    )


def clip_box(box, to):
    return (max(box[0], to[0]), max(box[1], to[1]), min(box[2], to[2]), min(box[3], to[3]))


def round_box(box, nd=5):
    return [round(float(v), nd) for v in box]


if __name__ == "__main__":
    # Fetch everything once (resumable); the build then runs from the cache.
    import sys

    what = sys.argv[1:] or ["megdr", "viking", "hrsc", "ctxdtm", "ortho", "themis", "ctx", "hirise"]
    z5 = rg.rect_bounds(5, rg.tiles_for_box(REGION, 5))
    z6 = rg.rect_bounds(6, rg.tiles_for_box(REGION, 6))
    z9 = rg.rect_bounds(9, rg.tiles_for_box(REGION, 9))
    z11 = rg.rect_bounds(11, rg.tiles_for_box(CORE, 11))
    for w in what:
        log("fetch", w)
        if w == "megdr":
            megdr()
        elif w == "viking":
            viking(4, (-180, -90, 180, 90), 0, "Viking planet")
            viking(7, z5, 0.1, "Viking region")
        elif w == "hrsc":
            hrsc(z6)
        elif w == "ctxdtm":
            eq, ok = ctx_dtm()
            log("  CTX DTM valid box", round_box(valid_box(eq, ok)))
        elif w == "ortho":
            eq, ok = ctx_ortho()
            log("  CTX ortho valid box", round_box(valid_box(eq, ok)))
        elif w == "themis":
            themis(z9)
        elif w == "ctx":
            ctx_esri(11, z11, label="CTX level 11")
        elif w == "hirise":
            eq, ok = hirise_dtm()
            log("  HiRISE valid box", round_box(valid_box(eq, ok)))
