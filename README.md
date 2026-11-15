# TARS: The Astronauts' Routing System

A map for planning a day of field science on Mars. Built for NASA Space Apps 2026, challenge
"Interplanetary Survival Guide: Martian Map", by team Works On My Planet.

Live at **https://theastronautsroutingsystem.com**.

TARS covers Jezero crater, where Perseverance landed, and about 600 km of land around it. You pick places,
give each one science tasks, and get a route over the real terrain. Then you can stand on the ground at any
point and look around.

## What works today

- The app opens on Mars from orbit, with the local time at Jezero, the light time from Earth and the season,
  and flies down to Jezero on one map.
- The map draws on imagery from Viking, THEMIS, CTX and HiRISE. Over Jezero it keeps sharpening as you zoom in:
  from zoom 15 its detail comes from the 25 cm HiRISE mosaic and its terrain from HiRISE's 1 m model, both
  streamed from USGS, down to zoom 19 in 3D at true scale. It is lit as at mid-morning so dark ground reads,
  and can follow the real sun at Jezero instead.
  Search finds named features, the places Perseverance studied, its samples, and coordinates.
- Click anywhere for a place card: the rover's own photos if it was there, a short summary and four numbers.
  Geology, modelled conditions, sources and nearby places open on request. Under the modelled conditions are
  the last reports from Perseverance's and Curiosity's weather stations.
- A mission plan has a vehicle, a start, and stops with tasks. Stops reorder by dragging. Each leg is routed
  three ways (safest, fastest, least effort) and the route is coloured by slope against what the vehicle can
  climb. The plan travels in the link.
- The layers are the USGS geologic map with its legend, two CRISM mineral maps, slope for the chosen vehicle,
  place names and Perseverance's track.
- Discover follows Perseverance sol by sol, with the photos it took that day fetched from NASA.
- Rover View is a 3D view from eye level, with the sky and light of the hour you choose. Over Jezero the ground
  under your feet is HiRISE's own 1 m model draped with its 25 cm image, streamed in as you walk; it opens on
  the coarser package first and sharpens when the tiles arrive. The mouse wheel lifts you up to 150 m for a
  drone's view. Rocks are scattered where HiRISE shows broken ground and kept off the sand. NASA's 3D models
  stand in it: Perseverance where it last reported, Ingenuity where it came to rest, and an illustrative base
  (habitat, crew in Z-2 suits, pressurised rover) at a mission's start. Rover wheels turn as they drive, and the
  crew walk with their boots planted.
- The Mars clock reads NASA's DONKI database every half hour and says when a solar storm cloud is forecast
  at Mars.
- The trip budget says whether a plan works: time, oxygen or battery, water, radiation dose, a height
  profile, and the point of no return. A plan made at night leaves the first morning it fits in daylight.
- Start runs the mission in simulated time at 1x to 100x. A run panel follows the crew; alerts in four
  levels warn before trouble; a dust devil on the route offers a way round that is drawn before it is taken;
  the base answers on the radio. Ride along opens the 3D view on the crew with a helmet display.
- Walking range rings, a flight along the route, GPX, GeoJSON and a printable cuff card, and a check of the
  planner against five stretches of Perseverance's real drive.
- Crews. A mission can be planned and run by several people at once: invites, roles, shared tasks and notes,
  who is online, androids as virtual crew, and a debrief at the end. Everyone shares one base, and the
  commander's run reaches every member's map and 3D view as it happens. This needs the Convex backend
  (below); without it the app runs solo and the crew features stay hidden.
- Rover View has Jezero Station (a domed hub with an airlock, two laboratory modules and a greenhouse) and,
  walking in your own eyes, a tablet in hand with the map on it.
- On a phone there is a bottom bar, one sheet with three heights, and a thumb pad for walking in Rover View.

## What is not built

- A second tab as a base console. The channel that would keep two tabs in step exists; the screen does not.
- Sound effects, the moons and dust in the 3D view, and photo cards beside the rover's stops there.
- A limit for cold: the temperature is worked out along a route and shown, and nothing acts on it.

`docs/progress.md` has the detail.

## Run it

Node 22.12 or later.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. That is the whole app for one person.

For crews, run the Convex backend beside it. The first run asks you to log in or to use a local deployment,
and writes `VITE_CONVEX_URL` to `.env.local`:

```bash
npx convex dev
```

```bash
npm run check   # types, lint, unit tests
npm run e2e     # browser tests
```

The tile package and datasets are already in `public/`. To rebuild them, see `tools/` (Python 3.14,
`tools/requirements.txt`): `tools/build_region.py` for tiles, the other `build_*.py` scripts for the rest.

A NASA API key is optional. Copy `.env.example` to `.env.local` and set `NASA_API_KEY`. It is read only by
the two functions under `api/` and never reaches the browser; without it they use NASA's keyless server.

