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

## Ninth session (2026-11-15, afternoon): map that fills in, honest relief, a tablet in hand, a real station, phones

- Map tiles: a source tile that fails (timeout, dropped connection, 5xx) is told apart from one the service has
  none of (404/400) and retried twice (`fetchSource` in `protocol/live.ts`). A map tile made while a source failed is
  shown but not kept as finished: it stands in and is made again after 4, 12, 30, 90 s (`retries` in
  `protocol/serve.ts`). `PENDING_MAX` 192 (48 dropped the view's own tiles). The CTX mosaic has real gaps between
  its image strips; there THEMIS daytime IR (100 m) gives the texture up to z13 (`THEMIS_FILL_TO` in `img.ts`), and
  masked detail is blurred over covered pixels only, so strip edges no longer get bright rims (`detail.ts`).
- Relief: the map library draws Mars at Earth's size, so Mars metres came out at 0.53 of true height. The terrain
  is now stretched by 6371/3396 too, capped where the ground under the camera is high (45 km lifted, Olympus Mons)
  so the camera never ends up inside it; the chip shows the true factor (`terrain.ts`, `reliefLabel`).
- 2D/3D button now holds (`chooseTilt`/`flightPitch` in `tilt.ts`). A place chosen in search is flown to and
  circled at 50 degrees until the visitor touches the map (`src/map/orbit.ts`). Markers hidden by terrain are hidden,
  not shown at 20% (Jezero labels showed through the planet).
- New overlays: Rock or dust (THEMIS night IR, colour ramp) and Elevation (MOLA colour), via `mars://live/...`.
- Rover View: Jezero Station (`station()` in `baseProps.ts`, numbers in `stationPlan.ts`): a 14 m domed hub with an
  airlock at the door point, two laboratory modules and a greenhouse, joined by tunnels laid out from one set of
  sizes; props can have a `footprint` of discs (clearings, level seating). The NASA habitat stands apart. Ingenuity's
  rotor turns with a blur disc. Suit: gloves were left out of the arm's weights and stayed in front of the chest as
  bars; arms swung in phase with the same leg; both fixed, and boots follow the slope and roll without digging in.
- Walk in your own eyes (desktop): a tablet in the left hand (`Tablet.tsx`), projected from where it is held, so
  it peeks at the bottom when looking ahead and comes up in perspective when looking down; it shows the map with the
  chosen overlay. The Overlays menu sits in the corner (`OverlayMenu.tsx`). Vehicles are a list at the top right;
  Eyes/Close/Far sit above the time of day.
- An arrival from the map that was interrupted by a drag or key froze the eye where it was (100 m up); the eye now
  lands anyway.
- Place card: hero photo, summary, rock unit, primary actions, a line of quiet links, four numbers, sections with
  icons; NASA's image library moved into "About this place".
- Phones (`src/lib/device.ts`): the map draws at pixel ratio 2 (not 3) and with 256 px tiles (128 px meant four
  times the tiles), leans at most 52 degrees; Rover View starts on the light setting at 1.25x; its controls are a
  right-hand column of icons; the long captions are hidden. Walking-range rings are smoothed (`smoothField`,
  `smoothRing`). Not yet tried on a real phone.

## Eighth session (2026-11-15, noon): crew runs that flow, one Start gate, @Base, shared tasks

- Members' view of a crew run no longer jumps once a second (at 100x it teleported: >60 m a snapshot). The
  commander's snapshot carries `ticking` (`clockTicking` in `src/sim/controller.ts`: paused, over, routing, a
  proposal, or a warning awaiting a decision); a pause, speed or hold change is published at once and no change is
  dropped (250 ms interval). Members run their own clock at 10 Hz (`src/net/smoothClock.ts`, never backward, snaps
  only on large gaps). The 3D party and the map marker read `createSmoothTime()` (`src/sim/smoothTime.ts`), which
  carries the clock between ticks every frame. Measured on the real GPU (`tools/.cache/shots/crew-smooth.mjs`,
  `crew-ride.mjs`): member clock changes 10 times a second at 1x/20x/100x, 60 fps riding along, no jumps.
- Walking file: followers stand exactly on the leader's trail at their gap (`alongTrail` in `src/visor/party.ts`);
  before, they lagged ~v/8 and fell behind the chase camera at 100x.
- A commander's hidden tab makes up missed time in one-second steps (up to 90 s per timer call), stopping at a
  decision.
- One Start gate: `startProblem` (`src/planner/startCheck.ts`) for the planner, the crew room and
  `startMission()` itself; the server refuses more crewed rovers than joined crew (`crewedVehicles`). The plan's
  head count follows the roster globally (`useCurrentMission`), not only while the fleet picker is mounted (that
  was how three rovers left with one person).
