# Areo: design

Date: 2026-11-14 (day 1 of NASA Space Apps 2026). Team: Works On My Planet.
Challenge: Interplanetary Survival Guide: Martian Map.

This document sits on top of `docs/build-spec.md` (the build spec, saved verbatim). The build spec says what
the app contains, value by value. This document says why, what matters most, and where the build departs from
the spec. Where the two disagree, this document wins; where this one is silent, the build spec stands.

## Intent

A Mars astronaut's map for a day of field science in and around Jezero crater. They pick places, attach
science tasks, get a route they can survive (oxygen, power, radiation, dust, daylight), then run it: the map
follows them, a base talks to them, warnings arrive before the problem does. A helmet view shows the same
mission from eye level on real terrain.

Nobody is on Mars, so the running part is a simulation. It has to feel like the real thing: data arrives,
the app decides, the crew is told.

Who uses it: hackathon judges and anyone curious, most of whom are not scientists. First use needs no
technical knowledge. The science (measurements, models, sources) is one click deeper, never in the way.

## What the team asked for (theirs)

- Multi-stop science missions: several places, tasks at each and along the way, then onward or home. Adding,
  removing, changing and reordering stops and tasks must be easy. A mission of 8 stops and 14 tasks is normal.
- Start runs it: the position moves along the route by itself, at 1x, 5x, 20x, 100x.
- A good tool for exploring Mars apart from routes. "Where did Perseverance drive?" and "what do we know about
  this spot?" should be easy to answer. A short summary first, then items that open one by one, in the manner
  of a place sheet in a consumer map app: photos, a few lines, then detail.
- Simple by default, detail on request, so it suits both a scientist and a non-scientist.
- A 3D helmet view, optional once a mission is running: realistic terrain with relief and texture (NASA's
  Experience Curiosity is the reference for the ground), with route, next objective, where we are, and what is
  coming up drawn as a visor HUD.
- Warnings in both views. Colour and prominence follow severity. Example: a dust devil appears on the route,
  the app proposes a new route, the crew applies it, the change is announced.
- It must look and behave like a finished product: settled typography, no generic AI look, no visual or
  behaviour bugs, tested by the builder. 3D at production quality and optimised. Desktop first, phone very good.
- The build spec is a guide and not a ceiling. Technology may change; shadcn/ui and Tailwind are welcome.
- Commits read as written by a person, with no co-author trailer.

## Goals

1. A first-time visitor plans a two-stop walk and starts it in under two minutes without reading help.
2. Every number on screen is either real NASA data with a source, or labelled as modelled.
3. The mission run is believable: time, consumables, events and base replies hang together.
4. The helmet view looks like Mars from a rover camera, and holds 60 fps on a laptop and 30 fps on a phone.
5. The challenge's own asks are visibly met: at least three kinds of data layered (optical, thermal,
   topographic, atmospheric, radiation, geologic are all in the spec), safety first, suit mobility in the
   route, rover point-of-view photos at destinations, space weather.

## Non-goals

Accounts, a database or any server state. Routing outside the region. Real telemetry. A native app or VR.
Languages other than English in the UI.

## Anti-goals (failure even if it works)

- A first screen full of jargon or controls.
- Invented data that is not labelled.
- The generic look: purple gradients, glass cards on everything, emoji, a default font left as it came.
- A flat, plasticky or maroon 3D ground.
- Anything shipped half working. A feature that cannot be finished is left out and named in the README.

## Constraints

- All code is written during the event, from an empty repository. The README discloses AI use and that a
  pre-event prototype informed the build spec.
- Deadline: the end of the hackathon on 2026-11-15. Each phase ends deployable, so there is always something
  to submit.
- Deploys to Vercel as a static site plus two edge functions. No TLS verification is ever disabled.
- Data hosts were probed on 2026-11-14 and answer: Mars Trek WMTS, Esri OnMars CTX, USGS planetarymaps (302 to
  S3), JPL MMGIS, mars.nasa.gov feeds, PDS Geosciences, the Trek geology layer, the Gazetteer, NASA 3D
  Resources, DONKI ENLIL.

## Approaches considered

**A. The build spec's stack as written** (Vite, React 18, hand-written CSS). Lowest risk for the engines and
map. But every panel's styling is then written from nothing, which is where the "does it feel finished"
budget goes, and the team asked for shadcn.

**B. Vite single-page app, with Tailwind 4 and shadcn/ui as the design system** (picked). The spec's
engines, map, simulation and visor are kept as designed. The UI layer is built on Radix primitives through
shadcn, so focus handling, keyboard use, sheets and menus are right from the start, and the look comes from
one set of tokens. React 19, because current shadcn and Tailwind 4 target it and nothing else in the stack
depends on the React version.

