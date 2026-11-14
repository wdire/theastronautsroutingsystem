# Progress

Plan: docs/superpowers/plans/2026-11-14-areo.md. One line per task, then rulings.

- [ ] 1 Skeleton, design system, store, globe entry
- [ ] 2 Tile package
- [ ] 3 Other datasets and models
- [ ] 4 Engines
- [ ] 5 Real protocol, places, search, place card
- [ ] 6 Router wiring, route card, mission editor
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
