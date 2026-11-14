/**
 * The Mars 2020 HiRISE mosaics of Jezero (USGS Astrogeology, Fergason et al. 2020) and their pixel grid.
 * Both are simple cylindrical on the 3,396,190 m sphere, centred on 0 E, and cover the same 21.4 km
 * square around the landing site and the delta. Shared by the tile function and the app.
 */

export type HiriseLayer = 'ortho' | 'dtm';

export interface HiriseLayerSpec {
  url: string;
  width: number;
  height: number;
  /** Metres per source pixel. */
  res: number;
  /** Bytes per sample: 1 (8-bit grey) or 4 (32-bit float metres). */
  bytes: 1 | 4;
  /** Where the strip offset table starts in the file, and how wide each entry is. */
  offsetTable: number;
  offsetBytes: 4 | 8;
  /** Coarsest level served: one output pixel is 2^level source pixels. */
  maxLevel: number;
}

const S3 = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/HiRISE';

export const HIRISE_LAYERS: Record<HiriseLayer, HiriseLayerSpec> = {
  ortho: {
    url: `${S3}/JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif`,
    width: 85_600,
    height: 85_952,
    res: 0.25,
    bytes: 1,
    offsetTable: 344_180,
    offsetBytes: 8,
    maxLevel: 5,
  },
  dtm: {
    url: `${S3}/JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif`,
    width: 21_400,
    height: 21_488,
    res: 1,
    bytes: 4,
    offsetTable: 86_170,
    offsetBytes: 4,
    maxLevel: 3,
  },
};

export const HIRISE_TILE = 512;
const R = 3_396_190;
/** Map coordinates of the outer corner of the top-left pixel, m (the GeoTIFF tie point). */
const X0 = 4_577_366;
const Y0 = 1_106_618;

export function isHiriseLayer(v: string): v is HiriseLayer {
  return v === 'ortho' || v === 'dtm';
}

/** Source pixel (fractional, pixel corners at whole numbers) of a point. */
export function lonLatToSource(layer: HiriseLayer, lon: number, lat: number): { col: number; row: number } {
  const res = HIRISE_LAYERS[layer].res;
  return { col: (R * ((lon * Math.PI) / 180) - X0) / res, row: (Y0 - R * ((lat * Math.PI) / 180)) / res };
}

export function sourceToLonLat(layer: HiriseLayer, col: number, row: number): [number, number] {
  const res = HIRISE_LAYERS[layer].res;
  return [((X0 + col * res) / R) * (180 / Math.PI), ((Y0 - row * res) / R) * (180 / Math.PI)];
}

/** The mosaic's outline, lon/lat. */
export function hiriseBounds(): { west: number; east: number; north: number; south: number } {
  const s = HIRISE_LAYERS.dtm;
  const [west, north] = sourceToLonLat('dtm', 0, 0);
  const [east, south] = sourceToLonLat('dtm', s.width, s.height);
  return { west, east, north, south };
}

export function insideHirise(lon: number, lat: number, marginM = 0): boolean {
  const b = hiriseBounds();
  const m = (marginM / R) * (180 / Math.PI);
  return lon > b.west + m && lon < b.east - m && lat > b.south + m && lat < b.north - m;
}

/** The source rows and columns one tile reads, or null if it lies wholly outside the mosaic. */
export function tileSourceWindow(layer: HiriseLayer, level: number, tx: number, ty: number): { col0: number; row0: number } | null {
  const s = HIRISE_LAYERS[layer];
  const span = HIRISE_TILE * 2 ** level;
  const col0 = tx * span;
  const row0 = ty * span;
  if (col0 >= s.width || row0 >= s.height || tx < 0 || ty < 0) return null;
  return { col0, row0 };
}

/** Metres per output pixel at a level. */
export function levelRes(layer: HiriseLayer, level: number): number {
  return HIRISE_LAYERS[layer].res * 2 ** level;
}

export function tileUrlFor(layer: HiriseLayer, level: number, tx: number, ty: number): string {
  return `/api/hirise?layer=${layer}&l=${level}&x=${tx}&y=${ty}`;
}
