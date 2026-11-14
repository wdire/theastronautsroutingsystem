import { BufferAttribute, BufferGeometry, CanvasTexture, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, Vector2, type Texture } from 'three';
import { finestZoomAt, loadGrid } from '@/data/dem';
import { getCoverage, hasTile, nearestTile, tileUrl } from '@/data/coverage';
import { boxTouchesHirise, loadEsriHiriseImage, loadHiriseHeights, loadHiriseImage, type HiriseHeights, type HiriseImage } from '@/data/hirise';
import { makeGrid } from '@/engines/terrain';
import { gradePixels } from '@/engines/grading';
import { latToPx, lonToPx, smoothstep } from '@/lib/geo';
import { toBitmap } from '@/map/protocol';
import { imgTile } from '@/map/protocol/img';
import { curvatureDrop, toLonLat, type Frame } from './frame';
import { fieldHeightAt, fieldIndices, type HeightField } from './heightfield';
import { groundMaterial, type GroundKind } from './groundShader';
import { cutoffForSourceZoom, HIRISE_CUTOFF_M, planetMetres, reliefAt, type ReliefSample } from './relief';

export interface PatchSpec {
  kind: GroundKind;
  /** Side of the square patch, m. */
  sizeM: number;
  /** Samples per side. */
  samples: number;
  /** Zoom of the orbital colour drawn on it. */
  imgZoom: number;
  /** Finest package elevation zoom to use. */
  demZoom: number;
  /**
   * Inside the Jezero HiRISE mosaic: the level of USGS's elevation model (0 is 1 m) and of the image,
   * from USGS's 25 cm mosaic (0 is 25 cm) or Esri's tiled HiRISE layer (14 is about 1.3 m). `priority`
   * orders the USGS requests: lower goes first.
   */
  hirise?: { dtm: number; ortho: number; image: 'usgs' | 'esri'; priority: number };
  /**
   * How this layer meets the coarser one around it: over the ring from `fromM` to `toM` inside its
   * edge its heights turn into the coarser layer’s and end `sinkM` under them, so the coarser layer
   * draws on top. With `demZoom` the coarser heights are read from the package at that zoom; without
   * it, from the coarser patch’s own drawn surface (the close patch, which lies wholly on the near one).
   */
  blend?: { demZoom?: number; fromM: number; toM: number; sinkM: number; reliefMinM?: number };
  /**
   * The finest invented relief this layer draws, m (see relief.ts), about four of its triangles. Absent: the
   * layer draws the data alone. A blend's `reliefMinM` is the coarser layer's, so the ring meets what it draws.
   */
  reliefMinM?: number;
}

/** The ground layers, coarse to fine. Each finer one cuts a hole in the one before it. */
export const FAR: PatchSpec = { kind: 'far', sizeM: 85_000, samples: 257, imgZoom: 10, demZoom: 9 };
export const MID: PatchSpec = { kind: 'mid', sizeM: 40_000, samples: 401, imgZoom: 12, demZoom: 10, reliefMinM: 400, blend: { demZoom: FAR.demZoom, fromM: 4_000, toM: 1_000, sinkM: 10 } };
export const NEAR: PatchSpec = {
  kind: 'near',
  sizeM: 2_000,
  samples: 501,
  imgZoom: 14,
  demZoom: 14,
  hirise: { dtm: 2, ortho: 14, image: 'esri', priority: 3 },
  reliefMinM: 16,
  blend: { demZoom: MID.demZoom, fromM: 330, toM: 140, sinkM: 0.8, reliefMinM: MID.reliefMinM },
};
/** Under the viewer’s feet: half-metre triangles on the 1 m model, the 25 cm image on top. */
export const CLOSE: PatchSpec = { kind: 'close', sizeM: 256, samples: 513, imgZoom: 14, demZoom: 14, hirise: { dtm: 0, ortho: 0, image: 'usgs', priority: 0 }, reliefMinM: 1.6, blend: { fromM: 44, toM: 16, sinkM: 0.12 } };

