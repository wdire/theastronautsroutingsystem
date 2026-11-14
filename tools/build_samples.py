"""Perseverance's samples -> public/data/samples.json

Source: NASA's published sample list, "Mars Rock Samples"
(science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/): number,
date and sol sealed, name, rock it came from, location, rock type, and whether
the tube is on the rover or at the Three Forks depot.

Position: the rover's localised stop (JPL MMGIS) on the sol the sample was
taken. NASA's table gives the sol a tube was sealed, which can be weeks after
coring and somewhere else (Mageik: cored sol 579, sealed sol 619). The coring
sol is read from the raw images feed: the last sol, up to the sealing sol,
with a full set of CacheCam frames (the camera that looks into the tube).

Output: { id, name, sol, lon, lat, rock, campaign, note,
          number, type, feature, location, solSealed, dateSealed, store, elev, alias? }[]
"""

from __future__ import annotations

import collections
import html
import re
import sys

from build_common import DATA, add_source, fetch, fetch_json, m20_position_on, m20_waypoints, slug, url_with, write_json

PAGE = "https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/"
RAW_API = "https://mars.nasa.gov/rss/api/"

# Witness tubes (blanks that record contamination) also use CacheCam. Sols from NASA's sample page.
WITNESS_SOLS = {160, 499, 586}

# NASA's "Sampling Location" -> science campaign.
CAMPAIGNS = (
    ("Polygon Valley", "Crater Floor"),
    ("Artuby Ridge", "Crater Floor"),
    ("South S", "Crater Floor"),
    ("Octavia E. Butler", "Crater Floor"),
    ("Delta Front", "Delta Front"),
    ("Upper Fan", "Upper Fan"),
    ("Margin Unit", "Margin Unit"),
    ("Neretva Vallis", "Neretva Vallis"),
    ("Crater Rim", "Crater Rim"),
)

# Samples NASA lists with the sealing sol "TBD": the sol named in the photo caption on NASA's page
# (Bell Island: drill hole photographed on sol 1497; Gallants: target photographed on sol 1551).
# The coring sol is then looked for in CacheCam frames up to a few sols later.
TBD_HINT_SOL = {29: 1497, 30: 1551}
# From the caption for sample 29 on NASA's page.
UNSEALED_NOTE = {29: "NASA left this tube unsealed on purpose, to stay flexible while exploring new targets."}


