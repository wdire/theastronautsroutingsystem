"""Mars 2020 named places with rover photos -> public/data/places.json, public/data/photos/

Places: spots the Perseverance team named, each put at the rover's localised
position (JPL MMGIS) on the sol it worked there. The two helicopter airfields
use Ingenuity's own landing points. Facts come from the NASA pages listed with
each place. The sample cores from samples.json are added as places of kind
'sample' (run build_samples.py first).

Photos: 1 to 3 Navcam or Mastcam-Z frames per place from NASA's public raw
images feed, taken while the rover was parked there, resized to 1200 px wide
WebP. Frames are picked by rule (full colour frames, daylight, camera near
level, spread in direction); a place can name frames by id instead (PICK).

Output: { id, name, kind, lon, lat, elev, sol?, summary, detail?, photos: { src, caption, camera, sol,
          credit, id, link }[], sources?, aliases? }[]
"""

from __future__ import annotations

import io
import json
import math
import re
import sys

from PIL import Image, ImageStat

from build_common import (DATA, MARS_RADIUS_M, add_source, fetch, fetch_json, m20_position_on, m20_waypoints,
                          url_with, write_json)

RAW_API = "https://mars.nasa.gov/rss/api/"
RAW_PAGE = "https://mars.nasa.gov/mars2020/multimedia/raw-images/"
PHOTO_W = 1200
PHOTO_Q = 80
MAX_PHOTO_BYTES = 230_000
MAX_PAGES = 15  # pages of 100 frames read per sol
SAME_SPOT_M = 30.0

N = "https://www.nasa.gov/missions/mars-2020-perseverance/perseverance-rover/"

