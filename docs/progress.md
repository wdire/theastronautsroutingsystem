# Progress

Plan: docs/superpowers/plans/2026-11-14-areo.md. One line per task, then rulings.

- [x] 1 Skeleton, design system, store, globe entry (store, URL sync, tokens, Archivo, globe in and out; e2e globe.spec passes). Panels and dock come with their tasks.
- [x] 2 Tile package (8,355 tiles, 89.7 MB: planet z0-4, region img z5-10, core 11-13, crater 14; terrain to z14 over HiRISE; CRISM olivine/pyroxene and carbonate overlays z9-12; check_region.py passes)
- [x] 3 Other datasets and models (names, traverse, Ingenuity flights, 19 places with 48 photos, 30 samples, weather, caves, sites, geology, 5 models; validate_data.py passes)
- [ ] 4 Engines: done and tested: marsTime, environment, vehicles, metabolic, terrain, isochrone, geology, explain, router, relief, lighting (225 tests). NOT written: tripComputer, departure (blocked, see below; tests parked as tripComputer.test.ts.pending), spaceWeather, export, validate, missions, grading, alerts.
- [ ] 5 Real protocol, places, search, place card: protocol (package, ancestor upsample, live Viking/CTX/HiRISE detail), DEM grids, search, place card, clock chip done. Left: e2e tests from the plan, check against the final tile package, Rover View button.
- [ ] 6 Router wiring, route card, mission editor: planner panel (vehicle, start, stops with drag reorder, tasks with minutes, undo, round trip, pick on map), routing per leg in 3 styles with stale-run dropping (unit tested), route and pins on the map, alternatives. Left: budget tiles, timing card, profile strip, briefing (all need tripComputer), templates from missions, click-the-route-to-add-a-stop, draggable pins, e2e tests.
- [ ] 7 Simulation, alerts, base, run panel
- [ ] 8 Visor and Rover View
- [ ] 9 Map look, layers, Discover, flyover
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
