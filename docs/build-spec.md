You are building Areo from an empty repository, in one long session. This message is the whole specification of
the finished app as it stands: every value below is final, nothing in it is superseded later. Work through it
yourself.

How to work

- First save this message verbatim to docs/build-spec.md and commit it. If your context is summarised later,
  re-read docs/build-spec.md and docs/progress.md and continue from there.
- Plan the build in the phases listed at the end ("Build order"). Keep docs/progress.md: one line per phase,
  done or not, with what is left. Use subagents for independent pieces (the Python data tools, the engines and
  their tests) when that saves time.
- After each phase: tsc, eslint, vitest and that phase's acceptance checks (Playwright where named), then commit
  with a message that says what changed for a user and why. Do not move on while a check fails; fix the cause.
- Where a host is unreachable from your sandbox, say which, build everything else, and leave the tool ready to
  run where the network allows. Never disable TLS verification.
- When this spec and your instinct disagree, follow the spec: each rule here was learned the hard way (see
  "Pitfalls" at the end).

==================================================================================================================

1. # What it is
   Areo: a NASA Space Apps 2026 entry for "Interplanetary Survival Guide: Martian Map". A web app to plan and run a
   Marswalk or rover traverse in and around Jezero crater on real NASA data: routes, oxygen, power, radiation, dust,
   daylight; then run the mission in simulated time with a base on the radio, or walk the ground in a 3D helmet view.
   The intro says "Plan a walk on Mars" with the line "Jezero crater, where Perseverance landed, and the land around
   it. Plan a route on real orbital data, check oxygen, radiation and dust, then walk it in the helmet view."

Stack: Vite 8, React 18, TypeScript 6 strict, Zustand 5, MapLibre GL 6 (globe projection), three.js 0.187,
Vitest 5, Playwright 1.65. Python 3 with numpy, Pillow, shapely for a one-off data pipeline under tools/, whose
outputs are committed under public/. Two Vercel edge functions under api/. Deployed as a static site on Vercel.

Region: Jezero and Nili Fossae, 13.1 to 23.8 N, 71.8 to 83.1 E (about 600 x 600 km), centre 18.45 N 77.45 E. A
core box 17.3 to 19.6 N, 76.2 to 78.7 E; a crater box; the Mars 2020 HiRISE DTM box. Outside the region the app
still works (live tiles), but routes are limited to the region.

Rules

- Real data with provenance: every dataset gets an entry in public/data/sources.json (id, name, mission, product,
  url, licence, notes, retrieved). Anything modelled or illustrative is labelled so in the UI and in "How it works".
- Mars: radius 3,396,190 m, gravity 3.71 m/s2, sol 88,775.244 s. Times shown as local true solar time (LTST).
- Plain English in the UI, short sentences, numbers with units, no emoji. Every exaggeration is labelled.
- Pure engines under src/engines with unit tests; UI never computes physics itself.

================================================================================================================== 2. Data package (tools/, outputs committed; about 157 MB under public/region, 9 MB under public/data)
==================================================================================================================
tools/build_region.py (helpers tools/region.py, tools/sources.py with add_source()) builds Web Mercator tiles:

- Elevation, terrarium lossless WebP: the planet to zoom 3 from MOLA MEGDR (PDS Geosciences); the region from the
  USGS HRSC and MOLA blended DEM at 200 m (planetarymaps.usgs.gov / its S3 bucket, read by HTTP ranges for the
  window only); the crater from the Mars 2020 CTX DTM (20 m) and HiRISE DTM (1 m, read at about 5 m). Terrain
  zooms 6 to 9 over the region, 10 over the core, 12 to 13 over the crater, 14 over the HiRISE model.
