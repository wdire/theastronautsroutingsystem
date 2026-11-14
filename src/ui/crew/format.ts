import { marsTime } from '@/engines/marsTime';
import type { VehicleId } from '@/engines/types';
import { VEHICLES } from '@/engines/vehicles';
import { fmtClock, fmtDuration, fmtNumber } from '@/lib/format';

/** "in 2 h 10 min", "5 min ago", "now". */
export function fmtFromNow(utcMs: number, nowMs: number): string {
  const d = utcMs - nowMs;
  if (Math.abs(d) < 60_000) return 'now';
  return d > 0 ? `in ${fmtDuration(d / 1000)}` : `${fmtDuration(-d / 1000)} ago`;
}

/** "Sol 54321, 07:40 LTST" at a longitude. */
export function fmtMarsMoment(utcMs: number, lon: number): string {
  const t = marsTime(utcMs, lon);
  return `Sol ${fmtNumber(t.sol)}, ${fmtClock(t.ltstH)} LTST`;
}

/** A vehicle's name from the id a mission stores. */
export function vehicleName(id: string): string {
  return id in VEHICLES ? VEHICLES[id as VehicleId].name : id;
}

/** "07:40 LTST" at a longitude. */
export function fmtLtst(utcMs: number, lon: number): string {
  return `${fmtClock(marsTime(utcMs, lon).ltstH)} LTST`;
}
