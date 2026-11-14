"""USGS Mars Global Cave Candidate Catalog, cut to the region -> public/data/caves.json

Source: Cushing and Okubo, Mars Global Cave Candidate Catalog (MGC3), USGS
Astrogeology / PDS, 2017. 1,062 candidate cave entrances found in orbital
images. None of them is a confirmed cave.

No candidate lies inside the region itself (13.1..23.8 N, 71.8..83.1 E), so
the cut keeps a margin of NEAR_DEG degrees and each record says whether it is
inside (inRegion).

Output: { id, name, lon, lat, note, type, priority, inRegion }[]
"""

from __future__ import annotations

import csv
import io
import sys
import zipfile

from build_common import DATA, REGION, add_source, fetch, in_region, write_json

PAGE = "https://astrogeology.usgs.gov/search/map/mars_global_cave_candidate_catalog_v1_cushing"
ZIP_URL = ("https://astrogeology.usgs.gov/ckan/dataset/c2960f77-ee20-4cc6-ac85-abbecc0fc7f6/resource/"
           "ccd54fb2-9a50-46bf-8971-80c241bb2f40/download/mars_cave_catalog.zip")
NEAR_DEG = 6.0

# Type codes, from the catalog's archive description (section C-4), in plain words.
TYPES = {
    "APC": "atypical pit crater",
    "crk": "deep, dark crack or fracture",
    "end": "opening at the far end of a channel, fracture or trough",
    "flr": "opening in the floor of a channel, fracture or trough",
    "irr": "irregular opening",
    "kst": "opening in karst-type terrain",
    "lat": "sideways entrance, often in a cliff wall",
    "pin": "small, sharp hole a few pixels across",
    "pit": "collapse pit",
    "pol": "opening in polar ice",
    "rim": "opening on the rim of a pit, channel or trough",
    "sky": "skylight into a lava tube",
    "srp": "small, shallow, round rimless pit",
}


def main() -> int:
    z = zipfile.ZipFile(io.BytesIO(fetch(ZIP_URL, "mars_cave_catalog.zip", timeout=300)))
    text = z.read("data/Mars_Cave_Catalog.csv").decode("utf-8", "replace")
    # The header row is mislabelled in the file. Columns are:
    # id, east longitude, latitude, type code, priority, APC diameter (m), APC depth (m), comment.
    rows = list(csv.reader(io.StringIO(text)))[1:]
    out = []
    for r in rows:
        if len(r) < 8:
            continue
        try:
            lon, lat = float(r[1]), float(r[2])
        except ValueError:
            continue
        if lon > 180:
            lon -= 360
        if not in_region(lon, lat, NEAR_DEG):
            continue
        code = r[3].strip()
        kind = TYPES.get(code, "candidate opening")
        comment = " ".join(r[7].split())
        prio = r[4].strip()
        note = f"Candidate cave entrance seen from orbit: {kind}. Not confirmed as a cave."
        if comment:
            note += f" Catalog comment: {comment}."
        out.append(
            {
                "id": r[0].strip(),
                "name": f"Cave candidate {r[0].strip()}",
                "lon": round(lon, 4),
                "lat": round(lat, 4),
                "note": note,
                "type": code,
                "priority": int(prio) if prio.isdigit() else None,
                "inRegion": in_region(lon, lat),
            }
        )
    out.sort(key=lambda c: c["id"])
    write_json(DATA / "caves.json", out, indent=1)
    inside = sum(1 for c in out if c["inRegion"])
    print(f"{len(rows)} candidates in the catalog; {inside} inside the region; {len(out)} within {NEAR_DEG:g} degrees")
    add_source(
        id="usgs-caves",
        name="Mars Global Cave Candidate Catalog (MGC3)",
        mission="USGS Astrogeology (Mars Odyssey THEMIS, MRO CTX and HiRISE images)",
        product="Mars_Cave_Catalog.csv, version 1 (Cushing and Okubo, 2017)",
        url=PAGE,
        licence="Public domain (USGS / NASA PDS).",
        notes=f"{len(rows)} candidate cave entrances on Mars. {inside} lie inside the region "
        f"({REGION['s']} to {REGION['n']} N, {REGION['w']} to {REGION['e']} E); the file keeps the {len(out)} "
        f"within {NEAR_DEG:g} degrees of it, each marked inRegion false. They are candidates seen in orbital "
        "images, not confirmed caves. Priority 1 is the catalog's highest targeting priority.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
