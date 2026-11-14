import { BufferAttribute, BufferGeometry, CanvasTexture, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, SRGBColorSpace, Vector2 } from 'three';
import { loadGrid } from '@/data/dem';
import { getCoverage, hasTile, nearestTile, tileUrl } from '@/data/coverage';
import { makeGrid } from '@/engines/terrain';
import { gradePixels } from '@/engines/grading';
import { latToPx, lonToPx, smoothstep } from '@/lib/geo';
import { toBitmap } from '@/map/protocol';
import { imgTile } from '@/map/protocol/img';
import { curvatureDrop, toLonLat, type Frame } from './frame';
import { fieldHeightAt, fieldIndices, type HeightField } from './heightfield';
import { groundMaterial, type GroundKind } from './groundShader';

export interface PatchSpec {
  kind: GroundKind;
  /** Side of the square patch, m. */
  sizeM: number;
  /** Samples per side. */
  samples: number;
  /** Zoom of the imagery drawn on it. */
  imgZoom: number;
  /** Finest elevation zoom to use. */
  demZoom: number;
  /**
   * How this layer meets the coarser one around it: over `ringM` inside its edge its heights turn into
   * the coarser layer’s (read at `demZoom`), and end `sinkM` under them so the coarser layer draws on top.
   * Without this the two surfaces part wherever their data disagree, and the sky shows through the gap.
   */
  blend?: { demZoom: number; fromM: number; toM: number; sinkM: number };
}

/** The three ground layers, coarse to fine. Each finer one cuts a hole in the one before it. */
export const FAR: PatchSpec = { kind: 'far', sizeM: 85_000, samples: 257, imgZoom: 10, demZoom: 9 };
export const MID: PatchSpec = { kind: 'mid', sizeM: 40_000, samples: 401, imgZoom: 12, demZoom: 10, blend: { demZoom: FAR.demZoom, fromM: 4_000, toM: 1_000, sinkM: 10 } };
export const NEAR: PatchSpec = { kind: 'near', sizeM: 2_000, samples: 335, imgZoom: 14, demZoom: 14, blend: { demZoom: MID.demZoom, fromM: 330, toM: 140, sinkM: 0.8 } };

/** How far inside a layer’s edge the coarser layer’s hole stops, m. Inside the ring where the two agree. */
export const HOLE_INSET_M = { mid: 700, near: 110 } as const;

export interface Patch {
  spec: PatchSpec;
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  field: HeightField;
  /** Centre in the local frame. */
  cx: number;
  cz: number;
  /** Zoom of the coarsest elevation data that went into it. */
  demSourceZoom: number;
  heightAt(x: number, z: number): number | null;
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

/** Builds one ground layer centred on a point of the local frame. Heavy: call it off the frame loop. */
export async function buildPatch(frame: Frame, cx: number, cz: number, spec: PatchSpec, maxAnisotropy: number): Promise<Patch> {
  const half = spec.sizeM / 2;
  const [west, north] = toLonLat(frame, cx - half, cz - half);
  const [east, south] = toLonLat(frame, cx + half, cz + half);
  const padLon = (east - west) * 0.02;
  const padLat = (north - south) * 0.02;

  const box: [number, number, number, number] = [west - padLon, south - padLat, east + padLon, north + padLat];
  const [loaded, coarse, tex] = await Promise.all([
    loadGrid(box, 2_400_000, spec.demZoom),
    spec.blend ? loadGrid(box, 600_000, spec.blend.demZoom).catch(() => null) : null,
    imagery(west, south, east, north, spec.imgZoom, spec.kind === 'near'),
  ]);
  const grid = makeGrid(loaded.spec);
  const coarseGrid = coarse ? makeGrid(coarse.spec) : null;
  const blend = spec.blend;

  const n = spec.samples;
  const step = spec.sizeM / (n - 1);
  const heights = new Float32Array(n * n);
  const positions = new Float32Array(n * n * 3);
  const uvs = new Float32Array(n * n * 2);
  for (let iz = 0; iz < n; iz += 1) {
    const z = cz - half + iz * step;
    for (let ix = 0; ix < n; ix += 1) {
      const x = cx - half + ix * step;
      const [lon, lat] = toLonLat(frame, x, z);
      const i = iz * n + ix;
      // Heights are relative to the origin, less the fall of the planet’s curve away from it.
      let elevation = grid.elevation(lat, lon);
      if (blend && coarseGrid) {
        const inside = half - Math.max(Math.abs(x - cx), Math.abs(z - cz));
        if (inside < blend.fromM) {
          const w = 1 - smoothstep(blend.toM, blend.fromM, inside);
          elevation += (coarseGrid.elevation(lat, lon) - elevation) * w - blend.sinkM * w;
        }
      }
      const y = elevation - frame.base - curvatureDrop(x, z);
      heights[i] = y;
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = (lonToPx(lon, spec.imgZoom) - tex.px0) / tex.canvas.width;
      uvs[i * 2 + 1] = 1 - (latToPx(lat, spec.imgZoom) - tex.py0) / tex.canvas.height;
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new BufferAttribute(uvs, 2));
  geometry.setIndex(new BufferAttribute(fieldIndices(n), 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const map = new CanvasTexture(tex.canvas);
  map.colorSpace = SRGBColorSpace;
  map.anisotropy = maxAnisotropy;
  map.minFilter = LinearMipmapLinearFilter;
  map.generateMipmaps = true;

  const hole = { center: new Vector2(1e9, 1e9), half: 0 };
  const material = groundMaterial(spec.kind, map, hole, loaded.coarsestSourceZoom >= 14 ? 0 : 1);
  const mesh = new Mesh(geometry, material);
  mesh.receiveShadow = spec.kind === 'near';
  mesh.frustumCulled = false;
  mesh.renderOrder = spec.kind === 'far' ? 0 : spec.kind === 'mid' ? 1 : 2;

  const field: HeightField = { n, x0: cx - half, z0: cz - half, step, heights };
  return {
    spec,
    mesh,
    field,
    cx,
    cz,
    demSourceZoom: loaded.coarsestSourceZoom,
    heightAt: (x, z) => fieldHeightAt(field, x, z),
    setHole: (hx, hz, hh) => {
      hole.center.set(hx, hz);
      hole.half = hh;
      const u = material.userData.uniforms as { uHoleCenter?: { value: Vector2 }; uHoleHalf?: { value: number } } | undefined;
      if (u?.uHoleHalf) u.uHoleHalf.value = hh;
    },
    dispose: () => {
      geometry.dispose();
      map.dispose();
      material.dispose();
    },
  };
}