# id, name, sol (rover parked there), photo sols in order of preference, cameras in order, where (for captions),
# summary (two sentences), detail, NASA pages the facts come from.
PLACES = [
    dict(
        id="octavia-e-butler-landing", name="Octavia E. Butler Landing", sol=13, photo_sols=[4, 3, 5, 9, 11],
        cams=("navcam", "mcz"), where="at its landing site",
        summary="This is where Perseverance touched down on 18 February 2021. NASA named the spot after the "
                "science fiction author Octavia E. Butler.",
        detail="The rover made its first test drive from here on 4 March 2021: 4 m forward, a turn on the spot, "
               "then 2.5 m back, 6.5 m in all.",
        sources=["https://www.nasa.gov/image-article/welcome-octavia-e-butler-landing/",
                 "https://mars.nasa.gov/news/8882/nasas-perseverance-drives-on-mars-terrain-for-first-time"],
    ),
    dict(
        id="wright-brothers-field", name="Wright Brothers Field", heli_flight=1, photo_sols=[58],
        cams=("mcz", "navcam"), where="at Van Zyl Overlook, about 64 m from the helicopter, on the day of the first flight",
        summary="Ingenuity made the first powered, controlled flight on another planet here on 19 April 2021. "
                "It rose 3 m, hovered for 30 seconds and landed, 39 seconds in all.",
        detail="NASA named the airfield after the Wright brothers. Perseverance watched from Van Zyl Overlook, "
               "about 64 m away, and passed the helicopter's data on to Earth.",
        sources=["https://www.nasa.gov/news-release/nasas-ingenuity-mars-helicopter-succeeds-in-historic-first-flight/"],
        aliases=["Ingenuity first flight"],
    ),
    dict(
        id="roubion", name="Roubion", sol=164, photo_sols=[164, 165, 163, 162, 166],
        cams=("navcam", "mcz"), where="at Roubion",
        summary="Perseverance tried to drill its first rock core here on 6 August 2021. The rock crumbled, so "
                "the sealed tube holds only Martian air.",
        detail="The drill and the sampling system did what they were told: the rock was old, changed by water "
               "and too weak to hold together. The tube became the mission's one sample of the atmosphere, and "
               "the team moved on to a harder rock, Rochette.",
        sources=["https://science.nasa.gov/blog/assessing-perseverances-first-sample-attempt/",
                 "https://science.nasa.gov/resource/meet-the-mars-samples-roubion-sample-1/"],
        aliases=["Polygon Valley"],
    ),
    dict(
        id="rochette", name="Rochette", sol=190, photo_sols=[190, 191, 194, 196, 188, 186],
        cams=("navcam", "mcz"), where="at Rochette",
        summary="Rochette is the rock that gave Perseverance its first two rock cores, in September 2021. It is "
                "basalt, a volcanic rock that may have formed from lava flows.",
        detail="The cores are named Montdenier and Montagnac. They hold salts, a sign that water was in contact "
               "with this rock for a long time, and the salts may have trapped tiny bubbles of ancient water.",
        sources=["https://www.nasa.gov/news-release/nasas-perseverance-rover-collects-puzzle-pieces-of-mars-history/"],
        aliases=["Artuby Ridge", "Citadelle"],
    ),
    dict(
        id="seitah", name="Séítah", sol=262, photo_sols=[262, 263, 260, 265, 268, 255],
        cams=("navcam", "mcz"), where="at the Brac outcrop in South Séítah",
        summary="Séítah is a stretch of ridges, sand dunes and boulders on the crater floor. At the Brac outcrop "
                "here, the rover found rock packed with large olivine crystals that grew in slowly cooling magma.",
        detail="It is not yet known whether that magma cooled in a thick lava lake on the surface or in a chamber "
               "underground. The rocks here also met water more than once. Two cores, Salette and Coulettes, were "
               "drilled from Brac in November 2021.",
        sources=["https://www.nasa.gov/centers-and-facilities/jpl/nasas-perseverance-mars-rover-makes-surprising-discoveries/",
                 "https://www.nasa.gov/news-release/nasas-perseverance-rover-collects-puzzle-pieces-of-mars-history/"],
        aliases=["Seitah", "South Seitah", "Brac"],
    ),
    dict(
        id="jezero-delta-front", name="Jezero delta front", sol=424, photo_sols=[424, 423, 425],
        cams=("navcam", "mcz"), where="at the foot of the delta",
        summary="This is the foot of the delta, a fan of rock and sediment at the western edge of Jezero crater. "
                "It formed billions of years ago where a river ran into the crater's lake.",
        detail="Perseverance reached the delta on 13 April 2022 after crossing about 5 km of crater floor in 31 "
               "sols. NASA calls the delta one of the best places on Mars to look for signs of past microscopic "
               "life.",
        sources=["https://www.nasa.gov/solar-system/nasas-perseverance-rover-arrives-at-delta-for-new-science-campaign/"],
        aliases=["Delta front", "Western delta"],
    ),
    dict(
        id="wildcat-ridge", name="Wildcat Ridge", sol=509, photo_sols=[509, 510, 505, 507, 512, 516],
        cams=("navcam", "mcz"), where="at Wildcat Ridge",
        summary="Wildcat Ridge is a rock about 1 m wide, made of mud and fine sand that settled in a salty lake "
                "billions of years ago. In it the rover's SHERLOC instrument made its strongest detection of "
                "organic molecules up to then.",
        detail="Organic molecules are carbon compounds. They can form with or without life, so they are not "
               "proof of life. Two cores, Hazeltop and Bearwallow, were drilled here in July and August 2022. "
               "A nearby sandstone, Skinner Ridge, carries grains that came from far outside the crater.",
        sources=["https://www.nasa.gov/news-release/nasas-perseverance-rover-investigates-geologically-rich-mars-terrain/"],
        aliases=["Skinner Ridge", "Hogwallow Flats"],
    ),
    dict(
        id="observation-mountain", name="Observation Mountain", sol=634, photo_sols=[634, 635, 636, 639, 633],
        cams=("navcam", "mcz"), where="at Observation Mountain",
        summary="Here the rover took its first two samples of loose Martian soil, in December 2022. They came "
                "from a low ripple of dust, sand and pebbles shaped by the wind.",
        detail="Wind carries fine grains a long way, so the soil can hold material from well beyond this spot. "
               "It also helps show how Martian dust will act on spacecraft and on astronauts. The samples are "
               "named Atmo Mountain and Crosswind Lake.",
        sources=["https://science.nasa.gov/resource/meet-the-mars-samples-atmo-mountain-and-crosswind-lake-samples-17-and-18/"],
    ),
    dict(
        id="three-forks", name="Three Forks sample depot", sol=690, photo_sols=[693, 690, 691, 688, 687],
        cams=("mcz", "navcam"), where="at the Three Forks sample depot",
        summary="Perseverance laid ten sample tubes on the ground here in December 2022 and January 2023. They "
                "are a backup set, in case the rover cannot hand over the samples it carries.",
        detail="The depot holds one sample from each pair taken up to then, one tube of Martian air and one "
               "witness tube, set out in a zigzag. The last tube was dropped on 28 January 2023. The rover "
               "first came to Three Forks on 13 April 2022, when it reached the delta.",
        sources=[N + "nasas-perseverance-rover-completes-mars-sample-depot/",
                 "https://science.nasa.gov/resource/perseverances-portrait-of-the-sample-depot/"],
        aliases=["Sample depot"],
    ),
    dict(
        id="berea", name="Berea", sol=749, photo_sols=[749, 750, 748, 745, 743],
        cams=("navcam", "mcz"), where="at Berea",
        summary="Berea is a rock on top of the delta, cored on 30 March 2023. Scientists think it is made of "
                "material that an ancient river carried here.",
        detail="The rock is rich in carbonate, a mineral that forms in liquid water. On Earth, carbonate rocks "
               "keep a long record of climate and can preserve fossils. The core is named Melyn.",
        sources=[N + "nasas-perseverance-collects-first-mars-sample-of-new-science-campaign/"],
        aliases=["Tenby", "Upper fan"],
    ),
    dict(
        id="belva-crater", name="Belva crater", sol=772, photo_sols=[772, 773, 771, 774],
        cams=("mcz", "navcam"), where="at Echo Creek, on the west rim of Belva crater",
        summary="Belva is an impact crater 0.9 km wide inside Jezero. Perseverance parked just west of its rim "
                "in April 2023 and photographed the layers of rock in its walls.",
        detail="A crater like this works as a natural road cut. One stack of steeply tilted layers may be a "
               "large sandbar, left by a river that once flowed into Jezero's lake. The rover took 152 Mastcam-Z "
               "images here on sol 772.",
        sources=[N + "nasas-perseverance-rover-captures-view-of-mars-belva-crater/"],
        aliases=["Echo Creek"],
    ),
    dict(
        id="bunsen-peak", name="Bunsen Peak", sol=1088, photo_sols=[1088, 1089, 1087, 1085, 1090],
        cams=("navcam", "mcz"), where="at Bunsen Peak",
        summary="Bunsen Peak is a rock about 1.7 m wide and 1 m high that stands above the ground around it. "
                "It is about three quarters carbonate grains, cemented by almost pure silica.",
        detail="Both minerals are very good at keeping traces of microbes, if any lived here. The rock belongs "
               "to the margin unit along the inside of the crater rim, which may have formed on the shore of "
               "the old lake. The core, Comet Geyser, was drilled on 12 March 2024.",
        sources=[N + "rock-sampled-by-nasas-perseverance-embodies-why-rover-came-to-mars/"],
        aliases=["Margin unit"],
    ),
    dict(
        id="neretva-vallis", name="Neretva Vallis", sol=1164, photo_sols=[1164, 1165, 1163, 1166, 1167],
        cams=("navcam", "mcz"), where="at Mount Washburn in Neretva Vallis",
        summary="Neretva Vallis is the dry river channel that carried water into Jezero crater billions of years "
                "ago. Perseverance drove into it in mid 2024 and stopped at Mount Washburn, a hill covered with "
                "boulders.",
        detail="Some boulders here are of a kind not seen on Mars before. One pale, speckled boulder, named "
               "Atoko Point, stands out from all the rest. The channel is about 400 m wide, and the rover "
               "crossed a field of sand dunes in it to save time.",
        sources=[N + "nasas-perseverance-fords-an-ancient-river-to-reach-science-target/",
                 "https://science.nasa.gov/blog/bright-rocks-and-bright-angel/"],
        aliases=["Mount Washburn", "Atoko Point"],
    ),
    dict(
        id="bright-angel", name="Bright Angel", sol=1178, photo_sols=[1178, 1179, 1180, 1181],
        cams=("navcam", "mcz"), where="at Bright Angel",
        summary="Bright Angel is an area of pale rock outcrops at the foot of the north wall of Neretva Vallis. "
                "Perseverance reached it on 9 June 2024.",
        detail="The pale rock may be old bedrock uncovered by the river, or sediment that later filled the "
               "channel. The rock named Cheyava Falls was found here in July 2024.",
        sources=[N + "nasas-perseverance-fords-an-ancient-river-to-reach-science-target/",
                 "https://www.nasa.gov/news-release/nasa-says-mars-rover-discovered-potential-biosignature-last-year/"],
    ),
    dict(
        id="cheyava-falls", name="Cheyava Falls", sol=1215, photo_sols=[1215, 1217, 1216, 1213, 1212, 1218],
        cams=("navcam", "mcz"), where="at Cheyava Falls",
        summary="Cheyava Falls is an arrowhead-shaped rock with millimetre-size pale spots ringed in black, like "
                "leopard spots. The spots come from chemical reactions that microbes could have used for energy, "
                "so NASA calls the rock a potential sign of ancient life, not a proven one.",
        detail="The rock also holds organic compounds and white veins of calcium sulfate, left by water that "
               "once ran through it. A core named Sapphire Canyon was drilled here on 21 July 2024. In 2025 a "
               "study in the journal Nature reported the iron minerals vivianite and greigite in the spots. "
               "They can form with or without life, and it will take more study to tell which happened here.",
        sources=[N + "nasas-perseverance-rover-scientists-find-intriguing-mars-rock/",
                 "https://www.nasa.gov/news-release/nasa-says-mars-rover-discovered-potential-biosignature-last-year/"],
        aliases=["Sapphire Canyon", "Leopard spots"],
    ),
    dict(
        id="lookout-hill", name="Lookout Hill", sol=1354, photo_sols=[1355, 1356, 1357, 1354],
        cams=("navcam", "mcz"), where="at Lookout Hill, on top of the crater rim",
        summary="Lookout Hill is where Perseverance came over the top of Jezero crater's rim in December 2024. "
                "The climb took about three and a half months and gained 500 m of height.",
        detail="The rover climbed slopes of up to 20 percent on the way. From here it drove down the far side "
               "of the rim to Witch Hazel Hill, about 450 m away.",
        sources=[N + "nasas-perseverance-rover-reaches-top-of-jezero-crater-rim/"],
        aliases=["Crater rim", "Jezero crater rim"],
    ),
    dict(
        id="witch-hazel-hill", name="Witch Hazel Hill", sol=1401, photo_sols=[1401, 1402, 1400, 1399, 1398],
        cams=("navcam", "mcz"), where="at Shallow Bay on Witch Hazel Hill",
        summary="Witch Hazel Hill is a slope about 135 m tall on the outer side of Jezero's rim, with layer on "
                "layer of very old rock. Perseverance studied it for more than four months from December 2024.",
        detail="The first core here, Silver Mountain, came from a rock that most likely formed at least 3.9 "
               "billion years ago. A second rock, Tablelands, is made almost entirely of serpentine minerals, "
               "which form when a lot of water reacts with rock that cooled from magma.",
        sources=[N + "nasas-perseverance-mars-rover-studies-trove-of-rocks-on-crater-rim/",
                 N + "nasas-perseverance-rover-reaches-top-of-jezero-crater-rim/"],
        aliases=["Shallow Bay", "Silver Mountain", "Tablelands"],
    ),
    dict(
        id="krokodillen", name="Krokodillen", sol=1552, photo_sols=[1552, 1553, 1554, 1555],
        cams=("navcam", "mcz"), where="on the Krokodillen plateau",
        summary="Krokodillen is a rocky plateau of about 30 hectares, downslope from Witch Hazel Hill. Its rocks "
                "formed before Jezero crater existed and are among the oldest on Mars.",
        detail="The rover found clay minerals in this bedrock. Clays need liquid water to form, so they point "
               "to water here very early in the planet's history. The name means 'the crocodile' in Norwegian, "
               "after a mountain ridge on the island of Prins Karls Forland.",
        sources=[N + "nasas-perseverance-mars-rover-to-take-bite-out-of-krokodillen/"],
    ),
    dict(
        id="valinor-hills", name="Valinor Hills", heli_flight=72, photo_sols=[1068],
        cams=("mcz",), where="about 415 m from Valinor Hills, where Ingenuity stands",
        summary="Ingenuity's 72nd and last flight ended here on 18 January 2024, when a hard landing damaged its "
                "rotor blades. The helicopter is still at this spot, which its team named Valinor Hills.",
        detail="Ingenuity was built to make no more than five test flights. It flew 72 times in almost three "
               "years. Perseverance photographed it from about 415 m away on sol 1068.",
        sources=["https://science.nasa.gov/resource/ingenuity-at-valinor-hills/",
                 "https://science.nasa.gov/mission/mars-2020-perseverance/ingenuity-mars-helicopter/"],
        aliases=["Ingenuity final airfield", "Airfield Chi"],
    ),
]