- Point of no return after a reroute: `TripOptions.homeAt` ('end' when the new leg ends at home, 'none' for a
  one-way leg) and `startSuitS`. Before, a rerouted leg counted "home" as where the reroute began, so a crew walking
  home got a bogus "point of no return soon".
- Radio: on a crew mission the base answers only calls with `@Base` (`baseQuestion` in `src/net/words.ts`; an
  @Base toggle in the radio). Base replies come 3-6 s of real time later at any speed (capped at 120 s of mission
  time), and while the clock stands still they come after 3 s (`answerPending`).
- Task assignment: Everyone, or several people (`assignments` values `'all' | Id<'crew'>[]`, a lone id still read;
  helpers in `convex/shared.ts`).
- Route chevrons on the plan, the mission route and a proposed route (`src/map/layers/arrows.ts`), from zoom 11.
- Escape in a menu opened from a dock panel no longer closes the panel. A run that ended but whose commander closed
  the tab before filing is closed as it ended after a minute (`runEnd` in the sweep), not as "link lost".
- Dev: `.env.local` now points at the cloud dev deployment `nautical-otter-98`; a prod deployment exists
  (`elegant-albatross-616`) and needs `npx convex deploy` for this session's schema and function changes.

## Seventh session (2026-11-15, night): one shared base, fleets, named stops

- One base for everyone (`convex/base.ts`, table `bases`, one row `key: 'main'`; `src/net/base.ts` keeps the
  store in step). Moving it is asked and confirmed (`moveBaseTo` → `BaseMoveDialog`), refused while a local run
  is out or any crew mission is `underway` (server). No crew server: the browser keeps its own, as before.
- The base is a place (`placeId: 'base'`, built in `PlaceCard`): its pin, the Home row and links open it. Moving
  the base lives in its card's "More" menu (and "Move the base here…" on any spot's card); the planner's base row
  only flies to it.
- Fleets (`src/engines/fleet.ts`): `MissionPlan.fleet` and `people`; `plan.vehicle` is kept as the pace vehicle
  (walkers if anyone lacks a seat, else the open rover, else the cabin; robots only when nobody goes), so the
  router, trip, sim and Rover View still read one vehicle. `TripOptions.people` scales the air. Rovers without a
  driver, or a mission with nobody and nothing, block Start. Each vehicle has an (i) card (`vehicleFacts`). Links
  carry `fleet=openRover1.heli1&ppl=3`. A crew mission's head count follows its roster (commander's plan).
- Stops are named as they are added: the plan opens on the new stop with its name field focused (Enter keeps
  it; empty shows coordinates). Pencil renames. Names travel in links even for known places.
- A failed leg's fix button moves the point that is at fault (`RouteState.point`); before, it always moved the
  leg's end stop, so a blocked start "did nothing".
- Place card: "Add to the route", Rover View, and a More menu (zoom, link, base). Route: Start, "Fly over", More
  (cuff card, GPX, GeoJSON). Solo crew section is one row with "Bring a crew".
- Side panels narrow below 1536 px (left 328/352/372, dock 316/332/344) so a 13-inch screen keeps a map.
- Performance pass (measured on the real GPU, 1470x920 at DPR 2; scripts `tools/.cache/shots/perf2.mjs`,
  `memsplit.mjs`): Rover View now holds 60 fps walking, driving and riding at 1x/5x/100x (was 25-31 fps with
  long tasks up to 0.8 s), and the map 59 fps zooming z12-z17 (was 36). Rover View drops ambient occlusion and
  SMAA (no visible loss, ~10 ms a frame), adapts its pixel ratio 1-1.5x, uploads a new patch's textures one a
  frame, grades orbital imagery in the shader (no canvas readback), keeps HiRISE as two-byte textures, compact
  vertex data and shared index buffers. The map composes tiles in two workers (`protocol/pool.ts`,
  `serve.ts`, `tile.worker.ts`) with byte-capped caches, answers slow tiles with a stand-in at once and refreshes
  them when ready, and shrinks to 1 px while Rover View is open. Tab memory in Rover View 1.2-1.5 GB (was
  2.2-2.5 GB); the ~700 MB goal is not met. Replay writes the store at 4 Hz, not every frame.
- Poles: imagery blends to an ice colour and heights level between 81.5 and 84.9 degrees, so the globe shows a
  clean cap instead of a fan of stretched pixels (`protocol/tone.ts`, `protocol/dem.ts`).
- Rover View minimap (`src/ui/visor/Minimap.tsx`): north-up, from the shipped z14 tiles, the viewer's arrow,
  the route ahead, the base, a scale; a click returns to the map there.
- Known: in SwiftShader (headless e2e) every map frame costs 200-600 ms, so some timing-sensitive e2e tests can
  fail under load; on the GPU the same flows have no task over 100 ms. `mergeAlternatives` (~200 ms) still runs
  on the main thread after each plan edit.