/** How far inside a layer’s edge the coarser layer’s hole stops, m. Inside the ring where the two agree. */
export const HOLE_INSET_M = { mid: 700, near: 110, close: 20 } as const;

export interface Patch {
  spec: PatchSpec;
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  field: HeightField;
  /** Centre in the local frame. */
  cx: number;
  cz: number;
  /** Zoom of the coarsest package elevation that went into it; 18 where HiRISE’s own model is drawn. */
  demSourceZoom: number;
  /** Whether HiRISE’s model and image are drawn on it. */
  hirise: boolean;
  /** For the checks: what went into it. */
  debug: string;
  heightAt(x: number, z: number): number | null;
  /** How rough the HiRISE image is around a point, 0 (smooth sand) to 1 (broken ground); null without one. */
  roughnessAt(x: number, z: number): number | null;
  /** Tells this patch’s shader where the next finer patch sits, so it leaves that square undrawn. */
  setHole(cx: number, cz: number, half: number): void;
  dispose(): void;
}

/** The imagery over a lon/lat box at one zoom, graded for eye level, as a canvas and its pixel origin. */
async function imagery(
  west: number,
  south: number,
  east: number,
  north: number,
  zoom: number,
  live: boolean,
): Promise<{ canvas: HTMLCanvasElement; px0: number; py0: number }> {
  const x0 = Math.floor(lonToPx(west, zoom) / 256);
  const x1 = Math.floor(lonToPx(east, zoom) / 256);
  const y0 = Math.floor(latToPx(north, zoom) / 256);
  const y1 = Math.floor(latToPx(south, zoom) / 256);
  const canvas = document.createElement('canvas');
  canvas.width = (x1 - x0 + 1) * 256;
  canvas.height = (y1 - y0 + 1) * 256;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = 'rgb(150 96 62)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cov = getCoverage();
  const signal = new AbortController().signal;
  const jobs: Promise<void>[] = [];
  for (let ty = y0; ty <= y1; ty += 1) {
    for (let tx = x0; tx <= x1; tx += 1) {
      const dx = (tx - x0) * 256;
      const dy = (ty - y0) * 256;
      jobs.push(
        (async () => {
          try {
            if (live || !cov || hasTile(cov, 'img', zoom, tx, ty)) {
              // The map’s own tile: the package tile, or its ancestor with live detail.
              ctx.drawImage(await toBitmap(await imgTile([], zoom, tx, ty, signal)), dx, dy);
              return;
            }
            // Wide layers skip the live services: the nearest package ancestor is enough at that distance.
            const ref = nearestTile(cov, ['img', 'planetImg'], zoom, tx, ty);
            if (!ref) return;
            const res = await fetch(tileUrl(cov, ref));
            if (!res.ok) return;
            const bitmap = await createImageBitmap(await res.blob());
            const dz = zoom - ref.z;
            const size = 256 / 2 ** dz;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(bitmap, (tx - (ref.x << dz)) * size, (ty - (ref.y << dz)) * size, size, size, dx, dy, 256, 256);
          } catch {
            // A missing tile leaves the flat ochre fill.
          }
        })(),
      );
    }
  }
  await Promise.all(jobs);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  gradePixels(image.data);
  ctx.putImageData(image, 0, 0);
  return { canvas, px0: x0 * 256, py0: y0 * 256 };
}

/** Local roughness of a grey image: the spread of brightness in a small window, as a share of its mean. */
function roughnessGrid(img: HiriseImage, windowPx: number): { grid: Float32Array; cols: number; rows: number; cell: number } {
  const ctx = img.canvas.getContext('2d', { willReadFrequently: true });
  const cell = windowPx;
  const cols = Math.floor(img.width / cell);
  const rows = Math.floor(img.height / cell);
  const grid = new Float32Array(cols * rows).fill(Number.NaN);
  if (!ctx) return { grid, cols, rows, cell };
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let sum = 0;
      let sq = 0;
      let n = 0;
      for (let y = r * cell; y < (r + 1) * cell; y += 1) {
        for (let x = c * cell; x < (c + 1) * cell; x += 1) {
          const i = (y * img.width + x) * 4;
          if ((data[i + 3] ?? 0) < 128) continue;
          const v = data[i] ?? 0;
          sum += v;
          sq += v * v;
          n += 1;
        }
      }
      if (n < cell * cell * 0.5) continue;
      const mean = sum / n;
      const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
      // A spread of 4% of the mean is rippled sand; 18% is ground broken into rocks and their shadows.
      grid[r * cols + c] = Math.max(0, Math.min(1, (sd / Math.max(mean, 8) - 0.04) / 0.14));
    }
  }
  return { grid, cols, rows, cell };
}

