"""USGS global geologic map of Mars, cut to the region -> public/data/geology.json

Source: Tanaka et al. (2014), Geologic Map of Mars, USGS SIM 3292, served by
NASA Mars Trek as an ArcGIS feature layer. Polygons are clipped to the region
and simplified to about 1 km. Shared borders are simplified once, so the
units still fit together with no gaps. Each unit's colour is the USGS map
colour, read from the layer's renderer.

Output: { units: { code, name, colour, kind, what, period, age, ageMaxGa, ageMinGa }[],
          features: GeoJSON FeatureCollection (properties.unit) }
"""

from __future__ import annotations

import sys

from shapely.geometry import MultiPolygon, Point, Polygon, box, mapping, shape
from shapely.ops import linemerge, polygonize, unary_union

from build_common import DATA, MARS_RADIUS_M, REGION, add_source, fetch_json, url_with, write_json

import math

LAYER = "https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/0"
SIM = "https://pubs.usgs.gov/sim/3292/"
SIMPLIFY_M = 1000.0
DEG_PER_M = 360.0 / (2 * math.pi * MARS_RADIUS_M)

# Period boundaries after Michael (2013), as used with SIM 3292, in billions of years (Ga):
# Early / Middle Noachian 3.94, Middle / Late Noachian 3.83, Noachian / Hesperian 3.71,
# Early / Late Hesperian 3.61, Hesperian / Amazonian 3.37 (Neukum chronology).
# code: (kind, what, period, age in words, oldest Ga, youngest Ga)
UNITS = {
    "eNh": ("highland", "The oldest highland crust, broken up by giant impacts in Mars's first few hundred million years.",
            "Early Noachian", "more than 3.9 billion years old", 4.1, 3.94),
    "mNh": ("highland", "Ancient cratered highland: a mix of impact rubble, old lava and sediment.",
            "Middle Noachian", "about 3.8 to 3.9 billion years old", 3.94, 3.83),
    "mNhm": ("highland", "Rugged highland mountains: blocks of old crust pushed up around a giant impact basin.",
             "Middle Noachian", "about 3.8 to 3.9 billion years old", 3.94, 3.83),
    "lNh": ("highland", "Smoother highland plains: lava and sediment laid over the older cratered ground.",
            "Late Noachian", "about 3.7 to 3.8 billion years old", 3.83, 3.71),
    "HNt": ("transition", "Old highland knobs and mesas with younger plains and slope deposits between them, "
            "where the highlands step down toward the lowlands.",
            "Noachian to Hesperian", "about 3.4 to 3.9 billion years old", 3.94, 3.37),
    "eHv": ("volcanic", "Flood lavas: thin, runny basalt flows that spread out as wide, ridged plains.",
            "Early Hesperian", "about 3.6 to 3.7 billion years old", 3.71, 3.61),
    "lHt": ("transition", "Plains of sediment and lava laid down along the edge between highlands and lowlands.",
            "Late Hesperian", "about 3.4 to 3.6 billion years old", 3.61, 3.37),
    "lHl": ("lowland", "Lowland plains of sediment, left by floods and later reworked by ice.",
            "Late Hesperian", "about 3.4 to 3.6 billion years old", 3.61, 3.37),
    "AHi": ("impact", "A younger impact crater with its rim and the blanket of rock thrown out around it.",
            "Hesperian to Amazonian", "less than about 3.7 billion years old", 3.71, 0.0),
}


def query_region() -> dict:
    url = url_with(
        LAYER + "/query",
        {
            "f": "geojson",
            "where": "1=1",
            "outFields": "Unit,UnitDesc",
            "geometry": f"{REGION['w']},{REGION['s']},{REGION['e']},{REGION['n']}",
            "geometryType": "esriGeometryEnvelope",
            "inSR": "4326",
            "spatialRel": "esriSpatialRelIntersects",
            "outSR": "4326",
            "returnGeometry": "true",
        },
    )
    d = fetch_json(url, "sim3292_region.geojson", timeout=180)
    if d.get("exceededTransferLimit") or d.get("properties", {}).get("exceededTransferLimit"):
        raise RuntimeError("the layer cut the answer short: page the query")
    return d


def renderer_colours() -> dict[str, str]:
    """UnitDesc -> '#rrggbb' from the layer's unique-value renderer."""
    info = fetch_json(LAYER + "?f=json", "sim3292_layer.json")
    r = info["drawingInfo"]["renderer"]
    if r.get("field1") != "UnitDesc":
        raise RuntimeError(f"renderer is keyed on {r.get('field1')}, not UnitDesc")
    out = {}
    for u in r["uniqueValueInfos"]:
        c = u["symbol"]["color"]
        out[u["value"].strip()] = "#%02x%02x%02x" % (c[0], c[1], c[2])
    return out


def polygons_of(g) -> list[Polygon]:
    if g.is_empty:
        return []
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, MultiPolygon):
        return list(g.geoms)
    return [p for part in getattr(g, "geoms", []) for p in polygons_of(part)]


