# Progress

Plan: docs/superpowers/plans/2026-11-14-areo.md. One line per task, then rulings.

- [x] 1 Skeleton, design system, store, globe entry (store, URL sync, tokens, Archivo, globe in and out; e2e globe.spec passes). Panels and dock come with their tasks.
- [x] 2 Tile package (8,355 tiles, 89.7 MB: planet z0-4, region img z5-10, core 11-13, crater 14; terrain to z14 over HiRISE; CRISM olivine/pyroxene and carbonate overlays z9-12; check_region.py passes)
- [x] 3 Other datasets and models (names, traverse, Ingenuity flights, 19 places with 48 photos, 30 samples, weather, caves, sites, geology, 5 models; validate_data.py passes)
- [ ] 4 Engines: done and tested: marsTime, environment, vehicles, metabolic, terrain, isochrone, geology, explain, router, relief, lighting (225 tests). Also done since: spaceWeather (on a real DONKI slice), grading, the map tone curve. NOT written: tripComputer, departure (blocked, see below; tests parked as tripComputer.test.ts.pending), export, validate, missions, alerts.
- [ ] 5 Real protocol, places, search, place card: protocol (package, ancestor upsample, live Viking/CTX/HiRISE detail), DEM grids, search, place card, clock chip done. Left: e2e tests from the plan, check against the final tile package, Rover View button.
- [ ] 6 Router wiring, route card, mission editor: planner panel (vehicle, start, stops with drag reorder, tasks with minutes, undo, round trip, pick on map), routing per leg in 3 styles with stale-run dropping (unit tested), route and pins on the map, alternatives. Left: budget tiles, timing card, profile strip, briefing (all need tripComputer), templates from missions, click-the-route-to-add-a-stop, draggable pins, e2e tests.
- [ ] 7 Simulation, alerts, base, run panel
- [ ] 8 Visor and Rover View: DONE: three ground layers with shader holes and per-variant program keys, eye-level grading, near ground detail shader (sand, ripples, grains, bedded and jointed rock), instanced rocks (stable hash, slope weighted), sky with sun disc, blue sunset aureole and stars, sun shadows, first-person walking, Rover View screen (compass tape, readout, time presets, WebGL failure message), quality tiers. Also done: NASA models on the ground (Perseverance at its last waypoint, Ingenuity at rest, habitat, SEV and two standing Z-2 suits at a mission's start; vehicles seated on their wheels; captions say what is a model), rocks rebuilt (welded, pitted, two levels of detail: 4.6M to 1.5M triangles a frame), layer edges blended (no sky gap), touch pad, phone layout, e2e. LEFT: the Z2 suit rig and walk, moving crews and vehicles, chase and orbit cameras, route guides, mission HUD (O2, power, dose, alerts, chat, mini map), contact shadows, dust motes, moons, photo cards near Perseverance stops, Ingenuity rotor re-pivot (only needed when it flies).
- [ ] 9 Map look, layers, Discover, flyover: DONE: relief curve with chip, sun lighting, labels (DOM markers, decluttered), Perseverance track, overlays (geology with legend, CRISM olivine and carbonate, slope by vehicle), Layers, Discover (follow Perseverance by sol with live raw photos, places, samples), Missions (4 templates), How it works. Phone layout done (bottom bar, one sheet with peek, half and full, labels kept whole). Flyover done (button on the route card, bar with the next stop, e2e). LEFT: one-time tilt at zoom 10, walking range rings, validation against Perseverance.
- [ ] 10 Space weather, exports, validation: DONE: api/spaceweather.ts, api/weather.ts (trimmed to the newest sols), clock-menu block, dot, one toast per visit, measured weather in the place card. LEFT: exports, validation, the CME warning on a route (needs the budget).
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
- E2E (Playwright, 12 tests, all pass): globe in and out on one canvas; marker and off-region click; search to
  Cheyava Falls card with photo; typed coordinates; pointer readout; far side imagery at zoom 5; offline ground at
  zoom 12; layers panel by keyboard; two-leg mission routes; mission editor (tasks, keyboard reorder, undo, pick on
  map); out-of-region stop explains itself; Rover View (ground, walk, quality, clock restored).
- Space weather in the browser falls back to NASA's CCMC server (ccmc.gsfc.nasa.gov/DONKI/WS/get, CORS open, no key) and not to api.nasa.gov with DEMO_KEY as the spec says: no key of any kind in the bundle, and no 10-an-hour limit. The function tries api.nasa.gov with the key first, then CCMC per feed (api.nasa.gov answered 404 for FLR on 2026-11-14). Cost if wrong: two URLs.
- Particle events: DONKI listed none with a Mars instrument in 2024 or 2026 slices, so the "particles at Mars" branch is tested on a real entry with its instrument renamed, and the UI says when events were seen near Earth only.
- api/weather.ts answers the newest three sols in the app's own shape, not the raw feed (Curiosity's is every sol since 2012). Cost if wrong: one function.
- The map is lit as at mid-morning by default and the base image gets a tone curve by zoom (src/map/protocol/tone.ts); the real sun lights it when Follow the real sun is on in Layers or the clock is not live (an hour was picked). The spec has the map follow the sun always; at dawn and at night Jezero's dark floor could not be read. Cost if wrong: the default in src/store/index.ts.
- The Z-2 suits stand in the model's own pose; the rig and walk wait for moving crews (simulation). Cost if wrong: none until crews move.
- Phone: one sheet at a time (a place over a panel over the plan), a five-item bottom bar, no zoom buttons (pinch). Cost if wrong: src/ui/shell/PhoneChrome.tsx.
- E2E now 18 tests (the flyover is the 18th): the 12 above plus space weather (storm due; quiet and dead service), Rover View beside Perseverance, and two phone tests (sheets and bar; picking a point lowers the sheet).
- Cleanup review (4 reviewers, 2026-11-14) applied except: the ground-layer blend still reads the coarser DEM, not the coarser patch's drawn mesh (order of building would matter; the sink covers the difference); `VisorHandle.stats()` and `cmesDuring` have no caller yet and stay (the first for the GPU check still owed, the second for the route warning once the budget exists); DockRail and the phone bar keep separate button markup; PhoneChrome still measures the top bar and the bottom bar.
- Still owed: the final whole-branch review by a fresh reviewer, a visor frame-rate check on a real phone, merging Perseverance's 119 draw calls in tools/build_models.py.
