# Progress

## Start here (handoff written 2026-11-14, end of the second session)

State: branch `main`, ahead of `origin/main` and not pushed (the team pushes, or asks for it). Working tree clean.
`npx tsc --noEmit -p tsconfig.json`, `npx eslint .`, `npx vitest run` (423 tests) and `npx playwright test --trace off`
(24 tests) all pass. `npm run build` passes: first load 386 kB gzipped, the NASA key is not in `dist`.

Read, in this order: this section, `docs/superpowers/specs/2026-11-14-areo-design.md` (what the team asked for),
`docs/build-spec.md` (the spec), the rulings at the end of this file.

The final whole-branch review is done (a fresh Opus reviewer over `2db0bf6..HEAD`): no Critical finding, no
security finding. Its three Important and seven Minor findings are fixed, each Important one with a test
(commit "Fix what the final review found"). Do not run it again unless the code has moved on.

Open, most important first:
1. Deploy: push `main`, import the GitHub repository in Vercel (settings come from `vercel.json`), optionally set
   `NASA_API_KEY`. The functions were bundled and run on their own here; Vercel's own build has not been run.
2. Not checked against the spec's own number: in Discover, "Check the planner against Perseverance", the leg from
   the delta top to the rim by Neretva Vallis should come out near 100 m and 87% within 300 m. Run it and compare.
3. Not tried on a real phone (only a phone-sized browser with a real GPU), nor in Firefox or Safari. The reviewer
   could not judge: whether printing the cuff card from the hidden frame works in Firefox and Safari; whether the
   phone run panel overlaps an open sheet.
4. Left by the reviewer as questions, not defects: a hidden tab advances the mission by at most a second per tick,
   so it pauses in effect and does not catch up; a dust devil scheduled before a reroute keeps its place on the
   old path and may fire off the new one; the Mars clock menu stays usable during a mission ("Now" shows real
   time until the next tick).
5. Rough edges seen and left: in the chase camera the guide chevrons are hidden behind the party on a straight
   path; the open rover is drawn with the pressurised rover's model; Ingenuity's rotor does not turn.
6. Not built, named in the README: a base console in a second tab (`src/sim/sync.ts` has the channel), sound
   effects, moons and dust motes in 3D, photo cards beside the rover's stops in 3D, a limit for cold.

How to work here: dev server `npm run dev -- --port 5173 --strictPort` from a shell (restart it after adding a
new folder under `src/ui`, or Tailwind misses the new classes); screenshots with a Playwright script using
`--use-angle=metal`; commits in plain sentences with no co-author trailer; English everywhere in the project.
The model that wrote most of this stopped on the trip-budget content; Opus subagents wrote `tripComputer.ts`,
`departure.ts`, `export.ts`, `validate.ts`, `missions.ts`, `alerts.ts` and `src/sim/*` without trouble.

## Third session (2026-11-14, evening): realism pass

The team asked for Rover View, the models and the map to look like NASA's own 3D work, and for the data to
be live wherever it changes. Done:
- `/api/hirise` (Node function, region pdx1 in vercel.json) cuts 512 px tiles from USGS's Mars 2020 HiRISE
  mosaics of Jezero (25 cm ortho, 1 m DTM) by HTTP ranges; cached for a year. The dev server keeps immutable
  API answers on disk under `tools/.cache/api`. Cold tiles take about 5 s from Turkey; on Vercel next to S3
  they should take well under one.
- Rover View: a fourth ground layer (`close`, 256 m, 0.5 m triangles, HiRISE 1 m model and 25 cm image); the
  near layer uses HiRISE at 4 m and 2 m. Both open on the package and are rebuilt with HiRISE when its tiles
  arrive. Close-up grain from three CC0 ambientCG materials (`tools/build_ground_textures.py`). Rock density
  follows HiRISE roughness. N8AO ambient occlusion, SMAA, a PMREM sky environment map, a colour grade toward
  Mastcam-Z. Mouse wheel lifts the eye to 150 m. n8ao imports `postprocessing`, which does not accept three
  0.187: it is aliased to `src/lib/shims/postprocessing.ts`.
- Models: Perseverance and the SEV rebuilt at full detail with named parts kept (the SEV's texture had been
  torn by simplifying); wheels are cut out on load (`src/visor/wheels.ts`) and roll with distance. The Z-2
  crew walk with two-bone IK and planted boots; standing crew breathe and look about.
- Map: HiRISE detail over Jezero from zoom 15, HiRISE terrain to zoom 16, max zoom 19, relief at true scale
  past 16.5. The map's terrain is lifted 2.6 km (`MAP_DATUM_LIFT_M`): with Jezero 2.5 km below the datum the
  globe camera drew nothing when close in and tilted.
- Live track: `/api/traverse` (MMGIS, six-hour cache); the bundled copy is the fallback.
- README has a table of what is live and what is shipped, and why.

Open from this session: the near layer's image is 2 m (HiRISE level 3) to keep cold loads short; at drone height
it looks soft beyond 128 m. Rocks are still drawn in, not placed from HiRISE boulders. The Ingenuity rotor still
does not turn.

## Ledger

Plan: docs/superpowers/plans/2026-11-14-areo.md. One line per task, then rulings.