## Sixth session (2026-11-15, later): mission panel, map that explains itself, Rover View playground

- Desktop runs live in the left column (`src/ui/run/MissionPanel.tsx`): status, the alert card (`AlertCard` in
  `Alerts.tsx`, also floating over Rover View and on phones), supplies, crew and vehicle, stops with tasks and
  ETAs, controls, ride-along and radio. Phones keep `RunPanel` at the bottom. Plan edits are refused while a run
  is `running` (`editPlan` in the store); templates and place-card plan actions are disabled then.
- The planner sums the mission up before Start (`ReadySummary`). The Crew tab shows a solo run as such.
- Map lines explain themselves on hover and act on click (`src/map/hoverInfo.ts`).
- Map tilt follows zoom (`pitchForZoom` in `src/map/tilt.ts`) until the visitor tilts it; retina screens load
  tiles one level finer (`tileSize: 128` in `src/map/style.ts`).
- Rover View on your own: walk in your eyes or as a figure, or drive the SEV, the open rover, Perseverance or
  Ingenuity (`setRoam` in `src/visor/index.ts`, `RoamBar.tsx`); camera Eyes, Close, Far, wheel for distance.
  Rover View rides along only from Ride along (`VisorAt.ride`).
- Ground: rust grade, pale slabs and veins, dark drifts (`groundPatches` in `groundShader.ts`); HiRISE relief
  cutoff 6 m. Base: two habitat modules joined by a drawn tunnel (replaced by Jezero Station in the ninth session).
- A bug hunt (subagent) found 14 issues; fixed: reroute at a stop, verdict from `run.missionId`, leaving an
  underway crew mission, commander finish race, ride-along entry, links (`m=` template id, drone stations kept),
  Belva helipad, solo partners in 3D, base move after a run, flyover drag.
  Fixed later the same day: reroutes are costed from the crew's remaining O2 and battery (`startO2Kg`,
  `startBatteryKWh` in TripOptions) and the proposal warns when they will not last; a "leave now" plan is costed
  again every 15 minutes of clock; a WebGL context loss in Rover View keeps the clock the visitor picked.
- Map close up: a `hirise-hd` layer (`mars://hd`, `hdTile` in `protocol/img.ts`) draws the USGS 25 cm mosaic over
  the base from zoom 15 and fades in as it arrives. Hillshade highlight is faint and fades past zoom 14; contrast
  and brightness floor are zoom-dependent; the tone curve is a shadow lift, not a gamma; detail gain is bounded.
- Landing: the flight in comes down over the delta and the rim at zoom 13.3, tilted (`LANDING_VIEW` in
  `src/map/camera.ts`), and warms the landing's tiles during the flight (`src/map/warm.ts`). A mission start brings
  the camera to the crew and warms the first stretch of the route (`addRunFocus`). Live source tiles wait in a pool
  per source, newest first, and a request no tile wants any more is dropped (`sourceTile` in `protocol/live.ts`):
  before, tiles asked for during the flight held every slot and the landing stayed blank for many seconds.
  Base tiles get a light unsharp mask from zoom 11 (`protocol/tone.ts`); the 25 cm layer starts at zoom 14.
- Perseverance's drive replay: Discover, "Ride the drive from sol N" / "Ride the whole drive" (`VisorAt.replaySol`,
  `src/ui/visor/replayFeed.ts`, `ReplayBar.tsx`). Any moving view prefetches the ground ahead
  (`src/visor/prefetch.ts`): coarse layers always, the 25 cm ground only below 20x.

## Fifth session (2026-11-15): bases, one place to plan, the whole planet in search

Design: `docs/superpowers/specs/2026-11-15-bases-panels-search-design.md`.
- Dust devils keep 120 m clear of every stop, the base and the route's ends (`clearDevilNear` in `src/sim/events.ts`);
  a reroute drops older zones over the crew or a place it must reach. Before, the default mission's devil covered
  Witch Hazel Hill and Route around it always failed.
- Base (`src/planner/base.ts`, `store.base`, localStorage `areo.base.v1`): default Jezero Station at 77.44 E,
  18.428 N (the most level ground near the landing site). Every plan starts at the base with round trip on;
  templates and shared links are rebased. Moved by picking (`picking: 'base'`, `src/planner/moveBase.ts`): inside
  the region, slope under 8 degrees, not during a run. Map badge `src/map/layers/base.ts`; Rover View draws the
  habitat, SEV (left out while a run drives it), and drawn solar array, mast and pad (`src/visor/baseProps.ts`).
