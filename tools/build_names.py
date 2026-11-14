"""IAU Gazetteer names in and near the region -> public/data/names.json

Source: the Gazetteer of Planetary Nomenclature (USGS / IAU), Mars centre
points shapefile. Longitudes there are east-positive 0..360; over this region
they are the same numbers as the app's east longitude (71.8..83.1 E).

Output: { id, name, type, lon, lat, diameterKm, minZoom }[]
"""

from __future__ import annotations

import io
import math
import struct
import sys
import zipfile

from build_common import DATA, REGION, add_source, fetch, slug, write_json

URL = "https://asc-planetarynames-data.s3.us-west-2.amazonaws.com/MARS_nomenclature_center_pts.zip"
PAGE = "https://planetarynames.wr.usgs.gov/Page/MARS/target"
PAD = 2.0  # degrees around the region
NEAR = 15.0  # degrees: how far outside a large feature's centre may lie
KM_PER_DEG = 59.27  # one degree of latitude on Mars


def read_dbf(raw: bytes) -> list[dict]:
    n, header_len, rec_len = struct.unpack("<xxxxIHH", raw[:12])
    fields, pos = [], 32
    while raw[pos] != 0x0D:
        d = raw[pos : pos + 32]
        fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
        pos += 32
    rows = []
    for i in range(n):
        r = raw[header_len + i * rec_len : header_len + (i + 1) * rec_len]
        if r[:1] == b"*":  # deleted record
            continue
        p, rec = 1, {}
        for name, length in fields:
            rec[name] = r[p : p + length].decode("utf-8", "replace").strip()
            p += length
        rows.append(rec)
    return rows


def min_zoom(diameter_km: float, name: str) -> int:
    """Big features show first. Jezero is the subject of the app, so it shows early."""
    if name == "Jezero":
        return 4
    for limit, zoom in ((1000, 2), (400, 3), (150, 4), (60, 5), (30, 6), (15, 7), (7, 8), (3, 9)):
        if diameter_km >= limit:
            return zoom
    return 10


def to_east(lon: float) -> float:
    """East-positive 0..360 -> the app's east longitude in -180..180."""
    return lon - 360.0 if lon > 180.0 else lon


def main() -> int:
    z = zipfile.ZipFile(io.BytesIO(fetch(URL, "MARS_nomenclature_center_pts.zip", timeout=180)))
    dbf = next(n for n in z.namelist() if n.lower().endswith(".dbf"))
    rows = read_dbf(z.read(dbf))

    w, e = REGION["w"] - PAD, REGION["e"] + PAD
    s, n = REGION["s"] - PAD, REGION["n"] + PAD
    out, seen = [], set()
    for r in rows:
        if "Adopted" not in r.get("approval", ""):
            continue
        try:
            lon, lat = float(r["center_lon"]), float(r["center_lat"])
            dia = float(r["diameter"] or 0)
            box = [float(r[k]) for k in ("min_lon", "min_lat", "max_lon", "max_lat")]
        except ValueError:
            continue
        if r["type"].startswith("Albedo"):  # telescope-era bright and dark markings, not landforms
            continue
        centre_in = w <= lon <= e and s <= lat <= n
        # Large features (plains, terrae) whose centre is outside but which reach into the region:
        # their box crosses the region and their centre is near it (within NEAR degrees, or within
        # 0.6 of their own size of the region's centre, so far-off giants like Utopia stay out).
        box_crosses = (
            dia >= 300
            and box[0] <= box[2]  # does not wrap the 0/360 meridian
            and box[0] <= REGION["e"] and box[2] >= REGION["w"]
            and box[1] <= REGION["n"] and box[3] >= REGION["s"]
        )
        near = (REGION["w"] - NEAR <= lon <= REGION["e"] + NEAR and REGION["s"] - NEAR <= lat <= REGION["n"] + NEAR)
        clon, clat = (REGION["w"] + REGION["e"]) / 2, (REGION["s"] + REGION["n"]) / 2
        off_km = KM_PER_DEG * math.hypot((lon - clon) * math.cos(math.radians((lat + clat) / 2)), lat - clat)
        reaches_in = box_crosses and (near or off_km <= 0.6 * dia)
        if not (centre_in or reaches_in):
            continue
        name = r["name"]
        fid = slug(r.get("clean_name") or name)
        if fid in seen:
            fid += "-" + r["link"].rstrip("/").split("/")[-1]
        seen.add(fid)
        out.append(
            {
                "id": fid,
                "name": name,
                "type": r["type"].split(",")[0].strip(),
                "lon": round(to_east(lon), 4),
                "lat": round(lat, 4),
                "diameterKm": round(dia, 1),
                "minZoom": min_zoom(dia, name),
            }
        )
    out.sort(key=lambda f: (f["minZoom"], -f["diameterKm"], f["name"]))
    write_json(DATA / "names.json", out)
    print(f"{len(out)} names; by minZoom: " + ", ".join(
        f"z{zz}: {sum(1 for f in out if f['minZoom'] == zz)}" for zz in sorted({f['minZoom'] for f in out})))
    add_source(
        id="iau-names",
        name="Gazetteer of Planetary Nomenclature: Mars feature names",
        mission="IAU Working Group for Planetary System Nomenclature / USGS Astrogeology",
        product="MARS_nomenclature_center_pts (shapefile of centre points)",
        url=PAGE,
        licence="Public domain (USGS). Names approved by the International Astronomical Union.",
        notes=f"Downloaded from {URL}. Kept: approved names with their centre within {PAD:g} degrees of the region, "
        "and features over 300 km across that reach into it from nearby. Albedo features are left out. minZoom is set from the feature's size, so large "
        "features are labelled first.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