- Imagery, WebP: the planet zoom 0 to 4 from Viking MDIM 2.1 colour (NASA Mars Trek WMTS,
  https://trek.nasa.gov/tiles/Mars/EQ/<layer>/1.0.0/default/default028mm/{z}/{y}/{x}.jpg). The region as a detail
  pyramid: Viking colour (hue pulled toward ochre, luminance kept) to zoom 8; from zoom 9 each tile is its parent
  upsampled plus a normalised high-pass of the finer source (THEMIS day IR zoom 9 to 10; CTX from Esri OnMars
  https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX/MapServer zoom 11 to 13, core only; the Mars 2020 CTX
  ortho at zoom 14 over the crater). 8 px padding on every detail pass, so no seams or rectangles.
- Never let a tile run past its source window by clamping: the last row or column smears across the tile in
  streaks of colour and height that frame the region on the globe. tools/fix_region_edges.py (also
  build_region.py --edges) finds where real data ends (a smeared column equals its neighbour along its length)
  and refills outside it from the planet package, colour-gain or level-offset matched along the edge, feathered
  over 0.35 degrees.
- coverage.json: per product (img, terrain, planetImg, planetTerrain) and zoom, the tile rectangles present, plus a
  version (sha1 of every tile's path and size). Tile URLs carry ?v=version; vercel.json makes coverage.json
  must-revalidate.
- Retry every download (connection resets happen); record every product with add_source().

Other data (each a tools/ script into public/data/, each in sources.json):

- IAU Gazetteer names in and near the region (planetarynames.wr.usgs.gov), each with a minZoom.
- Perseverance traverse and localised waypoints (JPL MMGIS): public/data/traverses/m20.json as
  { rover, name, path: [lon, lat, elev][], waypoints: { sol, lon, lat, elev, distKm }[] }.
- Mars 2020 named places (Octavia E. Butler Landing, Seitah, Cheyava Falls, Wildcat Ridge, Rochette, ...) at the
  rover's position on their sol, each with 1 to 3 Navcam or Mastcam-Z frames from the public raw images feed,
  resized to 1200 px WebP.
- Weather snapshots from Curiosity REMS and Perseverance MEDA (mars.nasa.gov RSS weather API).
- USGS Mars Global Cave Candidate Catalog (cut to the region); a curated landing sites list.
- tools/build_geology.py: the USGS global geologic map (Tanaka et al. 2014, SIM 3292) from Mars Trek's ArcGIS
  layer https://trek.nasa.gov/mars/trekarcgis/rest/services/SIM3292_Global_Geology/MapServer/0/query (f=geojson,
  outFields=Unit,UnitDesc, the region envelope, outSR 4326), clipped, simplified to about 1 km, with each unit's
  USGS colour from the layer's renderer: public/data/geology.json (units: code, name, colour, kind, a line on what
  it is, period, age in words; and polygons). Jezero reads HNt, Nili Fossae mNh, Syrtis eHv.
- tools/build_models.py: NASA 3D models (github.com/nasa/NASA-3D-Resources): Perseverance, Ingenuity, the Space
  Exploration Vehicle, Habitat Demonstration Unit part 1, the Z2 suit; gltf-transform optimize with meshopt and
  1024 px WebP textures, simplified by half except the Z2 suit (its thin parts tear). About 4.5 MB.

================================================================================================================== 3. Engines (src/engines, pure, tested)
==================================================================================================================

- marsTime: the Mars24 algorithm (Allison and McEwen 2000): MSD, LTST at a longitude, Ls, Mars year, sun
  elevation and azimuth, sunrise and sunset, Earth-Mars light time, dateForLs, nextLtst.
- environment (all "modelled"): temperature by latitude, season, hour and elevation; pressure (560 Pa at the
  datum, 11.1 km scale height); dust optical depth by season after Lemmon et al. with scenarios (clear, regional
  storm with a centre and radius, global storm, solar particle event flag, solar cycle); dose (Curiosity RAD
  0.64 mSv/sol at Gale scaled by column mass and shielding); visibility from tau; meteor showers.
