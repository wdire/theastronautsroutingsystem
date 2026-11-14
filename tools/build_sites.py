"""Curated list of Mars landing sites -> public/data/sites.json

Every lander and rover that landed and worked on the surface. Most lie far
outside the region: that is intended, they are shown on the globe.

Coordinates and dates: NASA GISS Mars24 "Mars Lander Missions" list. Two
latitudes there (Viking 2, Mars Pathfinder) are planetographic; this file uses
the planetocentric values so the pins sit right on a MOLA-based map.
Perseverance's point is its first localisation in JPL's MMGIS waypoints.

Output: { id, name, mission, agency, date, lon, lat, place, note }[]
(lon is east longitude in -180..180, lat is planetocentric.)
"""

from __future__ import annotations

import sys

from build_common import DATA, add_source, m20_waypoints, write_json

SOURCE_URL = "https://www.giss.nasa.gov/tools/mars24/help/landers.html"

# id, name, mission, agency, landing date (UTC), east longitude 0..360, latitude, place, one-line note
SITES = [
    ("viking-1", "Viking 1", "Viking Lander 1", "NASA", "1976-07-20", 312.05, 22.27, "Chryse Planitia",
     "The first fully successful landing on Mars. The lander worked until November 1982."),
    ("viking-2", "Viking 2", "Viking Lander 2", "NASA", "1976-09-03", 134.29, 47.64, "Utopia Planitia",
     "The second Viking lander. It worked on the northern plains until April 1980."),
    ("pathfinder", "Mars Pathfinder", "Mars Pathfinder and the Sojourner rover", "NASA", "1997-07-04",
     326.78, 19.13, "Ares Vallis",
     "A lander with Sojourner, the first rover on Mars, which drove about 100 m."),
    ("spirit", "Spirit", "Mars Exploration Rover A", "NASA", "2004-01-04", 175.48, -14.57, "Gusev crater",
     "A rover planned for 90 sols that worked for six years and drove about 7.7 km."),
    ("opportunity", "Opportunity", "Mars Exploration Rover B", "NASA", "2004-01-25", 354.47, -1.95,
     "Meridiani Planum",
     "A rover planned for 90 sols that worked for 14 years and drove about 45 km."),
    ("phoenix", "Phoenix", "Mars Phoenix", "NASA", "2008-05-25", 234.25, 68.22, "Vastitas Borealis",
     "A lander on the arctic plains. It worked for about five months, until the polar winter."),
    ("curiosity", "Curiosity", "Mars Science Laboratory", "NASA", "2012-08-06", 137.44, -4.59, "Gale crater",
     "A rover that landed at Bradbury Landing and explores the layered rock of Mount Sharp."),
    ("insight", "InSight", "InSight", "NASA", "2018-11-26", 135.62, 4.50, "Elysium Planitia",
     "A lander that listened for marsquakes until December 2022."),
    ("perseverance", "Perseverance", "Mars 2020 Perseverance and the Ingenuity helicopter", "NASA",
     "2021-02-18", 77.45, 18.44, "Jezero crater",
     "A rover that landed at Octavia E. Butler Landing and collects rock cores. It carried the Ingenuity helicopter."),
    ("zhurong", "Zhurong", "Tianwen-1 lander and the Zhurong rover", "CNSA", "2021-05-14", 109.93, 25.07,
     "Utopia Planitia",
     "China's first Mars rover. It drove about 1.9 km before going into hibernation in May 2022."),
]


def main() -> int:
    first = m20_waypoints()[0]
    out = []
    for sid, name, mission, agency, date, lon, lat, place, note in SITES:
        if sid == "perseverance":
            lon, lat = first["lon"], first["lat"]
        if lon > 180:
            lon -= 360
        out.append(
            {
                "id": sid,
                "name": name,
                "mission": mission,
                "agency": agency,
                "date": date,
                "lon": round(lon, 4),
                "lat": round(lat, 4),
                "place": place,
                "note": note,
            }
        )
    write_json(DATA / "sites.json", out, indent=1)
    print(f"{len(out)} landing sites")
    add_source(
        id="landing-sites",
        name="Mars landing sites (curated list)",
        mission="Viking, Mars Pathfinder, Mars Exploration Rovers, Phoenix, Mars Science Laboratory, InSight, "
        "Mars 2020, Tianwen-1",
        product="NASA GISS Mars24 Sunclock: Mars Lander Missions (updated 2023-12-09)",
        url=SOURCE_URL,
        licence="Public domain (NASA). Curated by hand for this app.",
        notes="The ten landers and rovers that landed and worked on Mars, with landing date (UTC), place and a "
        "one-line note taken from the NASA GISS list. Missions that failed on landing are left out, as is "
        "Mars 3, which fell silent about 20 seconds after landing. Coordinates are from the same list, except: "
        "Viking 2 (47.64 N, 134.29 E) and Mars Pathfinder (19.13 N, 326.78 E) use planetocentric values, "
        "because the list gives planetographic latitudes for them; Perseverance uses its first localisation "
        "in JPL's MMGIS waypoints. Most sites lie outside the app's region on purpose.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
