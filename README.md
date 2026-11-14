# Areo

A map for planning a day of field science on Mars. Built for NASA Space Apps 2026, challenge
"Interplanetary Survival Guide: Martian Map", by team Works On My Planet.

Areo covers Jezero crater, where Perseverance landed, and about 600 km of land around it. You pick places,
give each one science tasks, and get a route over the real terrain. Then you can stand on the ground at any
point and look around.

## What works today

- The app opens on Mars from orbit and flies down to Jezero on one map.
- The map draws on imagery from Viking, THEMIS, CTX and HiRISE, with elevation down to 1 m around the rover's
  path. It is lit as at mid-morning so dark ground reads, and can follow the real sun at Jezero instead.
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
- Rover View is a 3D view from eye level, built from the same elevation data, with the sky and light of the
  hour you choose. NASA's 3D models stand in it: Perseverance where it last reported, Ingenuity where it came
  to rest, and an illustrative base (habitat, crew in Z-2 suits, pressurised rover) at a mission's start.
- The Mars clock reads NASA's DONKI database every half hour and says when a solar storm cloud is forecast
  at Mars.
- The trip budget says whether a plan works: time, oxygen or battery, water, radiation dose, a height
  profile, and the point of no return. A plan made at night leaves the first morning it fits in daylight.
- Start runs the mission in simulated time at 1x to 100x. A run panel follows the crew; alerts in four
  levels warn before trouble; a dust devil on the route offers a way round that is drawn before it is taken;
  the base answers on the radio. Ride along opens the 3D view on the crew with a helmet display.
- Walking range rings, a flight along the route, GPX, GeoJSON and a printable cuff card, and a check of the
  planner against five stretches of Perseverance's real drive.
- On a phone there is a bottom bar, one sheet with three heights, and a thumb pad for walking in Rover View.

## What is not built

- A second tab as a base console. The channel that would keep two tabs in step exists; the screen does not.
- Sound effects, the moons and dust in the 3D view, and photo cards beside the rover's stops there.
- A limit for cold: the temperature is worked out along a route and shown, and nothing acts on it.

`docs/progress.md` has the detail.

## Run it

Node 24 or later.

```bash
npm install
npm run dev
```

Then open http://localhost:5173.

```bash
npm run check   # types, lint, unit tests
npm run e2e     # browser tests
```

The tile package and datasets are already in `public/`. To rebuild them, see `tools/` (Python 3.14,
`tools/requirements.txt`): `tools/build_region.py` for tiles, the other `build_*.py` scripts for the rest.

A NASA API key is optional. Copy `.env.example` to `.env.local` and set `NASA_API_KEY`. It is read only by
the two functions under `api/` and never reaches the browser; without it they use NASA's keyless server.

## Deploy

The app is a static site plus two small functions under `api/`, set up for Vercel (`vercel.json`).

1. In Vercel, choose Add New, Project, and import this GitHub repository. The framework (Vite), the build
   command and the output folder are read from `vercel.json`.
2. Optional: under Settings, Environment Variables, add `NASA_API_KEY` with a key from https://api.nasa.gov.
3. Deploy. Every push to `main` deploys again.

The tile package under `public/region` is about 100 MB in 8,400 files. Deploying from the Git repository
has no trouble with that; the Vercel CLI's upload limit on the Hobby plan does.

## Data

All data is from NASA and USGS: MOLA, HRSC, CTX, HiRISE, THEMIS, Viking, CRISM, the Mars 2020 terrain
models, Perseverance's localisation and raw images, the IAU Gazetteer and the USGS geologic map. Each product,
its source and its licence are listed in [docs/data-sources.md](docs/data-sources.md).

Everything worked out from that data (temperature, dust, radiation, walking effort, routes) is labelled
"modelled" in the app. [docs/model-notes.md](docs/model-notes.md) says how each model works and where it
stops being reliable. In Rover View the shape of the ground is real; rocks and fine texture are drawn in.

NASA does not endorse this project.

## How it was made

All code in this repository was written during the event, starting from an empty repository on
14 November 2026.

The code, the data tools and this document were written with Claude (Anthropic), working from a
specification and direction from the team. The team reviewed the result and decided what to keep.

A team member built a learning prototype before the hackathon. None of its code or data is in this
repository. What it taught went into the specification (`docs/build-spec.md`).

## Layout

```
src/engines   pure, tested models: time, conditions, vehicles, terrain, routing
src/map       the MapLibre map, the mars:// tile protocol, layers
src/planner   route planning for a mission
src/visor     the three.js ground view
src/ui        panels and controls
tools         Python scripts that build public/region and public/data
docs          the specification, design, plan, progress, sources and model notes
```
