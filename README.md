# Areo

A map for planning a day of field science on Mars. Built for NASA Space Apps 2026, challenge
"Interplanetary Survival Guide: Martian Map", by team Works On My Planet.

Areo covers Jezero crater, where Perseverance landed, and about 600 km of land around it. You pick places,
give each one science tasks, and get a route over the real terrain. Then you can stand on the ground at any
point and look around.

## What works today

- **The planet and the way in.** The app opens on Mars from orbit and flies down to Jezero on one map.
- **The map.** Imagery from Viking, THEMIS, CTX and HiRISE, with elevation down to 1 m around the rover's
  path. Relief is shaded from where the sun stands at Jezero right now. Search finds named features, the
  places Perseverance studied, its samples, and coordinates.
- **Place cards.** Click anywhere: the rover's own photos if it was there, a short summary, four numbers,
  then geology, modelled conditions, sources and nearby places, each opening on request.
- **The mission plan.** A vehicle, a start, and stops with tasks. Stops reorder by dragging. Each leg is
  routed three ways (safest, fastest, least effort) and the route is coloured by slope against what the
  vehicle can climb. The plan travels in the link.
- **Layers.** The USGS geologic map with its legend, two CRISM mineral maps, slope for the chosen vehicle,
  place names and Perseverance's track.
- **Discover.** Follow Perseverance sol by sol, with the photos it took that day fetched from NASA.
- **Rover View.** A 3D view from eye level, built from the same elevation data, with the sky and light of
  the hour you choose.

## What is not built yet

- The trip budget: time, oxygen, power, water and radiation along a route.
- Running a mission in simulated time, with warnings, re-routing and a base on the radio. It needs the budget.
- The helmet display over the 3D view, crew and vehicle models.
- Live space weather, GPX and cuff-card exports, and the check of the router against Perseverance's real drive.

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

A NASA API key is optional. Copy `.env.example` to `.env.local` and set `NASA_API_KEY`.

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

Two things to disclose:

- **AI.** The code, the data tools and this document were written with Claude (Anthropic), working from a
  specification and direction from the team. The team reviewed the result and decided what to keep.
- **A prototype before the event.** A team member built a learning prototype before the hackathon. None of
  its code or data is in this repository, but what it taught went into the specification
  (`docs/build-spec.md`).

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
