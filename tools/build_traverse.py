"""Perseverance's drive and Ingenuity's flights -> public/data/traverses/

Source: JPL MMGIS layers behind NASA's "Where is Perseverance?" map.

m20.json:        { rover, name, path: [lon, lat, elev][], waypoints: { sol, lon, lat, elev, distKm }[] }
ingenuity.json:  the same shape; a waypoint is where a flight landed (with its flight number).
"""

from __future__ import annotations

import math
import sys

from build_common import (DATA, M20_TRAVERSE_URL, M20_WAYPOINTS_URL, MARS_RADIUS_M, add_source, fetch_json,
                          m20_waypoints, write_json)

HELI_PATH_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/m20_heli_flight_path.json"
HELI_WAYPOINTS_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/m20_heli_waypoints.json"
MAP_PAGE = "https://science.nasa.gov/mission/mars-2020-perseverance/location-map/"
MIN_STEP_M = 2.0  # drop path points closer than this to the last kept one


def dist_m(a, b) -> float:
    lat = math.radians((a[1] + b[1]) / 2)
    dx = math.radians(b[0] - a[0]) * math.cos(lat)
    dy = math.radians(b[1] - a[1])
    return MARS_RADIUS_M * math.hypot(dx, dy)


def thin(points: list[list[float]], step: float) -> list[list[float]]:
    out = [points[0]]
    for p in points[1:]:
        if dist_m(out[-1], p) >= step:
            out.append(p)
    if out[-1] != points[-1]:
        out.append(points[-1])
    return out


def build_m20() -> dict:
    tr = fetch_json(M20_TRAVERSE_URL, "M20_traverse.json")
    feats = sorted(tr["features"], key=lambda f: (f["properties"]["sol"], f["properties"].get("SCLK_START", 0)))
    # A drive that ran over several sols is listed once per sol, each time from the same start and a
    # little longer (sols 350 to 352, for one). Keep the longest of each run, or the path doubles back.
    kept: list[dict] = []
    for f in feats:
        if kept and kept[-1]["properties"].get("fromRMC") == f["properties"].get("fromRMC"):
            if f["properties"].get("length", 0) >= kept[-1]["properties"].get("length", 0):
                kept[-1] = f
            continue
        kept.append(f)
    pts: list[list[float]] = []
    for f in kept:
        g = f["geometry"]
        lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        for line in lines:
            for c in line:
                pts.append([round(c[0], 6), round(c[1], 6), round(c[2], 1) if len(c) > 2 else 0.0])
    path = thin(pts, MIN_STEP_M)
    wps = [{k: w[k] for k in ("sol", "lon", "lat", "elev", "distKm")} for w in m20_waypoints()]
    return {"rover": "m20", "name": "Perseverance", "path": path, "waypoints": wps}


def build_ingenuity() -> dict:
    fp = fetch_json(HELI_PATH_URL, "m20_heli_flight_path.json")
    hw = fetch_json(HELI_WAYPOINTS_URL, "m20_heli_waypoints.json")
    stops = sorted((f["properties"] for f in hw["features"]), key=lambda p: p["Flight"])
    elev_after = {int(p["Flight"]): float(p["Elev_Geoid"]) for p in stops}
    path: list[list[float]] = []
    for f in sorted(fp["features"], key=lambda f: f["properties"]["Flight"]):
        n = int(f["properties"]["Flight"])
        g = f["geometry"]
        lines = g["coordinates"] if g["type"] == "MultiLineString" else [g["coordinates"]]
        # The flight path has no heights: use the ground height where the flight ended.
        elev = round(elev_after.get(n, elev_after.get(n - 1, 0.0)), 1)
        leg = [[round(c[0], 6), round(c[1], 6), elev] for line in lines for c in line]
        if leg:
            path.extend(thin(leg, MIN_STEP_M))
    wps = [
        {
            "sol": int(p["Sol"]),
            "lon": round(float(p["Lon"]), 6),
            "lat": round(float(p["Lat"]), 6),
            "elev": round(float(p["Elev_Geoid"]), 1),
            "distKm": round(float(p["Total_m"]) / 1000.0, 3),
            "flight": int(p["Flight"]),
        }
        for p in stops
    ]
    return {"rover": "ingenuity", "name": "Ingenuity", "path": path, "waypoints": wps}


def main() -> int:
    m20 = build_m20()
    write_json(DATA / "traverses" / "m20.json", m20)
    last = m20["waypoints"][-1]
    print(f"m20: {len(m20['path'])} path points, {len(m20['waypoints'])} waypoints, "
          f"sol {m20['waypoints'][0]['sol']} to {last['sol']}, {last['distKm']} km")
    add_source(
        id="m20-traverse",
        name="Perseverance traverse and localised waypoints",
        mission="Mars 2020 Perseverance",
        product="MMGIS layers M20_traverse.json and M20_waypoints.json",
        url=MAP_PAGE,
        licence="Public domain (NASA/JPL-Caltech).",
        notes=f"From {M20_TRAVERSE_URL} and {M20_WAYPOINTS_URL}. The drive is thinned to one point every "
        f"{MIN_STEP_M:g} m, and segments the source repeats for drives that ran over several sols are kept once, "
        "so the drawn line is a little shorter than the rover's odometry in the waypoints. Heights are metres above the Mars areoid. Covers sols "
        f"{m20['waypoints'][0]['sol']} to {last['sol']} ({last['distKm']} km).",
    )
    try:
        heli = build_ingenuity()
    except Exception as e:  # optional layer
        print(f"Ingenuity layer not built: {e}", file=sys.stderr)
        return 0
    write_json(DATA / "traverses" / "ingenuity.json", heli)
    hl = heli["waypoints"][-1]
    print(f"ingenuity: {len(heli['path'])} path points, {len(heli['waypoints'])} waypoints, "
          f"flights 0 to {hl['flight']}, {hl['distKm']} km")
    add_source(
        id="ingenuity-flights",
        name="Ingenuity flight paths and landing points",
        mission="Mars 2020 Ingenuity Mars Helicopter",
        product="MMGIS layers m20_heli_flight_path.json and m20_heli_waypoints.json",
        url=MAP_PAGE,
        licence="Public domain (NASA/JPL-Caltech).",
        notes=f"From {HELI_PATH_URL} and {HELI_WAYPOINTS_URL}. {hl['flight']} flights, {hl['distKm']} km in all. "
        "The flight paths carry no heights: each leg is given the ground height of its landing point.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
