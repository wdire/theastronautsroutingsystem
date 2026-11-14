# Progress

Plan: docs/superpowers/plans/2026-11-14-areo.md. One line per task, then rulings.

- [x] 1 Skeleton, design system, store, globe entry (store, URL sync, tokens, Archivo, globe in and out; e2e globe.spec passes). Panels and dock come with their tasks.
- [x] 2 Tile package (8,355 tiles, 89.7 MB: planet z0-4, region img z5-10, core 11-13, crater 14; terrain to z14 over HiRISE; CRISM olivine/pyroxene and carbonate overlays z9-12; check_region.py passes)
- [x] 3 Other datasets and models (names, traverse, Ingenuity flights, 19 places with 48 photos, 30 samples, weather, caves, sites, geology, 5 models; validate_data.py passes)
- [ ] 4 Engines: done and tested: marsTime, environment, vehicles, metabolic, terrain, isochrone, geology, explain, router, relief, lighting (225 tests). NOT written: tripComputer, departure (blocked, see below; tests parked as tripComputer.test.ts.pending), spaceWeather, export, validate, missions, grading, alerts.
- [ ] 5 Real protocol, places, search, place card: protocol (package, ancestor upsample, live Viking/CTX/HiRISE detail), DEM grids, search, place card, clock chip done. Left: e2e tests from the plan, check against the final tile package, Rover View button.
- [ ] 6 Router wiring, route card, mission editor: planner panel (vehicle, start, stops with drag reorder, tasks with minutes, undo, round trip, pick on map), routing per leg in 3 styles with stale-run dropping (unit tested), route and pins on the map, alternatives. Left: budget tiles, timing card, profile strip, briefing (all need tripComputer), templates from missions, click-the-route-to-add-a-stop, draggable pins, e2e tests.
- [ ] 7 Simulation, alerts, base, run panel
- [ ] 8 Visor and Rover View: DONE: three ground layers with shader holes and per-variant program keys, eye-level grading, near ground detail shader (sand, ripples, grains, bedded and jointed rock), instanced rocks (stable hash, slope weighted), sky with sun disc, blue sunset aureole and stars, sun shadows, first-person walking, Rover View screen (compass tape, readout, time presets, WebGL failure message), quality tiers. LEFT: crew and vehicles with NASA models and the rigged Z2 suit, chase and orbit cameras, route guides, mission HUD (O2, power, dose, alerts, chat, mini map), contact shadows, dust motes, moons, on-screen pad for touch, photo cards near Perseverance stops, e2e test.
- [ ] 9 Map look, layers, Discover, flyover: DONE: relief curve with chip, sun lighting, labels (DOM markers, decluttered), Perseverance track, overlays (geology with legend, CRISM olivine and carbonate, slope by vehicle), Layers, Discover (follow Perseverance by sol with live raw photos, places, samples), Missions (4 templates), How it works. LEFT: one-time tilt at zoom 10, walking range rings, flyover, validation against Perseverance, phone bottom sheets polish, e2e.
- [ ] 10 Space weather, exports, validation
- [ ] 11 Docs, phone pass, full suite

## Rulings

- Work happens on `main` of this fresh repository; there is no other branch to protect. Cost if wrong: none
  until the repo has a remote.
- This file is the ledger (the build spec asks for it and it survives `git clean`). Cost if wrong: none.
- Subagents write files and never commit; the main session checks and commits. Cost if wrong: a slower commit.
- Typeface: Archivo (variable, width axis), chosen against IBM Plex Sans, Public Sans and Barlow on a sample place card: its numerals are the most distinct at small sizes and the width axis gives figures a narrower cut without a second family. Cost if wrong: one @font-face swap in src/fonts.css.
- BLOCKED (2026-11-14): the engines subagent for task 4 batch A was stopped by the model's safeguards after
  writing marsTime, environment, metabolic and vehicles (72 tests pass). `src/engines/tripComputer.ts` and
  `src/engines/departure.ts` are not written (a tripComputer.test.ts exists). The main session does not write
  them either; the team decides how (new session or another model). Tasks 6, 7 and the exports in 10 wait on them.
- Map night dimming floors at 0.6 (lighting model says 0.4) and the base image gets contrast +0.28: Jezero is dark basalt and a visitor arriving at Martian night must still read the map. A Full daylight switch is in Layers. Cost if wrong: one constant in src/map/terrain.ts.
- Base and Crew dock tabs are left out until the simulation exists (they would be empty). Rover track content lives in Discover. Cost if wrong: two entries in src/ui/dock/tabs.ts.
