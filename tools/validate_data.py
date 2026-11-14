"""Check every dataset under public/data and public/models against its shape.

    python tools/validate_data.py

Prints one line per file and exits non-zero if any check fails. Standard
library only, so it runs with any Python 3.10 or newer.
"""

from __future__ import annotations

import json
import pathlib
import re
import struct
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
DATA = PUBLIC / "data"
MODELS = PUBLIC / "models"
SOURCES_D = ROOT / "tools" / "sources.d"

REGION = (71.8, 13.1, 83.1, 23.8)  # west, south, east, north
CRATER = (76.9, 17.9, 78.2, 18.9)  # Jezero and its rim: everything the rover has touched
DATA_BUDGET = 9.5e6
MODELS_BUDGET = 5.0e6

SOURCE_FIELDS = ("id", "name", "mission", "product", "url", "licence", "notes", "retrieved")
EXPECTED_SOURCES = (
    "iau-names", "m20-traverse", "m20-places", "m20-raw-images", "m20-samples", "weather-rems", "weather-meda",
    "usgs-caves", "landing-sites", "usgs-geology", "model-perseverance", "model-ingenuity", "model-sev",
    "model-habitat", "model-z2",
)
MODEL_NAMES = ("perseverance", "ingenuity", "sev", "habitat", "z2")

# Geology spot checks (lon, lat, unit). In the USGS layer the trough of Nili Fossae at 22 N, 76.5 E is a
# strip of the massif unit mNhm; the plateau around it is mNh.
GEOLOGY_CHECKS = (
    ("Jezero", 77.6, 18.4, "HNt"),
    ("Nili Fossae plateau", 77.0, 22.0, "mNh"),
    ("Nili Fossae trough", 76.5, 22.0, "mNhm"),
    ("Syrtis Major", 73.0, 15.0, "eHv"),
)

EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️]")
DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CLOCK = re.compile(r"^\d{2}:\d{2}$")


class Check:
    def __init__(self) -> None:
        self.errors: list[str] = []

    def need(self, ok: bool, message: str) -> bool:
        if not ok and len(self.errors) < 6:
            self.errors.append(message)
        return ok


def is_num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def is_int(v) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def is_text(v) -> bool:
    return isinstance(v, str) and v.strip() != ""


def lonlat_ok(lon, lat, box=None) -> bool:
    if not (is_num(lon) and is_num(lat) and -180 <= lon <= 180 and -90 <= lat <= 90):
        return False
    return box is None or (box[0] <= lon <= box[2] and box[1] <= lat <= box[3])


def plain(c: Check, where: str, *texts) -> None:
    for t in texts:
        if isinstance(t, str):
            c.need(not EMOJI.search(t), f"{where}: emoji in text")


def sentences(text: str) -> int:
    # Sentence ends: . ! ? followed by a space and a capital, or the end. "E. Butler" style initials are skipped.
    body = re.sub(r"\b([A-Z])\. (?=[A-Z])", r"\1 ", text.strip())
    return len(re.findall(r"[.!?](?=\s+[A-Z\"'(]|\s*$)", body))


def unique_ids(c: Check, rows: list, what: str) -> None:
    ids = [r.get("id") for r in rows if isinstance(r, dict)]
    c.need(len(ids) == len(set(ids)), f"{what} ids are not unique")


def webp_width(path: pathlib.Path) -> int | None:
    """Width of a WebP file in pixels, or None if it is not WebP."""
    b = path.read_bytes()[:40]
    if len(b) < 30 or b[:4] != b"RIFF" or b[8:12] != b"WEBP":
        return None
    kind = b[12:16]
    if kind == b"VP8 ":
        return struct.unpack("<H", b[26:28])[0] & 0x3FFF
    if kind == b"VP8L":
        return (struct.unpack("<I", b[21:25])[0] & 0x3FFF) + 1
    if kind == b"VP8X":
        return int.from_bytes(b[24:27], "little") + 1
    return None


def point_in_ring(lon: float, lat: float, ring: list) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geometry(lon: float, lat: float, geom: dict) -> bool:
    polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
    for rings in polys:
        if point_in_ring(lon, lat, rings[0]) and not any(point_in_ring(lon, lat, h) for h in rings[1:]):
            return True
    return False


# ---- one function per file: returns (summary, Check) ----

