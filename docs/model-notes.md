# Model notes

What the app works out from the data, how, and where each model stops being reliable. The How it works panel
in the app says the same in fewer words. Anything listed here is shown in the app as "modelled".

## Mars time
`src/engines/marsTime.ts` follows the Mars24 algorithm (Allison and McEwen, 2000): Mars Sol Date, local true
solar time at a longitude, solar longitude Ls, Mars year, the sun's elevation and azimuth, sunrise and sunset,
and the one-way light time to Earth. Tested against the landings of Curiosity and Perseverance.

## Temperature, pressure, dust, radiation
`src/engines/environment.ts`.
- Temperature by latitude, season, hour and height. A climate average, not a forecast.
- Pressure: 560 Pa at the reference level, falling with an 11.1 km scale height.
- Dust optical depth by season, with what-if scenarios: clear, a regional storm (tau 2), a global storm (tau 5).
- Dose: Curiosity RAD's 0.64 mSv per sol at Gale, scaled by the column of air above the ground and by any
  shielding. A solar particle event raises it.

## Vehicles and walking
`src/engines/vehicles.ts`, `src/engines/metabolic.ts`. Walking pace is Tobler's rule scaled so flat ground
gives the 3.3 km/h suit cap, blocked at 25 degrees. Walking effort is the Pandolf load-carriage equation
(75 kg person, 45 kg suit, terrain factor 1.2), with Santee's correction downhill, times 0.68 for a
pressurised suit at Mars gravity. Flat walking comes to about 250 W; ten degrees uphill costs over 1.8 times that.
Nobody has walked on Mars: these are Earth and Apollo figures, scaled.

## Terrain and routes
`src/engines/terrain.ts`, `src/engines/router/`. Height grids are cut from the elevation tiles at the finest
zoom that keeps a leg under about half a million cells. The router is Lazy Theta*: an any-angle search, so
paths are not staircases. Cost is travel time at the vehicle's speed for the slope, with ground over its
blocking slope closed. Three styles weigh ruggedness, radiation, cold, dust, hollows and turns differently;
eco on foot minimises walking effort. Styles whose paths lie within 150 m of each other on average are shown
as one. The grid cannot see hazards smaller than a cell.

## The map's relief and light
`src/engines/relief.ts`, `src/engines/lighting.ts`. Relief is exaggerated by zoom, up to three times, and the
map says by how much. Shading follows the sun at the map centre for the app clock. Night dims the image to
0.6 of full brightness (the lighting model itself goes to 0.4; the map stops higher so it stays readable).

## Rover View
`src/visor/`. The ground mesh is the real terrain at true scale in three nested layers: 85 km, 40 km and
2 km across, the last from the finest model there (HiRISE 1 m, CTX 20 m, or the 200 m blend). The planet's
curve is applied. Orbital colour is regraded to the tone rover cameras record (`src/engines/grading.ts`).
Rocks, ripples, grains and rock layering are procedural: placed by a hash of position so they are stable,
more and larger on steep ground, and labelled in the view as drawn in.

## Not built yet
The trip computer (time, oxygen, power, water and dose along a route), the mission simulation that depends on
it, live space weather, exports and the validation against Perseverance's drive. See `docs/progress.md`.
