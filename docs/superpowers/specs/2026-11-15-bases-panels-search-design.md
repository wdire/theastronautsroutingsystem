# Bases, one place to plan, the whole planet in search (2026-11-15)

## Why
The team tried the app as a user would and found it muddled: missions are planned on the left but crews are
gathered on the right; a dust devil alert on the default mission offers "Route around it" and then says no
way round exists; search finds 25 names and not Olympus Mons; a crew can start a walk it could never come
back from. They want it to feel like real surface operations: you live at a base, you go out and come back,
and air and battery set how far you can go.

## Goals
1. Dust devils never cover a stop or the base; a reroute never fails because the devil sits on a stop.
2. The left column is where missions are made and found: search, the base, "Plan a mission", missions you can
   join (two or three, then "Show more"), and the planner with a Crew section (you, people online, androids).
   The right Crew tab is about the mission you are on: roster, roles, checklist, notes, debrief; with no
   mission it says so and lists missions to join, people online and past missions.
3. Search covers every IAU-approved Mars name. Results outside the mapped region say so ("Outside the mapped
   region · view only"); you can fly there but not plan there.
4. A base: a default one on the floor of Jezero, drawn on the map and as a habitat with panels and a pad in
   Rover View; "Move base" picks a new spot on the map (inside the region, gentle ground, no mission running).
   Every mission starts and ends at the base (start is the base, round trip always on).
5. Range: a ring around the base for the chosen vehicle; stops beyond reach are marked; Start is locked when
   the trip computer says the trip is not feasible, with the reason.
6. Photos: place cards (and global search results) show more pictures live from NASA's Image and Video Library.

## Non-goals
Planning outside the mapped region (no terrain there). Several bases per person. A base console in a second tab.

## Approaches
- Panels: (a) move join/create to the left and make the right tab about the current mission (picked);
  (b) one merged panel on the left with crew inside it, no right tab (too much in one column);
  (c) leave layout, add cross-links (does not fix the muddle).
- Base storage: personal, in local storage, the crew mission starting from the commander's base (picked;
  a shared base would need a server table and an owner rule for little gain now).
- Names: ship the whole gazetteer as a separate file loaded when search opens (picked) vs ask USGS live
  (their server has no CORS and the data does not change).

## Calls left to the builder
Base default spot, ring drawing, exact copy, how the Crew section maps onto the existing Convex mission.