export interface BuildOptions {
  maxAnisotropy: number;
  /** Read HiRISE’s model and image where they exist: slower, as tiles come from USGS. */
  hirise: boolean;
  /** The coarser layer’s drawn surface, for a patch that blends into it without package data. */
  coarser?: (x: number, z: number) => number | null;
  signal?: AbortSignal;
}

/** Builds one ground layer centred on a point of the local frame. Heavy: call it off the frame loop. */
export async function buildPatch(frame: Frame, cx: number, cz: number, spec: PatchSpec, opts: BuildOptions): Promise<Patch> {
  const half = spec.sizeM / 2;
  const [west, north] = toLonLat(frame, cx - half, cz - half);
  const [east, south] = toLonLat(frame, cx + half, cz + half);
  const padLon = (east - west) * 0.02;
  const padLat = (north - south) * 0.02;
  const box: [number, number, number, number] = [west - padLon, south - padLat, east + padLon, north + padLat];

  const useHirise = opts.hirise && spec.hirise !== undefined && boxTouchesHirise(west, south, east, north);
  const blend = spec.blend;
  const [loaded, coarse, tex, hiH, hiImg] = await Promise.all([
    loadGrid(box, 2_400_000, spec.demZoom),
    blend?.demZoom !== undefined ? loadGrid(box, 600_000, blend.demZoom).catch(() => null) : null,
    imagery(west, south, east, north, spec.imgZoom, spec.kind === 'near' || spec.kind === 'close'),
    useHirise && spec.hirise ? loadHiriseHeights(box, spec.hirise.dtm, opts.signal, spec.hirise.priority).catch(() => null) : null,
    useHirise && spec.hirise
      ? (spec.hirise.image === 'esri' ? loadEsriHiriseImage(box, spec.hirise.ortho, opts.signal) : loadHiriseImage(box, spec.hirise.ortho, opts.signal, spec.hirise.priority + 1)).catch(() => null)
      : null,
  ]);
  const grid = makeGrid(loaded.spec);
  const coarseGrid = coarse ? makeGrid(coarse.spec) : null;

  const n = spec.samples;
  const step = spec.sizeM / (n - 1);
  const lonLat = new Float64Array(n * n * 2);
  for (let iz = 0; iz < n; iz += 1) {
    for (let ix = 0; ix < n; ix += 1) {
      const [lon, lat] = toLonLat(frame, cx - half + ix * step, cz - half + iz * step);
      lonLat[(iz * n + ix) * 2] = lon;
      lonLat[(iz * n + ix) * 2 + 1] = lat;
    }
  }

  // HiRISE’s model is levelled against the package (whose own HiRISE heights are tied to the CTX model
  // below them): the median difference over the patch is added, so the layers meet without a step.
  let hiOffset = 0;
  let hiShare = 0;
  if (hiH && hiH.filled > 0) {
    const diffs: number[] = [];
    let inside = 0;
    const every = Math.max(1, Math.floor(n / 40));
    for (let iz = 0; iz < n; iz += every) {
      for (let ix = 0; ix < n; ix += every) {
        const i = iz * n + ix;
        const lon = lonLat[i * 2] ?? 0;
        const lat = lonLat[i * 2 + 1] ?? 0;
        const h = hiH.heightAt(lon, lat);
        if (h === null) continue;
        inside += 1;
        diffs.push(grid.elevation(lat, lon) - h);
      }
    }
    diffs.sort((a, b) => a - b);
    hiOffset = diffs[diffs.length >> 1] ?? 0;
    hiShare = inside / Math.ceil(n / every) ** 2;
  }
  const hiHeights: HiriseHeights | null = hiH && hiShare > 0 ? hiH : null;

  // How fine the package's elevation is around each point, on a coarse lattice read bilinearly: the
  // invented relief starts where the data stops.
  const cov = getCoverage();
  const LAT = 17;
  const cutLattice = new Float32Array(LAT * LAT);
  for (let j = 0; j < LAT; j += 1) {
    for (let k = 0; k < LAT; k += 1) {
      const [lon, lat] = toLonLat(frame, cx - half + (k * spec.sizeM) / (LAT - 1), cz - half + (j * spec.sizeM) / (LAT - 1));
      cutLattice[j * LAT + k] = cutoffForSourceZoom(cov ? Math.min(finestZoomAt(cov, lon, lat), loaded.spec.zoom) : loaded.coarsestSourceZoom);
    }
  }
  const cutoffAt = (ix: number, iz: number): number => {
    const gx = (ix / (n - 1)) * (LAT - 1);
    const gz = (iz / (n - 1)) * (LAT - 1);
    const x0 = Math.min(LAT - 2, Math.floor(gx));
    const z0 = Math.min(LAT - 2, Math.floor(gz));
    const u = gx - x0;
    const v = gz - z0;
    const at = (a: number, b: number) => cutLattice[b * LAT + a] ?? 600;
    return (at(x0, z0) * (1 - u) + at(x0 + 1, z0) * u) * (1 - v) + (at(x0, z0 + 1) * (1 - u) + at(x0 + 1, z0 + 1) * u) * v;
  };
  const rs: ReliefSample = { h: 0, sand: 0, rock: 0 };
  const rsCoarse: ReliefSample = { h: 0, sand: 0, rock: 0 };

  const heights = new Float32Array(n * n);
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  const uvHi = new Float32Array(n * n * 2);
  // Per point: loose sand and exposed rock, 0 to 1, for the shader and the rocks.
  const soil = new Float32Array(n * n * 2);
  for (let iz = 0; iz < n; iz += 1) {
    const z = cz - half + iz * step;
    for (let ix = 0; ix < n; ix += 1) {
      const x = cx - half + ix * step;
      const i = iz * n + ix;
      const lon = lonLat[i * 2] ?? 0;
      const lat = lonLat[i * 2 + 1] ?? 0;
      let elevation = grid.elevation(lat, lon);
      let cutoff = cutoffAt(ix, iz);
      if (hiHeights) {
        const h = hiHeights.heightAt(lon, lat);
        if (h !== null) {
          // Near the mosaic’s edge the model gives way to the package over a few tens of metres.
          elevation = h + hiOffset;
          cutoff = HIRISE_CUTOFF_M;
        }
      }
      const [PX, PZ] = planetMetres(lon, lat);
      if (spec.reliefMinM !== undefined) {
        reliefAt(PX, PZ, spec.reliefMinM, cutoff, rs);
        elevation += rs.h;
        soil[i * 2] = rs.sand;
        soil[i * 2 + 1] = rs.rock;
      }
      if (blend) {
        const inside = half - Math.max(Math.abs(x - cx), Math.abs(z - cz));
        if (inside < blend.fromM) {
          const w = 1 - smoothstep(blend.toM, blend.fromM, inside);
          const coarser = coarseGrid
            ? coarseGrid.elevation(lat, lon) + (blend.reliefMinM !== undefined ? reliefAt(PX, PZ, blend.reliefMinM, cutoffAt(ix, iz), rsCoarse).h : 0)
            : (() => {
                const y = opts.coarser?.(x, z);
                return y === null || y === undefined ? null : y + frame.base + curvatureDrop(x, z);
              })();
          if (coarser !== null) elevation += (coarser - elevation) * w - blend.sinkM * w;
        }
      }
      const y = elevation - frame.base - curvatureDrop(x, z);
      heights[i] = y;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = (lonToPx(lon, spec.imgZoom) - tex.px0) / tex.canvas.width;
      uvs[i * 2 + 1] = 1 - (latToPx(lat, spec.imgZoom) - tex.py0) / tex.canvas.height;
      if (hiImg) {
        const [u, v] = hiImg.uvOf(lon, lat);
        uvHi[i * 2] = u;
        uvHi[i * 2 + 1] = v;
      }
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setAttribute('uvHi', new BufferAttribute(uvHi, 2));
  geometry.setAttribute('soil', new BufferAttribute(soil, 2));
  geometry.setIndex(new BufferAttribute(fieldIndices(n), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const map = new CanvasTexture(tex.canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = opts.maxAnisotropy;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;

  let hiTex: Texture | null = null;
  if (hiImg && hiImg.filled > 0) {
    hiTex = new CanvasTexture(hiImg.canvas);
    // Brightness, not colour: read as stored.
    hiTex.colorSpace = NoColorSpace;
    hiTex.anisotropy = opts.maxAnisotropy;
    hiTex.minFilter = LinearMipmapLinearFilter;
    hiTex.wrapS = hiTex.wrapT = RepeatWrapping;
    hiTex.generateMipmaps = true;
  }

  const hole = { center: new Vector2(1e9, 1e9), half: 0 };
  const material = groundMaterial(spec.kind, map, hole, loaded.coarsestSourceZoom >= 14 || hiHeights ? 0 : 1, hiTex);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = spec.kind === 'near' || spec.kind === 'close';
  // The ground under the viewer shades itself when the sun is low.
  mesh.castShadow = spec.kind === 'close';
  mesh.frustumCulled = false;
  mesh.renderOrder = { far: 0, mid: 1, near: 2, close: 3 }[spec.kind];

  const rough = hiImg && hiImg.filled > 0.05 ? roughnessGrid(hiImg, Math.max(4, Math.round(2 / hiImg.res))) : null;
  const field: HeightField = { n, x0: cx - half, z0: cz - half, step, heights };
  return {
    spec,
    mesh,
    field,
    cx,
    cz,
    demSourceZoom: hiHeights ? 18 : loaded.coarsestSourceZoom,
    hirise: hiHeights !== null || hiTex !== null,
    debug: `${hiHeights ? 'dtm' : '-'}${hiTex ? `+img${hiImg?.width ?? 0}` : ''}${hiImg ? `(${hiImg.filled.toFixed(2)})` : ''}`,
    heightAt: (x, z) => fieldHeightAt(field, x, z),
    roughnessAt: (x, z) => {
      if (!rough || !hiImg) {
        // Without HiRISE, how rocky the drawn-in relief says it is: blocky rims and knobs, bare sand in hollows.
        if (spec.reliefMinM === undefined) return null;
        const gx = Math.round((x - (cx - half)) / step);
        const gz = Math.round((z - (cz - half)) / step);
        if (gx < 0 || gz < 0 || gx >= n || gz >= n) return null;
        const k = (gz * n + gx) * 2;
        return Math.max(0, Math.min(1, 0.16 + (soil[k + 1] ?? 0) * 1.15 - (soil[k] ?? 0) * 0.3));
      }
      const [lon, lat] = toLonLat(frame, x, z);
      const [u, v] = hiImg.uvOf(lon, lat);
      const c = Math.floor((u * hiImg.width) / rough.cell);
      const r = Math.floor(((1 - v) * hiImg.height) / rough.cell);
      if (c < 0 || r < 0 || c >= rough.cols || r >= rough.rows) return null;
      const g = rough.grid[r * rough.cols + c] ?? Number.NaN;
      return Number.isFinite(g) ? g : null;
    },
    setHole: (hx, hz, hh) => {
      hole.center.set(hx, hz);
      hole.half = hh;
      const u = material.userData.uniforms as { uHoleCenter?: { value: Vector2 }; uHoleHalf?: { value: number } } | undefined;
      if (u?.uHoleHalf) u.uHoleHalf.value = hh;
    },
    dispose: () => {
      geometry.dispose();
      map.dispose();
      hiTex?.dispose();
      material.dispose();
    },
  };
}