- [x] 1 Skeleton, design system, store, globe entry (store, URL sync, tokens, Archivo, globe in and out; e2e globe.spec passes). Panels and dock come with their tasks.
- [x] 2 Tile package (8,355 tiles, 89.7 MB: planet z0-4, region img z5-10, core 11-13, crater 14; terrain to z14 over HiRISE; CRISM olivine/pyroxene and carbonate overlays z9-12; check_region.py passes)
- [x] 3 Other datasets and models (names, traverse, Ingenuity flights, 19 places with 48 photos, 30 samples, weather, caves, sites, geology, 5 models; validate_data.py passes)
- [x] 4 Engines (all written by 2026-11-14 evening, see the last notes): done and tested: marsTime, environment, vehicles, metabolic, terrain, isochrone, geology, explain, router, relief, lighting (225 tests). Also done since: spaceWeather (on a real DONKI slice), grading, the map tone curve. NOT written: tripComputer, departure (blocked, see below; tests parked as tripComputer.test.ts.pending), export, validate, missions, alerts.
- [x] 5 Real protocol, places, search, place card: protocol (package, ancestor upsample, live Viking/CTX/HiRISE detail), DEM grids, search, place card, clock chip done. Left: e2e tests from the plan, check against the final tile package, Rover View button.
- [x] 6 Router wiring, route card, mission editor: planner panel (vehicle, start, stops with drag reorder, tasks with minutes, undo, round trip, pick on map), routing per leg in 3 styles with stale-run dropping (unit tested), route and pins on the map, alternatives. Left: budget tiles, timing card, profile strip, briefing (all need tripComputer), templates from missions, click-the-route-to-add-a-stop, draggable pins, e2e tests.
- [x] 7 Simulation, alerts, base, run panel (src/sim, src/ui/run; no base console in a second tab)
- [x] 8 Visor and Rover View (mission ride-along with party, cameras, guides and HUD done; moons, dust motes, photo cards not): DONE: three ground layers with shader holes and per-variant program keys, eye-level grading, near ground detail shader (sand, ripples, grains, bedded and jointed rock), instanced rocks (stable hash, slope weighted), sky with sun disc, blue sunset aureole and stars, sun shadows, first-person walking, Rover View screen (compass tape, readout, time presets, WebGL failure message), quality tiers. Also done: NASA models on the ground (Perseverance at its last waypoint, Ingenuity at rest, habitat, SEV and two standing Z-2 suits at a mission's start; vehicles seated on their wheels; captions say what is a model), rocks rebuilt (welded, pitted, two levels of detail: 4.6M to 1.5M triangles a frame), layer edges blended (no sky gap), touch pad, phone layout, e2e. LEFT: the Z2 suit rig and walk, moving crews and vehicles, chase and orbit cameras, route guides, mission HUD (O2, power, dose, alerts, chat, mini map), contact shadows, dust motes, moons, photo cards near Perseverance stops, Ingenuity rotor re-pivot (only needed when it flies).
- [x] 9 Map look, layers, Discover, flyover: DONE: relief curve with chip, sun lighting, labels (DOM markers, decluttered), Perseverance track, overlays (geology with legend, CRISM olivine and carbonate, slope by vehicle), Layers, Discover (follow Perseverance by sol with live raw photos, places, samples), Missions (4 templates), How it works. Phone layout done (bottom bar, one sheet with peek, half and full, labels kept whole). Flyover done (button on the route card, bar with the next stop, e2e). LEFT: one-time tilt at zoom 10, walking range rings, validation against Perseverance.
- [x] 10 Space weather, exports, validation: DONE: api/spaceweather.ts, api/weather.ts (trimmed to the newest sols), clock-menu block, dot, one toast per visit, measured weather in the place card. LEFT: exports, validation, the CME warning on a route (needs the budget).
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
- Bundle (2026-11-14, gzip): first load 397 kB (budget 400), chrome chunk 92 kB, 3D view 178 kB on demand. The key in .env.local is not in dist.
- 2026-11-14 evening, second session: the team asked for everything to be finished, the budget engines included, with an Opus subagent if the main model's safeguards got in the way. Done by Opus subagents (files written, not committed by them; checked and committed here): tripComputer.ts + departure.ts (33 tests), export.ts + validate.ts + missions.ts (44 tests), src/sim/* + alerts.ts (52 tests). Done in the main session: Vercel setup (vercel.json, relative imports for api/), range rings, route click to add a stop, draggable pins, one-time tilt, first-run hints, Z-2 rig, budget UI (verdict, tiles, profile, warnings, briefing, departure with automatic "next good morning", camp switch, map marks), exports UI, validation in Discover, missions from the engine, mission run (src/sim/controller.ts, run panel, alerts card with reroute preview, radio), e2e mission.spec.ts.
- LEFT at that point: helmet view of a running mission (party, cameras, guides, HUD), docs (How it works sections for budget, simulation, validation; model-notes), CME warning on the route card, ?role=base mirror view (src/sim/sync.ts exists, no UI), sound toggle UI for spoken alerts, final review, push.
- The tile package was never cut for the 100 MB limit: it has the spec's coverage at WebP quality 85 (102 MB on disk). Nothing to restore.
- Later the same evening: helmet view of a running mission done (src/visor/party.ts, guides.ts, MissionHud), the CME note on the route card, spoken alerts switch in the menu, How it works sections for the budget, range, missions and validation. E2E: mission.spec.ts (run to the end; dust devil reroute; radio; ride along).
- Ruling: a plan with no departure chosen is costed from the first morning it fits in daylight (planner/routing.ts autoDepart); the spec's "Leave at 06:16 tomorrow" button became the default with "Leave now instead" as the choice. Cost if wrong: one flag in the controller.
- Ruling: an unanswered warning with an action holds the simulation clock (src/sim/controller.ts). Cost if wrong: one condition.
- Not built, named in the README: base console in a second tab, sound effects, moons and dust motes, photo cards in 3D, a cold limit.

