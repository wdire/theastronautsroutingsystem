/**
 * Works out walking range rings off the main thread: how far two people in suits get on foot from a
 * point in a given time, over the real ground.
 *
 * In:  { id, grid, lat, lon, hours }
 * Out: { id, rings: { hours, lines }[] }   each line a closed ring of [lon, lat]
 */
import { contour, walkingField } from '@/engines/isochrone';
import { makeGrid, type GridSpec } from '@/engines/terrain';
import type { LonLat } from '@/engines/types';

export interface RingsRequest {
  id: number;
  grid: GridSpec;
  lat: number;
  lon: number;
  hours: number[];
}

export interface RingsReply {
  id: number;
  rings: { hours: number; lines: LonLat[][] }[];
}

self.onmessage = (e: MessageEvent<RingsRequest>) => {
  const { id, grid: spec, lat, lon, hours } = e.data;
  const grid = makeGrid(spec);
  const field = walkingField(grid, lat, lon, Math.max(...hours));
  const reply: RingsReply = { id, rings: hours.map((h) => ({ hours: h, lines: contour(grid, field, h * 3600) })) };
  self.postMessage(reply);
};
