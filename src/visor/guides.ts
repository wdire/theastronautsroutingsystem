import { AdditiveBlending, BufferGeometry, CylinderGeometry, DoubleSide, Float32BufferAttribute, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, Quaternion, Vector3, type Scene } from 'three';

const AHEAD_M = 260;
const EVERY_M = 12;
const MAX = Math.ceil(AHEAD_M / EVERY_M) + 2;

/** A flat chevron on the ground, pointing along -z, 2.6 m wide: wider than the walker ahead, so it shows either side of them. */
function chevron(): BufferGeometry {
  const g = new BufferGeometry();
  const w = 1.3;
  const t = 0.42;
  // Two thin bars meeting at the tip.
  const v = [0, 0, -0.9, -w, 0, 0.5, -w + t, 0, 0.5 + t * 0.6, 0, 0, -0.9 + t * 1.5, w - t, 0, 0.5 + t * 0.6, w, 0, 0.5];
  g.setAttribute('position', new Float32BufferAttribute(v, 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
  g.computeVertexNormals();
  return g;
}

/**
 * The way ahead drawn on the ground: chevrons along the route for the next few hundred metres, and
 * a thin beam of light standing over the next objective so it can be found from far off.
 */
export function createGuides(scene: Scene, heightAt: (x: number, z: number) => number) {
  const material = new MeshBasicMaterial({ color: 0x9cc4ea, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false, fog: false });
  const arrows = new InstancedMesh(chevron(), material, MAX);
  arrows.frustumCulled = false;
  arrows.count = 0;
  arrows.renderOrder = 5;
  const beamMaterial = new MeshBasicMaterial({ color: 0x9cc4ea, transparent: true, opacity: 0.34, blending: AdditiveBlending, depthWrite: false, fog: false });
  const beam = new Mesh(new CylinderGeometry(0.35, 0.6, 90, 12, 1, true), beamMaterial);
  beam.visible = false;
  scene.add(arrows, beam);

  const m = new Matrix4();
  const q = new Quaternion();
  const p = new Vector3();
  const s = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);

  return {
    /**
     * `ahead` is the route from the crew on, in scene metres, nearest first; `objective` the next stop.
     * Call when the crew has moved a few metres, not every frame.
     */
    update(ahead: readonly { x: number; z: number }[], objective: { x: number; z: number } | null): void {
      let n = 0;
      let run = 0;
      let next = EVERY_M;
      for (let i = 1; i < ahead.length && n < MAX && run < AHEAD_M; i += 1) {
        const a = ahead[i - 1];
        const b = ahead[i];
        if (!a || !b) continue;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        while (len > 0 && run + len >= next && n < MAX) {
          const t = (next - run) / len;
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          // A hand's breadth over the ground, so slopes and ripples do not swallow it.
          p.set(x, heightAt(x, z) + 0.09, z);
          q.setFromAxisAngle(up, -Math.atan2(b.x - a.x, -(b.z - a.z)));
          m.compose(p, q, s);
          arrows.setMatrixAt(n, m);
          n += 1;
          next += EVERY_M;
        }
        run += len;
      }
      arrows.count = n;
      arrows.instanceMatrix.needsUpdate = true;
      beam.visible = objective !== null;
      if (objective) beam.position.set(objective.x, heightAt(objective.x, objective.z) + 45, objective.z);
    },
    dispose(): void {
      scene.remove(arrows, beam);
      arrows.geometry.dispose();
      beam.geometry.dispose();
      material.dispose();
      beamMaterial.dispose();
    },
  };
}
