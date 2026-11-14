import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons = cronJobs();

// A tab that closes without saying goodbye stops heartbeating; this is what takes it off the online list.
crons.interval('mark silent people offline', { seconds: 30 }, internal.people.sweep, {});

// Missions whose commander vanished are closed, so their crew are free and the list stays honest.
crons.interval('close abandoned missions', { minutes: 2 }, internal.missions.sweepAbandoned, {});

export default crons;