- vehicles: on foot (2 crew, Tobler pace scaled so flat is the 3.3 km/h suit cap, block 25 degrees, suit O2
  0.9 kg per person at 0.075 kg/h at 250 W, scrubbers 8 h), open rover, pressurised rover (cabin, shielding,
  150 kWh + 400 kWh range extender, camps), robotic rover (Perseverance class), helicopter (Ingenuity class). Each
  with speed by slope, comfortable and blocking slope, battery, solar, O2, hotel power, eye height, footprint.
- metabolic.ts: walkingW(speedKmh, gradeDeg) by the Pandolf load-carriage equation (body 75 kg, suit 45 kg,
  terrain factor 1.2), downhill after Santee (gentle descent cheaper than the flat, steep descent dearer), times
  0.68 for a pressurised suit at Mars gravity, never below standing. Flat 3.3 km/h is about 250 W; 10 degrees up
  costs over 1.8x the flat.
- tripComputer.computeTrip(path, {vehicle, departUtc, scenario, style, stops, campAtNight}): integrates along the
  path with the clock advancing: speed by grade measured over at least 450 m, rolling and grade energy, hotel
  load, solar recharge by sun angle and tau, O2 (walkers at walkingW for each stretch's speed and grade, seated
  150 W, work at stops 300 W), water, dose, temperature; samples per path point. Eco slows only vehicles with a
  battery and lowers hotel load. Waits for daylight where the vehicle needs it; campAtNight parks the pressurised
  rover at sunset and goes on after sunrise (nightStops). Outputs: totals, samples, warnings in plain words,
  feasible and limitHit, pointOfNoReturnIndex (walkers: the walk back is costed over the same ground the other
  way, keeping a 20% reserve), o2OutIndex (where the tanks hit zero; its warning says how many km in),
  walkbackIndex (crewed ground rovers, the Apollo walkback rule: the last point from which the crew could walk
  home along their tracks on suit air and scrubbers with the reserve; danger for the open rover) and
  walkbackLimitHours() shared with the map.
- departure.daylightDeparture: the planned time if the trip ends in daylight, else the first start 30 min after a
  sunrise that ends 15 min before sunset, with a fits flag. explain: a 4 to 5 line briefing (shape against the
  straight line, end of day, geologic units crossed and where older rock is reached by midpoint age, parked time,
  point of no return or climb). geology: unitAt, unitsAlong, ageGa.