# Frames chosen by eye for a place, by image id, instead of the rule: { place id: [image id, ...] }.
# Valinor Hills: the rover stood at site 50, drive 1534 (heading 11.8 degrees) and Ingenuity lay 416 m away
# on a bearing of 320.8 degrees, so it is in the mosaic frame aimed 51 degrees left of the rover's heading.
PICK: dict[str, list[str]] = {
    "wright-brothers-field": [
        "ZL0_0058_0672087376_988ECM_N0032046ZCAM05029_110085J",
        "NLF_0058_0672092439_971ECM_N0032046NCAM00412_01_195J",
    ],
    "valinor-hills": [
        "ZL0_1068_0761745592_069EBY_N0501534ZCAM09086_1100LMJ",
        "ZL0_1068_0761745910_069EBY_N0501534ZCAM09086_1100LMJ",
    ],
}

# Captions written by eye for single frames: { image id: text after the date }.
CAPTION_TAIL: dict[str, str] = {
    "ZL0_1068_0761745592_069EBY_N0501534ZCAM09086_1100LMJ":
        "from about 415 m away. Ingenuity is the small dark object on the sand near the top left.",
    "ZL0_0058_0672087376_988ECM_N0032046ZCAM05029_110085J":
        "from Van Zyl Overlook, about 64 m away. Ingenuity stands on Wright Brothers Field on the day of its "
        "first flight.",
}

