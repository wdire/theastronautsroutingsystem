"""Shared helpers for the Areo dataset tools (build_*.py).

Cached downloads with retry and backoff, JSON output, and source entries
(tools/sources.d/<id>.json). TLS verification is never turned off.
"""

from __future__ import annotations

import datetime
import hashlib
import importlib.util
import json
import pathlib
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
CACHE = TOOLS / ".cache" / "data"
DATA = ROOT / "public" / "data"
MODELS = ROOT / "public" / "models"
SOURCES_D = TOOLS / "sources.d"

# A generic client name: no personal details.
UA = "areo-data-tools/1.0"

# The app's region: Jezero and Nili Fossae. East longitude, degrees.
REGION = {"w": 71.8, "s": 13.1, "e": 83.1, "n": 23.8}

MARS_RADIUS_M = 3_396_190.0


def today() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


def in_region(lon: float, lat: float, pad: float = 0.0) -> bool:
    return (
        REGION["w"] - pad <= lon <= REGION["e"] + pad
        and REGION["s"] - pad <= lat <= REGION["n"] + pad
    )


def slug(text: str) -> str:
    import unicodedata

    t = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")


def cache_path(url: str, name: str | None = None) -> pathlib.Path:
    if name is None:
        tail = re.sub(r"[^A-Za-z0-9._-]+", "_", url.split("?")[0].rstrip("/").split("/")[-1])[-60:]
        name = hashlib.sha1(url.encode()).hexdigest()[:12] + "_" + (tail or "index")
    return CACHE / name


def fetch(
    url: str,
    name: str | None = None,
    *,
    tries: int = 6,
    timeout: int = 120,
    refresh: bool = False,
    headers: dict[str, str] | None = None,
) -> bytes:
    """Download url (cached under tools/.cache/data). Retries with backoff and
    resumes a partial download with a Range request when the server allows it."""
    path = cache_path(url, name)
    if path.exists() and not refresh:
        return path.read_bytes()
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_name(path.name + ".part")
    last: Exception | None = None
    for attempt in range(tries):
        try:
            have = part.stat().st_size if part.exists() else 0
            h = {"User-Agent": UA, "Accept": "*/*"}
            if headers:
                h.update(headers)
            if have:
                h["Range"] = f"bytes={have}-"
            req = urllib.request.Request(url, headers=h)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                resumed = have and r.status == 206
                with open(part, "ab" if resumed else "wb") as f:
                    while True:
                        chunk = r.read(1 << 16)
                        if not chunk:
                            break
                        f.write(chunk)
                total = r.headers.get("Content-Length")
                got = part.stat().st_size - (have if resumed else 0)
                if total is not None and got < int(total):
                    raise IOError(f"short read: {got} of {total} bytes")
            part.replace(path)
            return path.read_bytes()
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 416 and part.exists():
                part.unlink()
            if e.code in (400, 401, 403, 404, 410):
                break
        except Exception as e:  # connection resets, timeouts, short reads
            last = e
        wait = min(60, 2 ** attempt)
        print(f"  retry {attempt + 1}/{tries} in {wait}s: {url} ({last})", file=sys.stderr)
        time.sleep(wait)
    raise RuntimeError(f"could not download {url}: {last}")


def fetch_json(url: str, name: str | None = None, **kw):
    return json.loads(fetch(url, name, **kw).decode("utf-8", "replace"))


def url_with(base: str, params: dict) -> str:
    return base + "?" + urllib.parse.urlencode(params)


def write_json(path: pathlib.Path, obj, *, indent: int | None = None) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(obj, ensure_ascii=False, indent=indent, separators=None if indent else (",", ":"))
    path.write_text(text + "\n", encoding="utf-8")
    size = path.stat().st_size
    print(f"wrote {path.relative_to(ROOT)}  {size / 1024:.1f} kB")
    return size


def add_source(id: str, name: str, mission: str, product: str, url: str, licence: str, notes: str) -> None:
    """Record a dataset in tools/sources.d/<id>.json. Uses the tiles tool's
    tools/sources.py add_source() when it is there, else writes the same shape."""
    sp = TOOLS / "sources.py"
    if sp.exists():
        try:
            spec = importlib.util.spec_from_file_location("areo_sources", sp)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
            mod.add_source(id=id, name=name, mission=mission, product=product, url=url, licence=licence, notes=notes)
            print(f"source {id} (sources.py)")
            return
        except Exception as e:  # fall back to writing the file ourselves
            print(f"  sources.py add_source failed ({e}); writing {id}.json directly", file=sys.stderr)
    SOURCES_D.mkdir(parents=True, exist_ok=True)
    entry = {
        "id": id,
        "name": name,
        "mission": mission,
        "product": product,
        "url": url,
        "licence": licence,
        "notes": notes,
        "retrieved": today(),
    }
    (SOURCES_D / f"{id}.json").write_text(json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"source {id}")


# ---- Perseverance localisations (JPL MMGIS), shared by traverse, places and samples ----

M20_WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json"
M20_TRAVERSE_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json"


def m20_waypoints() -> list[dict]:
    """End-of-drive localisations, in the order driven: { sol, lon, lat, elev, distKm, site, drive }.
    Mid-drive and interpolated points are left out: they carry no distance."""
    d = fetch_json(M20_WAYPOINTS_URL, "M20_waypoints.json")
    out = []
    for f in d["features"]:
        p = f["properties"]
        if p.get("final") != "y":
            continue
        out.append(
            {
                "sol": int(p["sol"]),
                "lon": round(float(p["lon"]), 6),
                "lat": round(float(p["lat"]), 6),
                "elev": round(float(p["elev_geoid"]), 1),
                "distKm": round(float(p["dist_total_m"]) / 1000.0, 3),
                "site": int(p["site"]),
                "drive": int(p["drive"]),
            }
        )
    out.sort(key=lambda w: w["sol"])  # stable: keeps the file's order within a sol
    return out


def m20_position_on(sol: int, waypoints: list[dict] | None = None) -> dict:
    """Where the rover was parked on a sol: the last localisation at or before it."""
    wps = waypoints or m20_waypoints()
    best = wps[0]
    for w in wps:
        if w["sol"] <= sol:
            best = w
        else:
            break
    return best