def check_names(d) -> tuple[str, Check]:
    c = Check()
    if not c.need(isinstance(d, list) and len(d) >= 10, "expected a list of at least 10 names"):
        return "", c
    for r in d:
        w = f"name {r.get('id')!r}"
        c.need(all(is_text(r.get(k)) for k in ("id", "name", "type")), f"{w}: id, name and type must be text")
        c.need(lonlat_ok(r.get("lon"), r.get("lat")), f"{w}: bad lon/lat")
        c.need(is_num(r.get("diameterKm")) and r["diameterKm"] >= 0, f"{w}: diameterKm")
        c.need(is_int(r.get("minZoom")) and 0 <= r["minZoom"] <= 17, f"{w}: minZoom")
    unique_ids(c, d, "name")
    c.need(any(r.get("name") == "Jezero" for r in d), "Jezero is missing")
    inside = sum(1 for r in d if lonlat_ok(r.get("lon"), r.get("lat"), REGION))
    return f"{len(d)} names, {inside} inside the region", c


def check_traverse(d, box) -> tuple[str, Check]:
    c = Check()
    if not c.need(isinstance(d, dict), "expected an object"):
        return "", c
    c.need(is_text(d.get("rover")) and is_text(d.get("name")), "rover and name must be text")
    path, wps = d.get("path"), d.get("waypoints")
    if not c.need(isinstance(path, list) and len(path) >= 100, "path needs at least 100 points"):
        return "", c
    if not c.need(isinstance(wps, list) and len(wps) >= 10, "waypoints needs at least 10 entries"):
        return "", c
    for i, p in enumerate(path):
        ok = isinstance(p, list) and len(p) == 3 and lonlat_ok(p[0], p[1], box) and is_num(p[2])
        if not c.need(ok, f"path[{i}] is not [lon, lat, elev] inside Jezero"):
            break
    last_sol, last_km = -1, -1.0
    for i, w in enumerate(wps):
        ok = (is_int(w.get("sol")) and lonlat_ok(w.get("lon"), w.get("lat"), box) and is_num(w.get("elev"))
              and is_num(w.get("distKm")))
        if not c.need(ok, f"waypoints[{i}]: needs sol, lon, lat, elev, distKm"):
            break
        c.need(w["sol"] >= last_sol, f"waypoints[{i}]: sols go backwards")
        c.need(w["distKm"] >= last_km, f"waypoints[{i}]: distKm goes backwards")
        last_sol, last_km = w["sol"], w["distKm"]
    return f"{len(path)} path points, {len(wps)} waypoints, to sol {last_sol}, {last_km:g} km", c


def check_places(d) -> tuple[str, Check]:
    c = Check()
    if not c.need(isinstance(d, list) and d, "expected a list of places"):
        return "", c
    n_photos, photo_bytes = 0, 0
    for r in d:
        w = f"place {r.get('id')!r}"
        c.need(all(is_text(r.get(k)) for k in ("id", "name", "summary")), f"{w}: id, name, summary must be text")
        c.need(r.get("kind") in ("m20", "sample", "site"), f"{w}: kind")
        c.need(lonlat_ok(r.get("lon"), r.get("lat")), f"{w}: bad lon/lat")
        c.need(is_num(r.get("elev")), f"{w}: elev")
        c.need("sol" not in r or is_int(r["sol"]), f"{w}: sol")
        c.need("detail" not in r or is_text(r["detail"]), f"{w}: detail")
        plain(c, w, r.get("name"), r.get("summary"), r.get("detail"))
        if is_text(r.get("summary")):
            c.need(sentences(r["summary"]) == 2, f"{w}: summary must be two sentences")
        photos = r.get("photos")
        if not c.need(isinstance(photos, list), f"{w}: photos must be a list"):
            continue
        if r.get("kind") == "m20":
            c.need(lonlat_ok(r.get("lon"), r.get("lat"), CRATER), f"{w}: outside Jezero")
            c.need(1 <= len(photos) <= 3, f"{w}: needs 1 to 3 photos, has {len(photos)}")
        for p in photos:
            ok = (all(is_text(p.get(k)) for k in ("src", "caption", "camera", "credit")) and is_int(p.get("sol")))
            if not c.need(ok, f"{w}: photo needs src, caption, camera, sol, credit"):
                continue
            plain(c, w, p["caption"])
            c.need(p["credit"].startswith("NASA/JPL-Caltech"), f"{w}: photo credit")
            c.need(re.fullmatch(rf"/data/photos/{re.escape(r['id'])}-\d+\.webp", p["src"]) is not None,
                   f"{w}: photo src {p['src']}")
            f = PUBLIC / p["src"].lstrip("/")
            if not c.need(f.is_file(), f"{w}: {p['src']} is not on disk"):
                continue
            width = webp_width(f)
            c.need(width is not None, f"{w}: {p['src']} is not WebP")
            c.need(width in (None, 1200), f"{w}: {p['src']} is {width} px wide, not 1200")
            n_photos += 1
            photo_bytes += f.stat().st_size
    unique_ids(c, d, "place")
    kinds = {k: sum(1 for r in d if r.get("kind") == k) for k in ("m20", "sample", "site")}
    c.need(15 <= kinds["m20"] <= 30, f"expected 15 to 30 Mars 2020 places, found {kinds['m20']}")
    listed = {p["src"].rsplit("/", 1)[-1] for r in d for p in r.get("photos", []) if isinstance(p, dict) and "src" in p}
    on_disk = {f.name for f in (DATA / "photos").glob("*.webp")} if (DATA / "photos").is_dir() else set()
    c.need(not (on_disk - listed), f"photos on disk that no place uses: {sorted(on_disk - listed)[:3]}")
    return (f"{kinds['m20']} Mars 2020 places, {kinds['sample']} samples, {n_photos} photos "
            f"({photo_bytes / 1e6:.2f} MB)"), c