# Mastcam-Z pointings (mast azimuth, elevation, degrees, rover frame) used to photograph the rover's own
# drill bits after sampling: such frames show hardware, not the place.
DRILL_POINTINGS = ((-23.4, -2.4), (-5.0, -12.6))

# Frames the rule picked that turned out to show the rover deck, a calibration target or nothing of the place.
SKIP: set[str] = {
    "ZL0_1178_0771514956_144EBY_N0540000ZCAM09219_0630LMJ",  # the rover's own mast fills the foreground
    "ZL0_1356_0787315956_285EBY_N0640000ZCAM09420_1100LMJ",  # the rover's own mast fills the foreground
}

CAMERA_NAMES = {"NAVCAM_LEFT": "Navcam (left)", "MCZ_LEFT": "Mastcam-Z (left)"}
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def dist_m(a, b) -> float:
    lat = math.radians((a["lat"] + b["lat"]) / 2)
    return MARS_RADIUS_M * math.hypot(math.radians(b["lon"] - a["lon"]) * math.cos(lat), math.radians(b["lat"] - a["lat"]))


def frames_on(sol: int) -> list[dict]:
    """Full Navcam (left) and Mastcam-Z (left) frames of a sol, from the raw images feed."""
    out, page = [], 0
    while page < MAX_PAGES:
        url = url_with(RAW_API, {
            "feed": "raw_images", "category": "mars2020", "feedtype": "json", "ver": "1.2", "num": 100,
            "page": page, "order": "sol asc", "search": "|NAVCAM_LEFT|MCZ_LEFT",
            "condition_2": f"{sol}:sol:gte", "condition_3": f"{sol}:sol:lte", "extended": "sample_type::full,",
        })
        d = fetch_json(url, f"raw/sol{sol:04d}_p{page:02d}.json")
        out.extend(d.get("images", []))
        page += 1
        if not d.get("images") or page * 100 >= int(d.get("total_results", 0)):
            break
    return out