def simplify_coverage(clipped: list[tuple[str, Polygon]], tol: float) -> list[tuple[str, Polygon]]:
    """Simplify shared borders once, so neighbours still meet without gaps or overlaps."""
    lines = unary_union([p.boundary for _, p in clipped])  # noded linework
    merged = linemerge(lines) if lines.geom_type != "LineString" else lines
    parts = list(merged.geoms) if hasattr(merged, "geoms") else [merged]
    simple = unary_union([ln.simplify(tol, preserve_topology=True) for ln in parts])  # node again
    out = []
    for face in polygonize(simple):
        if face.area < (tol * tol) / 4:
            continue
        pt = face.representative_point()
        unit = next((u for u, p in clipped if p.contains(pt)), None)
        if unit is None:  # a sliver moved by simplification: give it the nearest unit
            unit = min(clipped, key=lambda up: up[1].distance(pt))[0]
        out.append((unit, face))
    return out


def rounded(geom: dict, nd: int = 4) -> dict:
    def r(c):
        return [round(c[0], nd), round(c[1], nd)] if isinstance(c[0], (int, float)) else [r(x) for x in c]

    return {"type": geom["type"], "coordinates": r(geom["coordinates"])}


def unit_at(features: list[dict], lon: float, lat: float) -> str | None:
    pt = Point(lon, lat)
    for f in features:
        if shape(f["geometry"]).contains(pt):
            return f["properties"]["unit"]
    return None


def main() -> int:
    raw = query_region()
    colours = renderer_colours()
    region = box(REGION["w"], REGION["s"], REGION["e"], REGION["n"])

    names: dict[str, str] = {}
    clipped: list[tuple[str, Polygon]] = []
    for f in raw["features"]:
        code = f["properties"]["Unit"].strip()
        names[code] = f["properties"]["UnitDesc"].strip()
        g = shape(f["geometry"])
        if not g.is_valid:
            g = g.buffer(0)
        for p in polygons_of(g.intersection(region)):
            clipped.append((code, p))

    faces = simplify_coverage(clipped, SIMPLIFY_M * DEG_PER_M)
    by_unit: dict[str, list[Polygon]] = {}
    for code, face in faces:
        by_unit.setdefault(code, []).append(face)

    features = []
    for code in sorted(by_unit):
        for p in polygons_of(unary_union(by_unit[code])):
            features.append({"type": "Feature", "properties": {"unit": code}, "geometry": rounded(mapping(p))})

    units = []
    for code in sorted(by_unit, key=lambda c: -UNITS.get(c, ("", "", "", "", 0, 0))[4]):
        if code not in UNITS:
            raise RuntimeError(f"unit {code} ({names[code]}) has no plain-English entry in UNITS")
        if names[code] not in colours:
            raise RuntimeError(f"no renderer colour for {names[code]}")
        kind, what, period, age, a0, a1 = UNITS[code]
        units.append({"code": code, "name": names[code], "colour": colours[names[code]], "kind": kind,
                      "what": what, "period": period, "age": age, "ageMaxGa": a0, "ageMinGa": a1})

    out = {"units": units, "features": {"type": "FeatureCollection", "features": features}}
    write_json(DATA / "geology.json", out)

    covered = unary_union([shape(f["geometry"]) for f in features]).area / region.area
    npts = sum(len(ring) for f in features for ring in f["geometry"]["coordinates"])
    print(f"{len(units)} units, {len(features)} polygons, {npts} points, {covered * 100:.2f}% of the region covered")
    ok = True
    # In the source, the trough of Nili Fossae itself (22 N, 76.5 E) is a strip of the massif unit mNhm;
    # the plateau it cuts is mNh, checked here just east of the trough.
    for label, lon, lat, want in (("Jezero", 77.6, 18.4, "HNt"), ("Nili Fossae plateau", 77.0, 22.0, "mNh"),
                                  ("Nili Fossae trough", 76.5, 22.0, "mNhm"), ("Syrtis", 73.0, 15.0, "eHv")):
        got = unit_at(features, lon, lat)
        print(f"  {label} ({lat} N, {lon} E): {got}" + ("" if got == want else f"  EXPECTED {want}"))
        ok = ok and got == want

    add_source(
        id="usgs-geology",
        name="Geologic Map of Mars (USGS SIM 3292)",
        mission="USGS Astrogeology (Tanaka, Skinner, Dohm, Irwin, Kolb, Fortezzo, Platz, Michael and Hare, 2014)",
        product="SIM3292_Global_Geology feature layer on NASA Mars Trek",
        url=SIM,
        licence="Public domain (USGS).",
        notes=f"Queried from {LAYER}/query for the region envelope, clipped to it, borders simplified to about "
        f"{SIMPLIFY_M / 1000:g} km. Colours are the USGS map colours from the layer's renderer. The map was made "
        "at 1:20,000,000, so unit borders are good to a few kilometres at best. The one-line descriptions, "
        "periods and ages in words are plain-English summaries of the map's unit descriptions; ages follow the "
        "period boundaries of Michael (2013): Noachian before about 3.7 billion years ago, Hesperian to about "
        "3.4, Amazonian since.",
    )
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