- Left column when idle is `src/ui/planner/Home.tsx` (base, Plan a mission, your mission, missions to join).
  The planner has a Crew section (`src/ui/crew/PlannerCrew.tsx`); the Crew tab is the current mission, or "You are
  not on a mission" plus `JoinList`. Start is disabled while the trip is not feasible.
- Search loads `public/data/mars-names.json` (1,929 IAU names, built by `tools/build_names.py`) once typing starts.
  `public/data` is not watched by Vite: restart the dev server after adding a file there.
- Place cards show pictures live from images-api.nasa.gov (`src/data/nasaImages.ts`).

## Fourth session (2026-11-14, night): crew missions, relief, descent

The team asked for: crews that are really chosen (missions, invites, roles, tasks, notes, a debrief; other
people online; androids as virtual crew), ground that is not flat where the data is coarse, the rover wheel
that turned with its strut, a blackout in Rover View, and zooming from the map into 3D.
- Backend: Convex (`convex/`), anonymous local deployment for now (`npx convex dev` beside Vite; it writes
  `VITE_CONVEX_URL` to `.env.local`). No login: each browser keeps a clientId and a secret (hash on the server).
  Before deploying, the team logs in to Convex and creates a cloud deployment; set `VITE_CONVEX_URL` in Vercel.
- `src/visor/relief.ts`: relief the data cannot hold, cut off at the resolution of the data under each point
  (HiRISE 1 m: only the last metres; 200 m DEM: everything below ~600 m): rolling ground (Hurst ~0.8), ridged
  knobs, ledged rock benches, transverse aeolian ridges in low ground, three size classes of craters with rims,
  ejecta and sand fill. A `soil` attribute (sand, rock) drives the ground shader and rock density. Rocks gather
  in clusters and lean on the slope. Pure function of planet position: same crater on every visit.
- Wheels: cut by whole connected parts inside a wheel's cylinder (struts and fenders stay), axle recentred on
  the tyre (the SEV's guessed hub was 12 cm off and its radius is 0.38 m, not 0.5).
- Blackout: not reproduced in a 40 s ride at 20x/100x. Hardened: contexts are released on close
  (`forceContextLoss`; browsers keep ~16 and reopening Rover View could take the map's), a lost context that
  is not restored in 1.8 s rebuilds the view on a fresh canvas, the camera falls back from non-finite numbers,
  and the close layer is not rebuilt at 5x and faster.
- Map to 3D: past zoom 18.85 a push of the wheel (or "Go now", or the phone's button) opens Rover View from the
  map camera's height and heading and eases down; scrolling out past 150 m returns to the map (`src/map/descend.ts`).
- 3D crew from the mission roster (`store.roster`): people in white suits with their colour on arm and thigh
  bands, androids in graphite plating with a lit visor band, name tags; the helmet camera is the visitor's
  own member. The two stray suits at a mission's start are gone. Other people with Rover View open walk where
  they are (`store.walkers`, `src/visor/walkers.ts`).
- The real blackout: when quality dropped to low (slow frames, or a mission at 5x+), N8AO was switched off,
  and N8AO is the pass that draws the scene into the composer: every frame after that was black. Now the scene
  is drawn plainly whenever AO is off. Pixel ratio is capped at 1.5.
- Crew client (`src/net/`, `src/ui/crew/`): identity, presence, Crew dock tab (you, invites, your mission, open
  missions, online now, past missions), mission room (departure, roster with roles and walking order,
  androids, task assignment, pre-EVA checklist, start), run sync (commander publishes the world about once a
  second, the route only when it changes; members mirror it read-only and talk on the radio), private notes,
  debrief (planned vs actual, tasks, timeline, crew log). Two-browser run: `tools/.cache/shots/crew-two.mjs`.
- A Convex cron closes missions whose commander vanished (run silent 10 min, plan untouched 12 h, commander away).
- Dev now needs two processes: `npm run dev -- --port 5173 --strictPort` and `npx convex dev`.

Open from this session: the bundle's first load measures 422 kB gzip counted as everything index.html loads
(HEAD measured the same way: 421 kB), so the 400 kB budget was counted differently before; the crew code is lazy.
Sol numbers in the crew UI are Mars Sol Dates (54343), as the rest of the app's clock.

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

Later the same evening, after the team saw Rover View stuck on "Building the ground…": on a high-density
screen n8ao's half-resolution mode threw every frame before the view could say it was ready, and the browser
reported each throw to the dev server, which pegged it. Half resolution is off, a failing composer falls back to
a plain render, and the map no longer asks /api/hirise at all (Esri's tiled HiRISE and the package terrain).
Rover View's near image comes from Esri too; only the close patch and the near model read USGS, three requests
at a time, nearest first. Test with `deviceScaleFactor: 2`. Tone mapping is ACES at exposure 0.78.

Open from this session: the near layer's image is Esri's (about 1.3 m) to keep cold loads short; at drone height
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