**C. Next.js App Router with shadcn.** Rejected. The app is one full-screen WebGL page with workers and a
custom tile protocol. There is nothing to render on a server, and the two edge functions deploy from `api/`
without Next.

For 3D: plain three.js in its own imperative module, lazy-loaded, as the spec has it. A React renderer for
three was considered and dropped: the visor owns a frame loop, custom shaders and quality tiers, and gains
nothing from reconciliation. Tilting the MapLibre map was considered as the "3D view" and dropped: it cannot
give eye-level ground, rocks, a sky or a suit.

The team handed the how to the builder; B is the builder's pick.

## Decided

Stack: Vite 8, React 19, TypeScript 6.0 strict (typescript-eslint does not yet accept 7), Tailwind 4,
shadcn/ui, Zustand 5, MapLibre GL 6, three 0.187, Vitest 5, Playwright 1.65. Python 3.14 in a venv (numpy,
Pillow, shapely) for `tools/`. Everything else follows the build spec.

### Departures from the build spec

1. **Two levels on every card.** A card opens with one plain sentence and at most four numbers. A "Details"
   control opens the measurements, the model behind them and the source. Which sections a person opened is
   remembered for that visit. No global "expert mode".
2. **The mission editor is the centre of planning.** Stops in a list that drags to reorder. Each stop has
   tasks (sample, photo, measure, survey, or a named custom task) with editable durations. A click on the
   route line adds a stop there, so "along the way" tasks need no detour. Totals (time, oxygen margin, return
   by sunset) update as the list changes. Removing a stop offers undo. The four scenario missions from the
   spec load as editable templates.
3. **One alert model for map and helmet.** Four severities: note, advisory, caution, warning. Each has one
   colour, one icon, one sound and one placement rule, the same in both views; a warning takes the centre and
   needs an answer, a note sits in the feed. Alerts come from two places: events (dust devil, storm, particle
   event, low battery) and look-ahead along the route (steep ground in 300 m, point of no return in 10
   minutes, sunset in 40, oxygen at reserve). An alert that proposes a route change shows the change on the
   map before it is applied, and confirms it after.
4. **Discover answers plain questions.** "Follow Perseverance" as a timeline by sol with its photos and the
   drive drawn as it goes. "What is here?" on any click: nearest named feature, the rock unit in plain words,
   rover visits, samples taken nearby. The Mars 2020 sample cores (name, sol, rock type) are added as places,
   from NASA's published sample list, with a source entry.
5. **A spectral layer if a public product is reachable.** The challenge names spectral and chemical data.
   CRISM mineral maps over Jezero (olivine, carbonate) are the reason the site was chosen. If a downloadable
   or tiled product answers during phase 2 it becomes an overlay with a plain-words legend; if not, it is
   skipped and the README says so.
6. **First run.** Three dismissible hints after the landing (pick a place, plan, start). Every empty panel
   says what to do next.
7. **The design system is built in phase 1**, before any panel, so nothing is restyled later.
8. **Preview deploys from phase 1**, so each phase is checked on the real host and on a real phone GPU.

### Look and feel (builder's call, refined with the design skills at build time)

A field instrument. Quiet panels over a loud planet.

- Panels: warm near-black, nearly opaque, hairline borders, small radius, no glow. A light theme exists.
- Colour: one cool accent for selection and the primary action, chosen to stand against ochre ground. Green,
  amber and red are reserved for state and severity and used nowhere else.
- Type: one self-hosted variable sans for the interface and a mono for figures, tabular numerals everywhere
  a number changes. The pair is chosen at build time by comparing candidates on real panels, not by default.
- Motion: 150 to 250 ms, ease-out, on panels and sheets; eased camera flights; none on first paint of a panel;
  `prefers-reduced-motion` respected.
- Helmet HUD: its own language. Thin strokes, one tint plus the severity colours, backing behind text so it
  reads over bright ground.
- Phone: bottom sheets with peek, half and full stops; 44 px targets; an on-screen pad in Rover View.

### Budgets

- First load without the visor under 400 kB of JavaScript gzipped; three.js and the visor load on demand.
- Map usable within 3 s on a normal connection.
- Visor: 60 fps on a laptop GPU, 30 fps on a recent phone, held by the spec's automatic quality tiers.
- WCAG AA contrast in panels; every panel reachable and operable by keyboard.

## Verification