def check_samples(d) -> tuple[str, Check]:
    c = Check()
    if not c.need(isinstance(d, list) and len(d) >= 20, "expected a list of at least 20 samples"):
        return "", c
    for r in d:
        w = f"sample {r.get('id')!r}"
        c.need(all(is_text(r.get(k)) for k in ("id", "name", "rock", "campaign", "note")),
               f"{w}: id, name, rock, campaign, note must be text")
        c.need(is_int(r.get("sol")) and r["sol"] > 0, f"{w}: sol")
        c.need(lonlat_ok(r.get("lon"), r.get("lat"), CRATER), f"{w}: not inside Jezero")
        plain(c, w, r.get("note"))
    unique_ids(c, d, "sample")
    sols = [r["sol"] for r in d if is_int(r.get("sol"))]
    c.need(sols == sorted(sols), "samples are not in sol order")
    return f"{len(d)} samples, sols {min(sols)} to {max(sols)}", c


def check_weather(d) -> tuple[str, Check]:
    c = Check()
    if not c.need(isinstance(d, dict), "expected an object"):
        return "", c
    c.need(isinstance(d.get("retrieved"), str) and DATE.match(d["retrieved"]) is not None, "retrieved must be a date")
    parts = []
    for station in ("rems", "meda"):
        sols = d.get(station)
        if not c.need(isinstance(sols, list), f"{station} must be a list"):
            continue
        c.need(len(sols) <= 30, f"{station}: more than 30 sols")
        last = -1
        for s in sols:
            w = f"{station} sol {s.get('sol')}"
            c.need(is_int(s.get("sol")) and s["sol"] > last, f"{w}: sols must rise")
            last = s.get("sol", last) if is_int(s.get("sol")) else last
            c.need(isinstance(s.get("earthDate"), str) and DATE.match(s["earthDate"]) is not None, f"{w}: earthDate")
            for k, lo, hi in (("minC", -150, 40), ("maxC", -150, 40), ("pressurePa", 400, 1300)):
                c.need(k in s and (s[k] is None or (is_num(s[k]) and lo <= s[k] <= hi)), f"{w}: {k}")
            if s.get("minC") is not None and s.get("maxC") is not None:
                c.need(s["minC"] <= s["maxC"], f"{w}: minC above maxC")
            c.need("uv" not in s or is_text(s["uv"]), f"{w}: uv")
            for k in ("sunrise", "sunset"):
                c.need(k not in s or (isinstance(s[k], str) and CLOCK.match(s[k]) is not None), f"{w}: {k}")
        st = (d.get("stats") or {}).get(station)
        if c.need(isinstance(st, dict), f"stats.{station} is missing"):
            for k in ("minC", "maxC", "pressureMinPa", "pressureMaxPa"):
                c.need(k in st and (st[k] is None or is_num(st[k])), f"stats.{station}.{k}")
        parts.append(f"{station} {len(sols)} sols" + (f" to sol {sols[-1]['sol']} ({sols[-1]['earthDate']})" if sols else ""))
    c.need(isinstance(d.get("rems"), list) and len(d["rems"]) >= 1, "rems is empty")
    return ", ".join(parts), c