## Deploy

The app is a static site plus four small functions under `api/`, set up for Vercel (`vercel.json`), and a
Convex backend for crews.

1. Crews (optional): `npx convex deploy` pushes `convex/` to a production deployment. Note its URL.
2. In Vercel, choose Add New, Project, and import this GitHub repository. The framework (Vite), the build
   command and the output folder are read from `vercel.json`.
3. Under Settings, Environment Variables: `VITE_CONVEX_URL` with the production URL from step 1, and
   optionally `NASA_API_KEY` with a key from https://api.nasa.gov.
4. Deploy. Every push to `main` deploys again. The domain, `theastronautsroutingsystem.com`, is added under
   Settings, Domains.

The tile package under `public/region` is about 100 MB in 8,400 files. Deploying from the Git repository
has no trouble with that; the Vercel CLI's upload limit on the Hobby plan does.

## Where the data comes from, and how fresh it is

Data that changes is asked for while the app runs. Data that does not change is shipped with the app, because
its sources are multi-gigabyte files rather than services a browser can ask, and shipping it keeps the app fast
and working offline.

| What | How it arrives | How fresh |
|---|---|---|
| Space weather (solar storms, flares, particle events) | Live from NASA DONKI through `/api/spaceweather` | Re-asked every 30 minutes |
| Rover weather stations (Perseverance MEDA, Curiosity REMS) | Live through `/api/weather`; `public/data/weather.json` is the fallback and holds each station's long-term extremes | Hourly. These are measurements of past sols; NASA publishes no forecast for Mars. MEDA's feed has not been updated by NASA since April 2024 |
| Perseverance's track and stops | Live from JPL's MMGIS layers through `/api/traverse`; `public/data/traverses/m20.json` is the fallback | Every six hours. The rover is still driving |
| Perseverance's raw photos in Discover | Live from NASA's raw images feed, for whichever sol you pick | On request |
| HiRISE 25 cm imagery and 1 m elevation over Jezero | Live from USGS through `/api/hirise`, cut into tiles | Fixed products: cached for a year |
| CTX, HiRISE (global) and Viking detail elsewhere | Live from Esri and NASA Mars Trek tile services | Fixed products |
| Base map and terrain (`public/region`, 100 MB) | Shipped. Built by `tools/build_region.py` from MOLA, HRSC, CTX, THEMIS and Viking mosaics, graded and level-matched | Fixed products |
| Place names, geology, cave candidates, landing sites | Shipped (`public/data`) | Change rarely; rebuilt with the tools |
| Named places, samples and their photos | Shipped. Written from NASA's mission pages, which have no API; the photos are one to three chosen frames per place | Historical; `tools/build_places.py` and `tools/build_samples.py` add new ones |

## Data

All data is from NASA and USGS, apart from three CC0 close-up textures that add grain below what HiRISE can
see: MOLA, HRSC, CTX, HiRISE, THEMIS, Viking, CRISM, the Mars 2020 terrain
models, Perseverance's localisation and raw images, the IAU Gazetteer and the USGS geologic map. Each product,
its source and its licence are listed in [docs/data-sources.md](docs/data-sources.md).

Everything worked out from that data (temperature, dust, radiation, walking effort, routes) is labelled
"modelled" in the app. [docs/model-notes.md](docs/model-notes.md) says how each model works and where it
stops being reliable. In Rover View the shape of the ground and the HiRISE image on it are real; rocks and the grain below 25 cm
are drawn in.

NASA does not endorse this project.

## License

The code is under the MIT License (`LICENSE`). The data, imagery and 3D models it uses keep their own terms,
listed in [docs/data-sources.md](docs/data-sources.md); most are public domain NASA and USGS products.

## How it was made

All code in this repository was written during the event, starting from an empty repository on
14 November 2026.

The code, the data tools and this document were written with Claude (Anthropic), working from a
specification and direction from the team. The team reviewed the result and decided what to keep.

The project was called Areo while it was built; the specification and the progress notes still use that
name, and so do a few names inside the code.

A team member built a learning prototype before the hackathon. None of its code or data is in this
repository. What it taught went into the specification (`docs/build-spec.md`).

## Layout

```
src/engines   pure, tested models: time, conditions, vehicles, terrain, routing
src/map       the MapLibre map, the mars:// tile protocol, layers
src/planner   route planning for a mission
src/sim       running a mission in simulated time
src/net       the crew layer over Convex
src/visor     the three.js ground view
src/ui        panels and controls
convex        the crew backend: missions, people, the shared base, the live feed
api           the Vercel functions: HiRISE tiles, space weather, rover weather, the traverse
tools         Python scripts that build public/region and public/data
docs          the specification, design, plan, progress, sources and model notes
```