def clean(cell: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", cell))).strip()


def parse_table(page: str) -> list[dict]:
    i, j = page.find("<table"), page.rfind("</table>")
    if i < 0 or j < 0:
        raise RuntimeError("the sample table was not found on NASA's page")
    rows = []
    for tr in re.findall(r"<tr.*?</tr>", page[i:j], flags=re.S):
        cells = [clean(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S)]
        if len(cells) >= 11 and cells[0].isdigit():
            rows.append(
                {
                    "number": int(cells[0]),
                    "dateSealed": None if cells[1].upper() == "TBD" else cells[1],
                    "solSealed": int(cells[2]) if cells[2].isdigit() else None,
                    "name": cells[3],
                    "feature": cells[4],
                    "location": cells[5],
                    "current": cells[6],
                    "type": cells[8],
                    "rock": cells[10],
                }
            )
    if len(rows) < 25:
        raise RuntimeError(f"only {len(rows)} samples parsed: NASA's page layout may have changed")
    return rows


def cachecam_sols() -> dict[int, int]:
    """sol -> number of CacheCam frames, over the whole mission."""
    counts: collections.Counter = collections.Counter()
    page = 0
    while True:
        url = url_with(RAW_API, {
            "feed": "raw_images", "category": "mars2020", "feedtype": "json", "ver": "1.2",
            "num": 100, "page": page, "order": "sol asc", "search": "|CACHECAM",
            "condition_2": "1:sol:gte", "condition_3": "2100:sol:lte",
        })
        d = fetch_json(url, f"raw/cachecam_{page:03d}.json")
        for im in d.get("images", []):
            counts[int(im["sol"])] += 1
        page += 1
        if not d.get("images") or page * 100 >= int(d.get("total_results", 0)):
            break
    return dict(counts)


def coring_sol(prev_sol: int, last_sol: int, counts: dict[int, int]) -> int | None:
    """The last sol in (prev_sol, last_sol] with a full burst of CacheCam frames."""
    window = {s: n for s, n in counts.items() if prev_sol < s <= last_sol and s not in WITNESS_SOLS}
    if not window:
        return None
    full = 0.6 * max(window.values())
    return max(s for s, n in window.items() if n >= full)


def main() -> int:
    rows = parse_table(fetch(PAGE, "nasa_mars_rock_samples.html", refresh=True).decode("utf-8", "replace"))
    try:
        counts = cachecam_sols()
    except Exception as e:
        print(f"raw images feed did not answer ({e}): using sealing sols", file=sys.stderr)
        counts = {}
    wps = m20_waypoints()

    # CacheCam was also run in checkouts early in the mission. No sample was taken before the first
    # witness tube was sealed (sol 160), so the search starts there.
    out, prev = [], min(WITNESS_SOLS)
    for r in sorted(rows, key=lambda r: r["number"]):
        sealed = r["solSealed"]
        last = sealed if sealed is not None else TBD_HINT_SOL.get(r["number"], 0) + 3
        sol = coring_sol(prev, last, counts) if last else None
        approx = False
        if sol is None:
            sol = sealed if sealed is not None else TBD_HINT_SOL.get(r["number"])
            approx = sealed is None
        if sol is None:
            print(f"  sample {r['number']} {r['name']}: no sol published yet, left out", file=sys.stderr)
            continue
        prev = sol

        m = re.match(r'^(.*?)\s*\(aka\s+"?([^")]+)"?\)\s*$', r["name"])
        name, alias = (m.group(1), m.group(2)) if m else (r["name"], None)
        pos = m20_position_on(sol, wps)
        campaign = next((c for key, c in CAMPAIGNS if key in r["location"]), r["location"])
        at_depot = "depot" in r["current"].lower()
        rock = r["rock"]
        if r["type"].lower().startswith("atmos"):
            rock = "None: the tube holds Martian air"

        kind = {"rock core": "Rock core", "regolith": "Loose soil (regolith)", "atmospheric": "Sample of Martian air"}.get(
            r["type"].lower(), r["type"])
        when = f"on sol {sol}" if sealed is not None else f"around sol {sol}"
        note = f"{kind} from {r['feature']}, {r['location']}, taken {when}."
        if r["type"].lower().startswith("atmos"):
            note = (f"The first coring attempt, at the rock {r['feature']} in {r['location']} on sol {sol}. "
                    "The rock crumbled, so the sealed tube holds Martian air.")
        if sealed is not None:
            note += f" Sealed on sol {sealed} ({r['dateSealed']})."
        else:
            note += " " + UNSEALED_NOTE.get(r["number"], "NASA has not published a sealing date for this tube.")
        note += " Left at the Three Forks sample depot." if at_depot else " Carried on the rover."

        rec = {
            "id": slug(name),
            "name": name,
            "sol": sol,
            "lon": pos["lon"],
            "lat": pos["lat"],
            "rock": rock,
            "campaign": campaign,
            "note": note,
            "number": r["number"],
            "type": r["type"],
            "feature": r["feature"],
            "location": r["location"],
            "solSealed": sealed,
            "dateSealed": r["dateSealed"],
            "store": "depot" if at_depot else "rover",
            "elev": pos["elev"],
        }
        if alias:
            rec["alias"] = alias
        if approx:
            rec["solApprox"] = True
        out.append(rec)
        print(f"  {r['number']:2d} {name:16s} sol {sol:4d} (sealed {sealed}) {pos['lon']:.5f} {pos['lat']:.5f}  "
              f"{r['feature']} / {campaign} / {rock}")

    write_json(DATA / "samples.json", out, indent=1)
    print(f"{len(out)} samples ({sum(1 for s in out if s['store'] == 'depot')} at the depot)")
    add_source(
        id="m20-samples",
        name="Perseverance sample list",
        mission="Mars 2020 Perseverance",
        product="Mars Rock Samples table (sample number, name, rock, location, rock type, sol sealed)",
        url=PAGE,
        licence="Public domain (NASA/JPL-Caltech).",
        notes=f"{len(out)} samples as published by NASA. Each is placed at the rover's localised stop (JPL MMGIS "
        "waypoints) on the sol it was taken. NASA lists the sol a tube was sealed; the coring sol is read from "
        "the raw images feed (the last sol up to sealing with a full set of CacheCam frames), because a few tubes "
        "were sealed later and elsewhere. NASA gives no sealing sol yet for samples 29 and 30 (Bell Island, "
        "Gallants): their sols come from the photo captions on the same page (sols 1497 and 1551) and the CacheCam "
        "frames around them. The campaign is derived from NASA's sampling location.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