- terrain: a Grid over DEM tiles (rows, cols, cellWidthM, latOf, lonOf, rowOf, colOf, elevation, slopeDeg (Horn),
  ruggedness, crop windows). isochrone.ts: walkingField(grid, lat, lon, maxH), a Dijkstra in 16 directions (the 8
  neighbours and the knight's moves) at Tobler pace per step's grade, times in a Float64Array; contour(grid, field,
  level) by marching squares.
- router: Lazy Theta\* (any-angle) in a Web Worker over the finest grid that keeps the search under about 1.5
  million cells (crop the grid to the search window), with progress messages. Cost in seconds: travel time at the
  vehicle's slope speed (blocked over its blocking slope), soft penalty for hugging steep cells, and by style
  weights: ruggedness, dose, cold, dust, crater-floor basin, turns. Eco on foot is least oxygen: each second is
  weighed by walkingW / 250 and walkers are not slowed. Route all styles, then merge: the same path (mean
  separation under 150 m) and time, energy and O2 within 3% become one card listing every style ("Safest, fastest
  and eco agree"); an eco route that saves nothing folds into the one that beats it. Badges Quickest, Least O2,
  Least power only for a real saving over 3%; equal times tagged "Same time as ...". Multi-stop missions route leg
  by leg; "return to start" adds the way home. Hazard zones are blocked cells.
- spaceWeather.ts: summarizeSpaceWeather(feed, now) from NASA DONKI: CMEs whose WSA-ENLIL impactList names Mars
  (one per arrival hour, from two days back), SEP events seen at Mars (MAVEN, MSL RAD) in the last week, the
  strongest M or X flare; status quiet, watch (a CME due at Mars within a week) or warning (one within a day, or
  particles at Mars in two days); cmesDuring(sw, depart, arrive) with half a day either side. Test on a real slice
  of DONKI output kept in tests/fixtures.
- export.ts: toGpx (GPX 1.1, track with elevation and planned UTC times, ends and stops as waypoints, the Mars
  frame stated), toGeoJson (route with its budget, ends, stops, and the point of no return, walk-home limit and
  oxygen-out marks), cuffLegs (a new leg at a 30 degree turn or every 2 km: heading, climb, arrival LTST) and
  missionCardHtml (an A5 cuff card: budget, marks, warnings, legs). Escape every name.
- validate.ts: compareTracks(planned, real) (median and 90th percentile distance from the plan, resampled every
  50 m, to the real track, resampled every 20 m; share within 300 m; both lengths), M20_LEGS (Landing to the
  Seitah edge, sols 13 to 199; back across the floor to the delta front, 350 to 419; up the delta front, 694 to
  925; delta top to the rim by Neretva Vallis, 1063 to 1429; along the rim, 1429 to 2022) and legTrack.
- missions: scenario missions with a success rule (sample run to the delta on foot, out through the breach to Nili
  Planum in the pressurised rover, west rim survey in the open rover, scout Belva by air).

================================================================================================================== 4. Simulation (src/sim)
==================================================================================================================
A deterministic world: crews, missions, messages, hazards, a clock that never runs backwards (sub-steps of 60 s).
Starting a mission sets the world to its departure. Each tick moves crews along their path at the vehicle's
slope speed times the clock speed (1x, 5x, 20x, 100x), works tasks at stops (sample 45 min, photo 10, measure 20,
survey 60), spends consumables, holds for night and resumes after sunrise, returns home on round trips or turns
back on out-and-back missions (homeIsAhead decides which end is home). Events: dust devils, regional storms,
solar particle events, steep ground, low battery; each posts advice the crew can Apply (re-route around the
hazard) or Ignore, with a tone and optional speech. The base answers chat lines 30 to 120 simulated seconds later
with replies grounded in the crew's state. A BroadcastChannel keeps an owner tab and mirror tabs in sync, with
commands and reports forwarded; ?role=base opens the base console, ?role=crew the crew view.

================================================================================================================== 5. The map (src/map, src/ui)
==================================================================================================================

- One MapLibre map, globe projection, maxZoom 17, maxPitch 80, for the whole app. It opens on the planet with
  Jezero a little left of centre, turning slowly; Enter or a click inside the region flies in, one continuous
  flight; Back flies out. The search box, map buttons and clock fade in once after that landing (only then).
- Custom protocol mars:// (maplibregl.addProtocol): img, dem (terrarium) and derived/<kind>. Base imagery to zoom
  17: the package tile if coverage.json has it (fetch retried once; coverage loaded with 3 tries and re-asked after
  5 s if it failed, or the globe goes black on a bad connection); else the nearest package ancestor upsampled plus
  live detail blended into its luminance: CTX (Esri OnMars, warped from equirectangular 512 px tiles on a CPU
  canvas with willReadFrequently) from zoom 9, Viking below; the high-pass radius grows with the upsampling
  (1.5 x 2^(z - ancestor zoom), 2 to 48 px) or ridges and crater rims away from the core stay mush; strong
  brightening moves toward grey. From zoom 14, HiRISE (Esri OnMars HiRISE) adds its own detail on top wherever an
  image covers the tile. Nobody has to open the layer list to see the sharp, dusty-coloured view. Offline, zoom 12
  outside the core still shows ground.
- Terrain: raster-dem with exaggeration by zoom: 1 on the globe (to zoom 6), 2.2 at 8, 3 from 9.5 to 11.5 (a 45 km
  crater 500 m deep reads flat otherwise), 2.2 at 13, 1.6 from 15. A chip says "Relief x3.0 exaggerated". Coming
  down past zoom 10 the camera tilts once to 55 degrees unless you tilted it yourself; out past zoom 7 it levels.
- Light: the hillshade follows the app clock's sun at the map centre (mapLighting(elev, az): direction = sun
  azimuth, height = sun elevation clamped 8 to 70, strength 0.55 at noon to 0.85 at the horizon), the base
  imagery dims (raster-brightness-max 1 by day, 0.82 near sunset, 0.4 at night) and the sky goes from
  butterscotch through browner haze to near black. Updated on moveend and when the clock changes.
- Labels: IAU names and Mars 2020 places on a canvas over the map with collision, horizon and ridge occlusion and
  hit testing. When the camera moved, draw them inside MapLibre's render event (in the same frame); otherwise at
  most every 400 ms. Never on the next animation frame: they trail the map and slide while panning.
- Overlays (Layers panel): derived from the 200 m grid in the protocol (slope against the vehicle's limits,
  ruggedness, dose, night, cold tonight), blended between cell centres (not drawn cell by cell), imagery overlays
  (HiRISE, THEMIS night IR, TES dust, TES thermal inertia, MOLA roughness, CTX), the USGS geologic map with a
  legend, place labels, landing sites, Perseverance traverse (from zoom 9, stops from 12), caves.
- Planner pins, the route coloured by slope against the vehicle limit with a casing, alternatives in grey,
  the point-of-no-return ring, route marks ("O2 runs out", "Walk-home limit"), walking range rings over the real
  ground from the start (on foot: 1, 2, 4 h; in a crewed rover: the walk-home limit), labelled on their east
  side. Camp spots as tent pins. A cursor readout (lat, lon, elevation, slope, LTST) and a scale bar from 10 m
  to 5000 km.
- Flyover: a button on the route card flies the camera along the route (pitch 62, a little ahead, bearing eased
  toward the way ahead, about 2 s per km, 14 to 45 s, eased in and out) with a bar naming the next stop; touching
  the map or Esc ends it and the camera returns.
- Layout. Left: the search box (places, coordinates), the planner and route card, the place card. Right: a dock of
  panels opened as tabs (Layers, Discover, Missions, Rover track, Base, Crew, How it works): one shows at a time,
  a tab switches or hides it, its cross closes it; a click on the map closes only the transient menus (main menu,
  clock). Top right: the Mars clock. Bottom right: map buttons (layers, 3D, Rover View, locate) and zoom. Bottom:
  the run panel during a mission. Panels open at once (no entrance delay). Phone at 390 x 844: bottom sheets.
- Place card: photos if the rover took any, a two-sentence summary, the geologic unit, actions (Route here, Start
  here, Add stop, Rover View, Zoom in, Share, Mars Trek link
  https://trek.nasa.gov/mars/#v=0.1&x=<lon>&y=<lat>&z=<zoom>&p=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A104905&d=), then
  sections: geology, conditions now (modelled), data and sources, nearby.
- Route card: alternatives, a timing card (ends after dark: "Leave at 06:16 tomorrow", and for the pressurised
  rover "Camp overnight on the way", or "Drive through the night instead"), mission result, headline (time,
  distance, arrival LTST, feasible), tiles (energy or climb, O2 or water, dose with an Earth comparison,
  steepest), a profile strip, the briefing, actions (Ride in the visor, Start mission, flyover, full budget),
  exports (Print cuff card through a hidden iframe, GPX, GeoJSON downloads), and the full budget with warnings
  (plus a live warning when NASA forecasts a CME at Mars while the crew is out).
- Mission editor: stops from the map or a place card, reordered and removed, each with science tasks.
- Run panel: crew, state, LTST, progress with task marks, next objective with distance and time, O2, power, dose,
  tasks, play or pause and speeds; an event card at the top; a separate "Talk to base" button with the latest line
  and an unread count opening the chat.
- Clock menu: Mars year, Ls, sol, UTC, light time; departure (date, season slider); what-if (clear, regional storm
  with a centre picked on the map and a radius, global storm, solar event); "Space weather, live from NASA DONKI"
  (headline, CMEs at Mars, strongest flare, "Plan for a solar particle event" on a warning, when it was
  checked); sound, spoken alerts, theme, share link. A coloured dot on the clock when space weather is not quiet,
  and one toast per visit.
- Rover track panel: Perseverance's drive (length, sols, localisations), fly to the landing site, route the same
  endpoints, and "Check the planner against Perseverance, leg by leg": "Route it" per leg (robotic rover, safest),
  then "N m typical distance from the real drive, P% of the plan within 300 m", lengths, the furthest 10%, and a
  note that the rover detoured for science at wheel scale. Neretva Vallis to the rim should come out near 100 m
  and 87%.
- How it works panel: per model, how it is computed and its limits (terrain, router, alternatives, events, base,
  relief and visor ground, Mars time, temperature, pressure, dust, radiation, vehicles and trip with Pandolf,
  walking range and the walkback rule, validation against Perseverance, live space weather, meteor showers).
- URL: the planner and view sync to the hash, applied once per page load (a module flag: StrictMode runs effects
  twice in development).

================================================================================================================== 6. Edge functions (api/, Vercel edge runtime)
==================================================================================================================

- api/weather.ts: GET ?station=rems|meda passes through mars.nasa.gov's weather feeds (no CORS headers there),
  cached an hour. The app uses it only where it answers JSON, else the bundled snapshot, and says which.
- api/spaceweather.ts: DONKI WSAEnlilSimulations (12 days back to 7 ahead), SEP (14 days), FLR (3 days) in one
  JSON { fetched, enlil, sep, flr }, cached 30 min (s-maxage 1800), key from NASA_API_KEY or DEMO_KEY. The
  browser asks it only in a production build; otherwise (dev, static host) DONKI directly with DEMO_KEY
  (api.nasa.gov sends CORS headers), and keeps a 30 min copy in localStorage. DEMO_KEY allows about 10 requests
  an hour per address.

================================================================================================================== 7. The visor (src/visor, three.js) and Rover View
==================================================================================================================

- Renderer: antialias, PCF soft shadows, neutral tone mapping, exposure 0.95, sRGB. Camera near 0.5 m.
- Ground in three layers, each finer one cutting a square hole in the coarser one's shader (discard): far mesh
  (85 km from the routing grid, kept between visits while within 50 km), mid patch (40 km at 100 m from 200 m
  data, zoom 12 imagery) and near patch (2 km at 6 m from the finest heights there: HiRISE, CTX or HRSC; zoom 14
  imagery only where the package has it, else 13; centimetre-to-metre roughness only where the data is coarse).
  Patches follow the camera and rebuild off the frame loop. A patch's heightAt reads the drawn triangles
  (PlaneGeometry splits each square along (0,1)-(1,0)), not a bilinear blend.
- Every shader variant gets its own customProgramCacheKey ('hole', and '|gd0' or '|gd1' for the ground detail):
  three.js shares compiled programs between materials whose keys match, and the default key is the source text
  of onBeforeCompile.
- Imagery graded for eye level: keep the luminance, put it on Mastcam-Z's butterscotch (0.84, 0.63, 0.45) with
  k = 0.5 + 1.15 L / (1 + 1.2 max(0, L - 0.25)) so pale ground rolls off instead of clipping, 70% graded and 30%
  of the original hue.
- Ground detail shader (near; tone and banding only on mid and far): flats are sand and dust (tone patches,
  grains on a jittered 3x3-searched grid turned off the axes, ripples whose direction drifts, centimetre bumps
  only where a pixel covers a few centimetres); slopes (by the mesh normal, which reads gentler than the ground:
  near 7 to 15 degrees, coarse 4 to 12, modulated by noise) and noise-patch pavements are bedrock: darker and
  greyer, bedded by height in bands at 0.45, 2.3 and 14 m each faded by fwidth of height, jointed into 0.9 m and
  4.2 m Voronoi blocks with dark joints and each block's face tilted its own way, dust on upward faces. Every band
  fades by its size against fwidth. A uniform gdQuality turns joints and bumps off.
- Rocks: instanced, three classes: pebbles (cells 5 m, 22 per cell, 6 to 32 cm, radius 70 m), cobbles (12 m, 9,
  0.28 to 1 m, 220 m), boulders (50 m, 2, 1 to 3.2 m, 600 m); placed from a hash of their cell (stable), kept 3 m
  off the route, fewer on sandy patches; on steep ground and at its foot up to 3x as many and larger (extra
  candidate batches weighted by slope, sampled once per cell). Shapes: lumpy and platy rounded rocks, and
  plane-cut flat-shaded blocks (boulders and half the cobbles), dust on top in vertex colours; each sunk by a
  share of its own height (35%, 30%, 25%).
- Quality tiers: at 5x and faster, or after 3 s under 24 fps, pixel ratio 1, no pebbles, no cobble shadows, no
  joints or bumps. Exposed for tests as \_\_areoVisor.setQuality('auto' | 'high' | 'low').
- Sky: colour by sun elevation and tau, a sun disc the size it looks from Mars with a glow, a blue aureole
  growing as it sets, stars and the moons at night, distance fog; soft sun shadows and a contact shadow under
  every walker and vehicle; dust motes and wheel dust.
- Cameras: helmet, chase, orbit; never under the ground (clamp over the drawn surface, check the line of sight
  to the crew). The crew follows the running mission (interpolated between simulation samples) or plays the
  planned route along the clock; vehicles rest on their wheels (pitch, roll, height from the ground under the
  wheelbase) and face the way they move on screen.
- Models: NASA GLBs with GLTFLoader and MeshoptDecoder, metalness capped at 0.2, a little emissive fill; the drawn
  procedural model until the file loads, then swap in the same frame. Ingenuity's rotor re-pivoted on its own
  centre. The habitat (scale 0.03, modelled in centimetres) 30 m beside the route's start as the base.
- Z2 suit rigged at load: convert quantized attributes to float before baking the node transform (int16 overflow
  makes spikes), stand it on y = 0; bones at pelvis 0.90, spine 1.15, chest 1.40, head 1.62 m, shoulder
  (0.30, 1.50, 0.05), elbow (0.33, 1.25, 0.24), hand (0.28, 1.10, 0.55), hip (0.12, 0.85), knee (0.18, 0.47), ankle
  (0.21, 0.13), mirrored; update world matrices before skeleton.bind(); weights by rule (legs by side blended into
  the pelvis, arm regions by the nearer segment, the rest along the spine by height). Walk: hips swing, knee
  bends on the swing, foot flat, arms lowered from the model's forward pose (shoulder x 0.62, z +-0.1, elbow 0.5)
  and swinging a little, body upright, small bob, twist and sway; stride 0.65 + 0.5 x m/s, 0.9 to 1.9 m, counted
  per walker in step cycles. Two walkers in single file 2.4 m apart on the leader's footsteps, each with its own
  heading spring; turning on the spot takes steps.
- Guides: chevrons along the leg being walked only (to the next stop going out, pointing home on the way back),
  a beacon over the next objective.
- HUD: compass tape, reticle with the bearing to the next turn, objective with distance and time, O2, power and
  dose arcs, outside conditions, LTST with a sunset countdown, the ground source ("HiRISE 1 m DTM", "CTX 20 m
  DTM"), alerts, base notifications by simulated time, the chat, a mini map.
- Rover View: the binoculars map button (or Rover View on a place card) then a click opens the visor on that spot
  with no crew and no route: your own eyes only. W A S D, the arrows or an on-screen pad to walk, Shift for rover
  speed, drag to look; Morning, Noon, Afternoon, Dusk set the local time and stop the clock (a dark spot opens at
  10:00); leaving restores the clock. Near a Perseverance stop (150 m) a card offers its real photos.

================================================================================================================== 8. Tests
==================================================================================================================
Unit tests for every engine (Mars time, environment, vehicles, metabolic, trip computer including the uphill
oxygen, the reversed walk home, oxygen-out and walkback, departure, explain, router and alternatives, isochrone on
flat ground (a near circle within 5%) and against a wall, space weather on the DONKI fixture, exports, validation
including that every M20 leg cuts out of the real track, relief curve, map lighting, ground grading, rocks with
slope weighting, patch heights against a raycast on the drawn mesh, alerts).
Playwright (pass --trace off; give the visor test 240 s, a software-rendered browser draws 1 to 2 frames a
second): the globe in and out with no screen swap; the elevation readout; zoom 5 on the far side shows imagery;
offline zoom 12 outside the core has ground; the layers panel by keyboard; search finds Cheyava Falls and opens
its card with photos; a two-leg mission finds, merges and labels routes; the mission editor; a mission with a
forced dust devil re-routes; the chat with the clock paused; every visor camera above the ground with the
objective shown; the store exposed for the demo console (window.\_\_areo).

================================================================================================================== 9. Build order (your phases)
==================================================================================================================

1. Skeleton, store, URL sync, the map with the globe entry, a flat mars:// protocol. 2. The data tools and the
   package (edges filled), the real protocol with live detail and HiRISE. 3. Names, traverse, places with photos,
   weather (with api/weather.ts), caves, sites, geology; search and the place card. 4. Engines with tests. 5.
   Router worker and alternatives; the route card with timing and the mission editor. 6. Map look: relief curve,
   sun lighting, derived layers, labels in frame, the dock of tabs, rings and route marks, flyover. 7. Simulation,
   events, base and chat, the run panel. 8. The visor: ground layers and shader, rocks, sky, cameras, HUD, models,
   the rigged suit, Rover View, quality tiers. 9. Live space weather (api/spaceweather.ts) and the CME warning;
   exports and the cuff card; validation in the Rover track panel. 10. How it works, README, docs/data-sources.md,
   docs/model-notes.md, the AI disclosure, phone layout, the full Playwright suite, deploy.

================================================================================================================== 10. Pitfalls (each cost a day once)
==================================================================================================================

- Orbital colour at eye level turns maroon: grade to the rovers' ground colour, neutral tone mapping; and roll
  pale ground off or rims clip to a flat blank.
- A polygon offset on the ground lifts it over anything a few centimetres tall: pebbles vanish.
- Grains on an axis-aligned grid and detail finer than a pixel make rows and streaks to the horizon.
- Same onBeforeCompile source on several materials = one shared program: the far ground lost its hole and drew a
  plain disc over the near ground.
- GLSL smoothstep with edge0 > edge1 is undefined (SwiftShader returns 0): write 1 - smoothstep(lo, hi, x).
- Vehicles sink into slopes unless they rest on the higher wheels; crews do not turn unless they face their
  on-screen motion.
- Quantized glTF attributes wrap when the node transform is baked in: convert to float first.
- StrictMode runs effects twice: apply the URL once.
- A landing fade-in with a 2.6 s delay applied to panels made every menu wait 3 s.
- Labels scheduled on requestAnimationFrame from the render event trail the map by a frame.
- A detail high-pass of a fixed 2 px after an 8x upsample keeps only grain: scale the radius with the upsample.
- Float32 times against float64 queue entries make a Dijkstra skip cells; 8 directions draw octagons.
- DEMO_KEY allows about 10 requests an hour: cache DONKI on the server and in the browser.
- The Space Apps site can fail TLS from a sandbox (an old Comodo root): read the challenge in a browser.