def check_points(d, what: str, minimum: int, extra: tuple[str, ...] = ()) -> tuple[str, Check]:
    c = Check()
    if not c.need(isinstance(d, list) and len(d) >= minimum, f"expected a list of at least {minimum} {what}"):
        return "", c
    for r in d:
        w = f"{what} {r.get('id')!r}"
        c.need(all(is_text(r.get(k)) for k in ("id", "name", "note") + extra), f"{w}: id, name, note{''.join(', ' + e for e in extra)} must be text")
        c.need(lonlat_ok(r.get("lon"), r.get("lat")), f"{w}: bad lon/lat")
        plain(c, w, r.get("note"))
    unique_ids(c, d, what)
    inside = sum(1 for r in d if lonlat_ok(r.get("lon"), r.get("lat"), REGION))
    return f"{len(d)} {what}, {inside} inside the region", c


def check_sites(d) -> tuple[str, Check]:
    summary, c = check_points(d, "sites", 8, ("mission", "date"))
    if isinstance(d, list):
        for r in d:
            c.need(isinstance(r.get("date"), str) and DATE.match(r["date"]) is not None, f"site {r.get('id')!r}: date")
        p = next((r for r in d if r.get("id") == "perseverance"), None)
        c.need(p is not None and lonlat_ok(p.get("lon"), p.get("lat"), CRATER), "Perseverance must be in Jezero")
    return summary, c


def check_geology(d) -> tuple[str, Check]:
    c = Check()
    if not c.need(isinstance(d, dict) and isinstance(d.get("units"), list), "expected { units, features }"):
        return "", c
    codes = set()
    for u in d["units"]:
        w = f"unit {u.get('code')!r}"
        c.need(all(is_text(u.get(k)) for k in ("code", "name", "colour", "kind", "what", "period", "age")),
               f"{w}: code, name, colour, kind, what, period, age must be text")
        c.need(isinstance(u.get("colour"), str) and re.fullmatch(r"#[0-9a-f]{6}", u["colour"]) is not None, f"{w}: colour")
        plain(c, w, u.get("what"), u.get("age"))
        codes.add(u.get("code"))
    fc = d.get("features")
    ok = isinstance(fc, dict) and fc.get("type") == "FeatureCollection" and isinstance(fc.get("features"), list)
    if not c.need(ok and len(fc["features"]) > 0, "features must be a GeoJSON FeatureCollection"):
        return "", c
    points = 0
    for i, f in enumerate(fc["features"]):
        g = f.get("geometry") or {}
        unit = (f.get("properties") or {}).get("unit")
        c.need(unit in codes, f"feature {i}: unit {unit!r} is not in units")
        if not c.need(g.get("type") in ("Polygon", "MultiPolygon"), f"feature {i}: geometry type"):
            continue
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for rings in polys:
            for ring in rings:
                points += len(ring)
                c.need(len(ring) >= 4 and ring[0] == ring[-1], f"feature {i}: ring is not closed")
                c.need(all(REGION[0] - 1e-3 <= p[0] <= REGION[2] + 1e-3 and REGION[1] - 1e-3 <= p[1] <= REGION[3] + 1e-3
                           for p in ring), f"feature {i}: outside the region")
    used = {(f.get("properties") or {}).get("unit") for f in fc["features"]}
    c.need(codes == used, f"units without polygons: {sorted(codes - used)}")
    for label, lon, lat, want in GEOLOGY_CHECKS:
        got = next((f["properties"]["unit"] for f in fc["features"]
                    if f.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon")
                    and point_in_geometry(lon, lat, f["geometry"])), None)
        c.need(got == want, f"{label} ({lat} N, {lon} E) reads {got}, expected {want}")
    return (f"{len(d['units'])} units, {len(fc['features'])} polygons, {points} points; "
            "Jezero HNt, Nili Fossae mNh, Syrtis eHv"), c


def check_source_entry(c: Check, e, where: str) -> None:
    if not c.need(isinstance(e, dict), f"{where}: not an object"):
        return
    for k in SOURCE_FIELDS:
        c.need(is_text(e.get(k)), f"{where}: {k} is missing")
    c.need(isinstance(e.get("retrieved"), str) and DATE.match(e["retrieved"]) is not None, f"{where}: retrieved date")
    c.need(isinstance(e.get("url"), str) and re.match(r"https?://", e["url"]) is not None, f"{where}: url")


