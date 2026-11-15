/**
 * Works out walking range rings off the main thread: how far two people in suits get on foot from a
 * point in a given time, over the real ground.
 *
 * In:  { id, grid, lat, lon, hours }
 * Out: { id, rings: { hours, lines }[] }   each line a closed ring of [lon, lat]
 */
import { contour, smoothField, smoothRing, walkingField } from '@/engines/isochrone';
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
  // Smoothed before and after contouring: the step search's facets and the grid's stairs would otherwise read as
  // a ragged line, worst on a small screen where the map is seen close in.
  const field = smoothField(walkingField(grid, lat, lon, Math.max(...hours)), grid.rows, grid.cols);
  const reply: RingsReply = { id, rings: hours.map((h) => ({ hours: h, lines: contour(grid, field, h * 3600).map((line) => smoothRing(line)) })) };
  self.postMessage(reply);
};