def tuple_of(text: str) -> tuple[float, ...]:
    return tuple(float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", text or ""))


def candidate(im: dict) -> dict | None:
    """A frame worth showing: full colour, wide enough, daylight, camera near level. Returns its score."""
    inst = im["camera"]["instrument"]
    ext = im.get("extended", {})
    dim = tuple_of(ext.get("dimension", ""))
    if len(dim) != 2 or dim[0] < PHOTO_W or dim[1] < 800 or im.get("sample_type") != "Full":
        return None
    if inst == "NAVCAM_LEFT":
        if not im["imageid"].startswith("NLF"):
            return None
        if float(ext.get("scaleFactor") or 1) < 2:  # a narrow crop, not the wide view
            return None
        kind, lo, hi, best = "navcam", -32.0, 8.0, -12.0
    elif inst == "MCZ_LEFT":
        if im["camera"].get("filter_name") != "ZCAM_L0_RGB":
            return None
        kind, lo, hi, best = "mcz", -16.0, 10.0, -3.0
    else:
        return None
    try:
        el, az = float(ext["mastEl"]), float(ext["mastAz"])
        scale = float(ext.get("scaleFactor") or 1)
    except (KeyError, TypeError, ValueError):
        return None
    if kind == "mcz" and any(az_apart(az, a) < 3.0 and abs(el - e) < 1.5 for a, e in DRILL_POINTINGS):
        return None
    m = re.search(r"M(\d\d):(\d\d)", im.get("date_taken_mars", ""))
    hour = int(m.group(1)) + int(m.group(2)) / 60 if m else 12.0
    if not (lo <= el <= hi) or not (8.5 <= hour <= 17.0):
        return None
    score = -abs(el - best) + (4.0 * math.log2(scale) if kind == "navcam" else 0.0) - 0.4 * abs(hour - 12.5)
    return {"im": im, "kind": kind, "az": az, "el": el, "score": score}


def looks_fine(img: Image.Image) -> bool:
    """Reject frames that are dark, washed out, nearly blank, partly missing or grey."""
    small = img.resize((240, 180))
    g = small.convert("L")
    st = ImageStat.Stat(g)
    black = sum(g.histogram()[:4]) / (240 * 180)
    r, _, b = ImageStat.Stat(small).mean
    in_colour = r - b >= 8  # some raw frames come down grey (not yet colour-processed)
    return 45 <= st.mean[0] <= 215 and st.stddev[0] >= 16 and black < 0.02 and in_colour


def load_frame(im: dict) -> Image.Image | None:
    files = im["image_files"]
    for key in ("full_res", "large"):
        url = files.get(key)
        if not url:
            continue
        try:
            raw = fetch(url, "raw/img/" + url.rsplit("/", 1)[-1], timeout=180)
            return Image.open(io.BytesIO(raw)).convert("RGB")
        except Exception as e:
            print(f"    could not read {url}: {e}", file=sys.stderr)
    return None


def write_photo(img: Image.Image, path) -> int:
    h = round(img.height * PHOTO_W / img.width)
    small = img.resize((PHOTO_W, h), Image.LANCZOS)
    for q in (PHOTO_Q, 72, 64):
        small.save(path, "WEBP", quality=q, method=6)
        if path.stat().st_size <= MAX_PHOTO_BYTES:
            break
    return path.stat().st_size


def earth_date(im: dict) -> str:
    y, m, d = (int(x) for x in im["date_taken_utc"][:10].split("-"))
    return f"{d} {MONTHS[m - 1]} {y}"


def az_apart(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def choose_frames(place: dict, pos: dict, wps: list[dict], want: int = 3) -> list[tuple[dict, Image.Image]]:
    """Up to `want` frames: the named ones if the place has any, else by rule (at most two from the first
    camera kind). Sols are read in order of preference and only until enough frames are found."""
    named = PICK.get(place["id"], [])
    by_id: dict[str, dict] = {}
    pools: dict[str, list[dict]] = {"navcam": [], "mcz": []}
    checked: dict[str, Image.Image | None] = {}

    def good(im: dict) -> Image.Image | None:
        iid = im["imageid"]
        if iid not in checked:
            img = load_frame(im)
            checked[iid] = img if img is not None and looks_fine(img) else None
        return checked[iid]

    def interest(c: dict) -> float:
        """How much there is to see, from the small preview: contrast, plus the pointing score.
        Minus infinity for a preview that is grey, dark or blank."""
        if "interest" not in c:
            c["interest"] = float("-inf")
            url = c["im"]["image_files"].get("small")
            try:
                thumb = Image.open(io.BytesIO(fetch(url, "raw/thumb/" + url.rsplit("/", 1)[-1]))).convert("RGB")
                if looks_fine(thumb):
                    c["interest"] = ImageStat.Stat(thumb.convert("L")).stddev[0] + c["score"]
            except Exception as e:
                print(f"    no preview for {c['im']['imageid']}: {e}", file=sys.stderr)
        return c["interest"]

    def by_rule() -> list[tuple[dict, Image.Image]]:
        picked: list[tuple[dict, Image.Image]] = []
        taken: list[dict] = []
        for n, kind in enumerate(place["cams"]):
            limit = 2 if n == 0 and len(place["cams"]) > 1 else want
            apart = 55.0 if kind == "navcam" else 12.0
            got = 0
            # Per sol, the 16 best-aimed frames, then the ones with most to see first.
            short: list[dict] = []
            for order in sorted({c["order"] for c in pools[kind]}):
                of_sol = sorted((c for c in pools[kind] if c["order"] == order), key=lambda c: -c["score"])[:16]
                short.extend(sorted((c for c in of_sol if interest(c) > float("-inf")), key=lambda c: -c["interest"]))
            for c in short:
                if len(picked) >= want or got >= limit:
                    break
                if any(t["kind"] == kind and az_apart(t["az"], c["az"]) < apart for t in taken):
                    continue
                img = good(c["im"])
                if img is None:
                    continue
                picked.append((c["im"], img))
                taken.append(c)
                got += 1
        return picked

    best: list[tuple[dict, Image.Image]] = []
    for order, sol in enumerate(place["photo_sols"]):
        if "heli_flight" not in place and place["sol"] > 13:
            # The rover must be parked at the place that sol, and must not have arrived that same sol.
            here, before = m20_position_on(sol, wps), m20_position_on(sol - 1, wps)
            if dist_m(here, pos) > SAME_SPOT_M or dist_m(before, pos) > SAME_SPOT_M:
                continue
        try:
            frames = frames_on(sol)
        except Exception as e:
            print(f"    sol {sol}: feed did not answer ({e})", file=sys.stderr)
            continue
        for im in frames:
            by_id[im["imageid"]] = im
            c = candidate(im)
            if c and im["imageid"] not in SKIP:
                c["order"] = order
                pools[c["kind"]].append(c)
        if named:
            if all(i in by_id for i in named):
                break
            continue
        best = by_rule()
        if len(best) >= want:
            break

    if named:
        out = []
        for iid in named[:want]:
            im = by_id.get(iid)
            img = load_frame(im) if im else None
            if img is None:
                print(f"    picked frame {iid} not found on sols {place['photo_sols']}", file=sys.stderr)
                continue
            out.append((im, img))
        return out
    return best


def sample_places() -> list[dict]:
    path = DATA / "samples.json"
    if not path.exists():
        print("samples.json not found: run build_samples.py first; no sample places added", file=sys.stderr)
        return []
    out = []
    for s in json.loads(path.read_text(encoding="utf-8")):
        store = "at the Three Forks sample depot" if s["store"] == "depot" else "on board the rover"
        when = f"around sol {s['sol']}" if s.get("solApprox") or s["solSealed"] is None else f"on sol {s['sol']}"
        kind = s["type"].lower()
        if kind.startswith("atmos"):
            summary = (f"{s['name']} is sample {s['number']} of the Perseverance mission: a tube of Martian air, "
                       f"sealed on sol {s['sol']} after the rock {s['feature']} crumbled during coring. "
                       f"The tube is {store}.")
        elif kind.startswith("regolith"):
            summary = (f"{s['name']} is sample {s['number']} of the Perseverance mission: loose soil scooped at "
                       f"{s['feature']} {when}. NASA describes it as {s['rock'][0].lower() + s['rock'][1:]}, "
                       f"and the tube is {store}.")
        else:
            summary = (f"{s['name']} is sample {s['number']} of the Perseverance mission: a rock core drilled "
                       f"from {s['feature']} {when}. NASA lists the rock type as {s['rock'].lower()}, "
                       f"and the tube is {store}.")
        out.append({
            "id": f"sample-{s['id']}",
            "name": f"{s['name']} (sample {s['number']})",
            "kind": "sample",
            "lon": s["lon"],
            "lat": s["lat"],
            "elev": s["elev"],
            "sol": s["sol"],
            "summary": summary,
            "detail": s["note"],
            "photos": [],
            "sources": ["https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/"],
        })
    return out


def heli_landing(flight: int) -> dict:
    d = fetch_json("https://mars.nasa.gov/mmgis-maps/M20/Layers/json/m20_heli_waypoints.json", "m20_heli_waypoints.json")
    for f in d["features"]:
        p = f["properties"]
        if int(p["Flight"]) == flight:
            return {"lon": round(float(p["Lon"]), 6), "lat": round(float(p["Lat"]), 6),
                    "elev": round(float(p["Elev_Geoid"]), 1), "sol": int(p["Sol"])}
    raise RuntimeError(f"flight {flight} is not in the helicopter waypoints")


def main() -> int:
    only = set(sys.argv[1:])
    wps = m20_waypoints()
    photos_dir = DATA / "photos"
    photos_dir.mkdir(parents=True, exist_ok=True)
    places, photo_bytes, n_photos = [], 0, 0
    old = {}
    if only and (DATA / "places.json").exists():
        old = {p["id"]: p for p in json.loads((DATA / "places.json").read_text(encoding="utf-8"))}

    for place in PLACES:
        pid = place["id"]
        if only and pid not in only and pid in old:
            places.append(old[pid])
            continue
        if "heli_flight" in place:
            pos = heli_landing(place["heli_flight"])
            sol = pos["sol"]
        else:
            pos = m20_position_on(place["sol"], wps)
            sol = place["sol"]
        for stale in photos_dir.glob(f"{pid}-*.webp"):
            stale.unlink()
        photos = []
        for n, (im, img) in enumerate(choose_frames(place, pos, wps), start=1):
            path = photos_dir / f"{pid}-{n}.webp"
            size = write_photo(img, path)
            photo_bytes += size
            n_photos += 1
            cam = CAMERA_NAMES[im["camera"]["instrument"]]
            photos.append({
                "src": f"/data/photos/{pid}-{n}.webp",
                "caption": f"{cam.split(' (')[0]} view from Perseverance on sol {im['sol']} ({earth_date(im)}), "
                           + CAPTION_TAIL.get(im["imageid"], f"parked {place['where']}."),
                "camera": cam,
                "sol": int(im["sol"]),
                "credit": im.get("credit") or "NASA/JPL-Caltech",
                "id": im["imageid"],
                "link": im.get("link") or RAW_PAGE,
            })
        entry = {"id": pid, "name": place["name"], "kind": "m20", "lon": pos["lon"], "lat": pos["lat"],
                 "elev": pos["elev"], "sol": sol, "summary": place["summary"], "detail": place["detail"],
                 "photos": photos, "sources": place["sources"]}
        if place.get("aliases"):
            entry["aliases"] = place["aliases"]
        places.append(entry)
        print(f"  {pid:26s} sol {sol:4d}  {pos['lon']:.5f} {pos['lat']:.5f}  photos: "
              + (", ".join(f"{p['id'][:3]} sol {p['sol']}" for p in photos) or "NONE"))

    m20_count = len(places)
    places.extend(sample_places())
    write_json(DATA / "places.json", places, indent=1)
    total = sum(f.stat().st_size for f in photos_dir.glob("*.webp"))
    print(f"{m20_count} Mars 2020 places, {len(places) - m20_count} sample places, "
          f"{len(list(photos_dir.glob('*.webp')))} photos, {total / 1e6:.2f} MB of photos")

    pages = sorted({u for p in PLACES for u in p["sources"]})
    add_source(
        id="m20-places",
        name="Mars 2020 named places",
        mission="Mars 2020 Perseverance and Ingenuity",
        product="Place names and facts from NASA mission pages; positions from JPL MMGIS localisations",
        url="https://science.nasa.gov/mission/mars-2020-perseverance/",
        licence="Public domain (NASA/JPL-Caltech). Summaries written for this app from the NASA pages listed.",
        notes="Each place sits at the rover's localised stop on the sol it worked there (the two airfields at "
        "Ingenuity's landing points). These are the team's informal names, not IAU names. Facts are taken from: "
        + " ; ".join(pages) + " . The sample cores from the m20-samples source are added as places of kind 'sample'.",
    )
    add_source(
        id="m20-raw-images",
        name="Perseverance raw images (Navcam and Mastcam-Z)",
        mission="Mars 2020 Perseverance",
        product="Raw images feed, cameras NAVCAM_LEFT and MCZ_LEFT (full frames)",
        url=RAW_PAGE,
        licence="Public domain. Credit NASA/JPL-Caltech (Navcam) and NASA/JPL-Caltech/ASU (Mastcam-Z).",
        notes=f"From {RAW_API}?feed=raw_images&category=mars2020&feedtype=json . One to three frames per place, "
        f"taken while the rover was parked there, resized to {PHOTO_W} px wide WebP. Raw frames: colours are as "
        "the camera recorded them, not calibrated. Each photo keeps its NASA image id and link.",
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