After each phase: tsc, eslint, vitest, the phase's Playwright checks, then screenshots at 1440 x 900 and
390 x 844 that the builder actually looks at. The visor is also checked in a browser with a real GPU, since
software rendering hides performance and some shader behaviour.

## Known risks (from the 2026-11-14 probes)

- The Vercel CLI on this machine has an expired token. Deploys wait on `vercel login`; until then checks run
  locally.
- Esri's OnMars HiRISE service answers but is a sparse, uncontrolled mosaic. Mars Trek also serves the
  controlled 25 cm HiRISE mosaic of Jezero (`JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`).
  Inside the crater the Trek mosaic is preferred for live detail from zoom 14; OnMars covers elsewhere. Where
  neither has an image the view stays on CTX and the layer list says so.
- A Mars Trek search for Jezero returns no CRISM product, so the spectral layer (departure 5) depends on
  finding one elsewhere (PDS, USGS). It gets one hour in phase 2 and is dropped if nothing usable turns up.
- DONKI answered 200 for ENLIL and 404 for flares with DEMO_KEY. Each feed fails on its own; the summary is
  built from what arrived and says what is missing.
- The MEDA weather feed has been stale since 2024. It is shown with its date as a snapshot.
- The tile package is thousands of small files. The count is checked against Vercel's per-deployment file
  limit before the first deploy; if over, the deepest zoom over the widest area is cut first.

## Left to the builder

File layout inside the spec's directories, component breakdown, exact tokens and copy, which subagents build
which engine, and any improvement in the spirit of the above that does not remove something listed here.

## Calls made after an independent read of this document (builder's, open to correction)

- **Mission shape.** One vehicle for the whole mission. "8 stops, 14 tasks" was the team's example of
  scale, not a promise that it fits a walk: at the spec's task lengths that is about eight hours of work
  before any travel. The natural fit is the pressurised rover with overnight camps, which the spec already
  models. On foot or in the open rover the editor shows that it does not fit, says which limit is hit
  (oxygen, scrubbers, daylight) and offers the vehicle that would work. Multi-sol missions exist only for the
  pressurised rover.
- **Nothing is copied from the pre-event prototype**, neither code nor generated data, and it is not read
  as reference. The tile package, photos and fixtures are produced again by the tools written during the
  event. The data tools are therefore written first and left downloading in the background while the app is
  built against whatever has arrived.
- **"Follow Perseverance" photos.** Named places carry bundled frames, as in the spec. For any other sol the
  browser asks NASA's raw-images feed directly when that sol is selected (the feed sent `Access-Control-Allow-
  Origin: *` on 2026-11-14) and shows up to four Navcam frames; if the feed does not answer, the timeline
  still works without photos and says so. No third edge function.
- **Phone performance** is checked by the builder in a phone-sized viewport with the CPU throttled, and by
  the team on a real phone from the preview link once the visor exists.
- **Hosting size.** Vercel's CLI upload is believed to be capped near 100 MB on the Hobby plan, and the
  spec's package is about 166 MB. Until the plan is known the package is designed to fit: zoom 14 imagery
  only over the HiRISE box, terrain at zoom 13 over the crater only, WebP quality tuned, with a target of
  90 MB. Deploying from a connected Git repository, or a Pro plan, lifts this and restores the spec's
  coverage.

## Answered by the team (2026-11-14)

1. Time is not the builder's concern: build the whole thing properly.
2. Work locally. Deployment happens at the very end, with the team. The package keeps the spec's coverage;
   its size against the hosting plan is settled at deploy time.
3. A NASA API key was supplied. It lives in `.env.local` and is read only by `api/spaceweather.ts`.
4. Everything in the project is in English.
5. Subagents are for the builder to use sparingly, only where they do not cost quality.

## Order

Reordered from the build spec so the parts the team asked for most exist first. Each step ends deployable.

1. Skeleton, design system, store, URL sync, the globe entry. Data tools written and started in the
   background.
2. Engines with tests.
3. The real tile protocol on the package as it arrives; places, search and the place card.
4. Router, alternatives, the route card and the mission editor.
5. Simulation, the alert model, base and chat, the run panel.
6. The visor: ground, sky, rocks, cameras, HUD, models, Rover View, quality tiers.
7. Map look: relief curve, sun lighting, derived layers, rings and marks, flyover, Discover.
8. Live space weather, exports and the cuff card, validation against Perseverance.
9. How it works, README and data notes, the AI disclosure, phone pass, the full Playwright suite, deploy.

If time runs short, cuts come from the end of this list upward, and the README names what was left out.