def check_sources_d() -> tuple[str, Check]:
    c = Check()
    found = {}
    for f in sorted(SOURCES_D.glob("*.json")):
        try:
            e = json.loads(f.read_text(encoding="utf-8"))
        except ValueError as err:
            c.need(False, f"{f.name}: {err}")
            continue
        check_source_entry(c, e, f.name)
        c.need(e.get("id") == f.stem, f"{f.name}: id does not match the file name")
        found[f.stem] = e
    missing = [s for s in EXPECTED_SOURCES if s not in found]
    c.need(not missing, f"no source entry for: {', '.join(missing)}")
    return f"{len(found)} entries, all {len(EXPECTED_SOURCES)} dataset sources present", c


def check_sources_json(d) -> tuple[str, Check]:
    c = Check()
    rows = d if isinstance(d, list) else (d.get("sources") if isinstance(d, dict) else None)
    if not c.need(isinstance(rows, list), "expected a list of sources"):
        return "", c
    for e in rows:
        check_source_entry(c, e, f"source {e.get('id') if isinstance(e, dict) else e!r}")
    ids = {e.get("id") for e in rows if isinstance(e, dict)}
    missing = [s for s in EXPECTED_SOURCES if s not in ids]
    c.need(not missing, f"missing: {', '.join(missing)} (run tools/sources.py --merge)")
    return f"{len(rows)} sources", c


def check_models() -> tuple[str, Check]:
    c = Check()
    total, sizes = 0, []
    for name in MODEL_NAMES:
        f = MODELS / f"{name}.glb"
        if not c.need(f.is_file(), f"{name}.glb is missing"):
            continue
        head = f.read_bytes()[:12]
        c.need(head[:4] == b"glTF" and struct.unpack("<I", head[8:12])[0] == f.stat().st_size, f"{name}.glb is not a whole GLB")
        total += f.stat().st_size
        sizes.append(f"{name} {f.stat().st_size / 1e6:.2f}")
    c.need(total <= MODELS_BUDGET, f"models are {total / 1e6:.2f} MB, over {MODELS_BUDGET / 1e6:g} MB")
    return f"{total / 1e6:.2f} MB ({', '.join(sizes)})", c


def main() -> int:
    files = [
        ("data/names.json", check_names, True),
        ("data/traverses/m20.json", lambda d: check_traverse(d, CRATER), True),
        ("data/traverses/ingenuity.json", lambda d: check_traverse(d, CRATER), False),
        ("data/places.json", check_places, True),
        ("data/samples.json", check_samples, True),
        ("data/weather.json", check_weather, True),
        ("data/caves.json", lambda d: check_points(d, "caves", 0), True),
        ("data/sites.json", check_sites, True),
        ("data/geology.json", check_geology, True),
        ("data/sources.json", check_sources_json, False),
    ]
    failed = 0

    def report(name: str, summary: str, c: Check) -> None:
        nonlocal failed
        if c.errors:
            failed += 1
            print(f"FAIL  {name}: " + "; ".join(c.errors))
        else:
            print(f"ok    {name}: {summary}")

    for rel, fn, required in files:
        path = PUBLIC / rel
        if not path.is_file():
            if required:
                failed += 1
                print(f"FAIL  {rel}: file is missing")
            else:
                print(f"skip  {rel}: not built")
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except ValueError as e:
            failed += 1
            print(f"FAIL  {rel}: not valid JSON ({e})")
            continue
        try:
            summary, c = fn(data)
        except Exception as e:  # a shape so wrong the check itself tripped
            c = Check()
            c.need(False, f"unexpected shape ({type(e).__name__}: {e})")
            summary = ""
        report(rel, summary, c)

    report("tools/sources.d", *check_sources_d())
    report("models/*.glb", *check_models())

    total = sum(f.stat().st_size for f in DATA.rglob("*") if f.is_file()) if DATA.is_dir() else 0
    c = Check()
    c.need(total <= DATA_BUDGET, f"public/data is {total / 1e6:.2f} MB, over {DATA_BUDGET / 1e6:g} MB")
    report("data (total size)", f"{total / 1e6:.2f} MB", c)

    print("FAILED" if failed else "all checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
