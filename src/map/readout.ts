/** What is under the pointer. More fields (elevation, slope, local time) join as their data arrives. */
export interface Readout {
  lon: number;
  lat: number;
  extra: string[];
}

export type Sampler = (lon: number, lat: number) => string[];
let sampler: Sampler = () => [];

/** Lets the terrain and clock modules add fields to the readout without the readout knowing them. */
export function setReadoutSampler(fn: Sampler): void {
  sampler = fn;
}

export function sampleReadout(lon: number, lat: number): string[] {
  return sampler(lon, lat);
}
