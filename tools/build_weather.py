"""Weather snapshots from Curiosity REMS and Perseverance MEDA -> public/data/weather.json

Source: mars.nasa.gov RSS weather API (the feeds behind NASA's Mars weather pages).

Output: { retrieved, rems: Sol[], meda: Sol[], stats: { rems, meda } }
Sol = { sol, earthDate, minC, maxC, pressurePa, uv?, sunrise?, sunset? }
The last 30 sols of each station, oldest first. A value the station did not
report is null. stats holds the lowest and highest values over the whole feed.
The MEDA feed stopped updating in 2024: its sols are kept with their dates.
"""

from __future__ import annotations

import sys

from build_common import DATA, add_source, fetch_json, today, url_with, write_json

API = "https://mars.nasa.gov/rss/api/"
REMS_URL = url_with(API, {"feed": "weather", "category": "msl", "feedtype": "json"})
MEDA_URL = url_with(API, {"feed": "weather", "category": "mars2020", "feedtype": "json"})
KEEP = 30

# Outside these the feed value is a known glitch, not weather.
TEMP_OK = (-140.0, 40.0)
PRESSURE_OK = (500.0, 1200.0)


def num(v, ok: tuple[float, float]) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return round(x, 1) if ok[0] <= x <= ok[1] else None


def to_sol(r: dict) -> dict | None:
    try:
        sol = int(r["sol"])
    except (KeyError, TypeError, ValueError):
        return None
    out = {
        "sol": sol,
        "earthDate": str(r.get("terrestrial_date", ""))[:10],
        "minC": num(r.get("min_temp"), TEMP_OK),
        "maxC": num(r.get("max_temp"), TEMP_OK),
        "pressurePa": num(r.get("pressure"), PRESSURE_OK),
    }
    uv = r.get("local_uv_irradiance_index")
    if uv and uv != "--":
        out["uv"] = uv
    for k in ("sunrise", "sunset"):
        v = r.get(k)
        if v and v != "--":
            out[k] = v[:5]
    return out


def stats(sols: list[dict]) -> dict:
    def span(key):
        vals = [s[key] for s in sols if s[key] is not None]
        return (min(vals), max(vals)) if vals else (None, None)

    tmin = span("minC")
    tmax = span("maxC")
    p = span("pressurePa")
    return {
        "sols": len(sols),
        "firstSol": sols[0]["sol"] if sols else None,
        "lastSol": sols[-1]["sol"] if sols else None,
        "firstDate": sols[0]["earthDate"] if sols else None,
        "lastDate": sols[-1]["earthDate"] if sols else None,
        "minC": tmin[0],
        "maxC": tmax[1],
        "pressureMinPa": p[0],
        "pressureMaxPa": p[1],
    }


def station(url: str, cache: str, key: str) -> list[dict]:
    try:
        d = fetch_json(url, cache, refresh=True)
    except Exception as e:
        print(f"{cache}: feed did not answer ({e}); trying the cached copy", file=sys.stderr)
        d = fetch_json(url, cache)
    sols = [s for s in (to_sol(r) for r in d.get(key, [])) if s]
    sols.sort(key=lambda s: s["sol"])
    return sols


def main() -> int:
    rems = station(REMS_URL, "weather_msl.json", "soles")
    meda = station(MEDA_URL, "weather_mars2020.json", "sols")
    out = {
        "retrieved": today(),
        "rems": rems[-KEEP:],
        "meda": meda[-KEEP:],
        "stats": {"rems": stats(rems), "meda": stats(meda)},
    }
    write_json(DATA / "weather.json", out)
    for k in ("rems", "meda"):
        st = out["stats"][k]
        print(f"{k}: kept {len(out[k])} of {st['sols']} sols, sol {st['firstSol']} to {st['lastSol']} "
              f"({st['firstDate']} to {st['lastDate']}), {st['minC']} to {st['maxC']} C, "
              f"{st['pressureMinPa']} to {st['pressureMaxPa']} Pa")
    add_source(
        id="weather-rems",
        name="Curiosity REMS daily weather at Gale crater",
        mission="Mars Science Laboratory Curiosity (REMS, Centro de Astrobiologia)",
        product="mars.nasa.gov RSS weather feed, category msl",
        url=REMS_URL,
        licence="Public domain (NASA/JPL-Caltech/CAB). Outreach data: for science use the PDS archive.",
        notes=f"The last {KEEP} sols and the lowest and highest values of the whole feed "
        f"(sols {out['stats']['rems']['firstSol']} to {out['stats']['rems']['lastSol']}, last dated "
        f"{out['stats']['rems']['lastDate']}). Air temperature in C, pressure in Pa. Values outside "
        f"{TEMP_OK[0]:g} to {TEMP_OK[1]:g} C or {PRESSURE_OK[0]:g} to {PRESSURE_OK[1]:g} Pa are feed glitches and "
        "are dropped. Gale crater is not Jezero: shown as a measured reference beside the modelled values.",
    )
    add_source(
        id="weather-meda",
        name="Perseverance MEDA daily weather at Jezero crater",
        mission="Mars 2020 Perseverance (MEDA)",
        product="mars.nasa.gov RSS weather feed, category mars2020",
        url=MEDA_URL,
        licence="Public domain (NASA/JPL-Caltech/CAB).",
        notes=f"The feed holds {out['stats']['meda']['sols']} sols and has not been updated since "
        f"{out['stats']['meda']['lastDate']} (sol {out['stats']['meda']['lastSol']}). Kept as it is, with its dates.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
