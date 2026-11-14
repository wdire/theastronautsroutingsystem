import { Box3, BoxGeometry, Color, CylinderGeometry, Group, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, Texture, Vector3, type Material, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { MODELS, type ModelName } from './modelSpecs';

const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const cache = new Map<ModelName, Promise<Group>>();

function tame(material: Material): void {
  if (!(material instanceof MeshStandardMaterial)) return;
  // Orbital-photo metal reads as a black mirror under a dusty sky with no environment map.
  material.metalness = Math.min(material.metalness, 0.2);
  material.roughness = Math.max(material.roughness, 0.35);
  // A little self-light so the shaded side is not a silhouette.
  if (material.map && !material.emissiveMap) {
    material.emissiveMap = material.map;
    material.emissive = new Color(1, 1, 1);
    material.emissiveIntensity = 0.07;
  } else if (!material.emissiveMap) {
    material.emissive = material.color.clone();
    material.emissiveIntensity = 0.07;
  }
  if (material instanceof MeshPhysicalMaterial) {
    // Transmission makes three.js draw the whole scene a second time; the models read fine without it.
    material.transmission = 0;
    material.clearcoat = 0;
    material.sheen = 0;
  }
  material.needsUpdate = true;
}

/** Loads a model once: in metres, standing on y = 0, centred on the vertical axis, front to the north. */
export function loadModel(name: ModelName): Promise<Group> {
  let pending = cache.get(name);
  if (!pending) {
    const spec = MODELS[name];
    pending = loader.loadAsync(spec.url).then((gltf) => {
      const inner = gltf.scene;
      inner.scale.multiplyScalar(spec.scale);
      inner.rotation.y += (spec.yawDeg * Math.PI) / 180;
      inner.updateMatrixWorld(true);
      const box = new Box3().setFromObject(inner);
      const centre = box.getCenter(new Vector3());
      inner.position.x -= centre.x;
      inner.position.z -= centre.z;
      inner.position.y -= box.min.y;
      inner.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) tame(m);
      });
      const root = new Group();
      root.name = name;
      root.add(inner);
      return root;
    });
    cache.set(name, pending);
    // A failed download may be tried again on the next visit to the place.
    pending.catch(() => cache.delete(name));
  }
  return pending;
}

const standInMaterial = new MeshStandardMaterial({ color: 0xb9b3a8, roughness: 0.8, metalness: 0 });
const darkMaterial = new MeshStandardMaterial({ color: 0x2b2826, roughness: 0.9, metalness: 0 });

function part(geometry: BoxGeometry | CylinderGeometry | SphereGeometry, material: Material, x: number, y: number, z: number): Mesh {
  const mesh = new Mesh(geometry, material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function wheels(group: Group, radius: number, halfWidth: number, zs: number[]): void {
  const g = new CylinderGeometry(radius, radius, radius * 0.9, 14);
  g.rotateZ(Math.PI / 2);
  for (const z of zs) for (const side of [-1, 1]) group.add(part(g, darkMaterial, side * halfWidth, radius, z));
}

/** A plain drawn shape of the right size, shown while the real model downloads. Front to the north. */
export function standIn(name: ModelName): Group {
  const g = new Group();
  g.name = `${name}-stand-in`;
  if (name === 'perseverance') {
    g.add(part(new BoxGeometry(1.6, 0.5, 2.2), standInMaterial, 0, 1.0, 0));
    g.add(part(new CylinderGeometry(0.06, 0.06, 1.1, 8), standInMaterial, 0.5, 1.75, -0.8));
    g.add(part(new BoxGeometry(0.4, 0.22, 0.25), standInMaterial, 0.5, 2.2, -0.8));
    wheels(g, 0.26, 1.2, [-1.2, 0, 1.2]);
  } else if (name === 'sev') {
    g.add(part(new BoxGeometry(2.6, 1.9, 4.4), standInMaterial, 0, 1.9, 0));
    wheels(g, 0.5, 1.6, [-1.8, 0, 1.8]);
  } else if (name === 'habitat') {
    g.add(part(new CylinderGeometry(2.5, 2.5, 3.3, 24), standInMaterial, 0, 2.2, 0));
    g.add(part(new CylinderGeometry(0.12, 0.12, 0.6, 8), darkMaterial, 1.8, 0.3, 1.8));
    g.add(part(new CylinderGeometry(0.12, 0.12, 0.6, 8), darkMaterial, -1.8, 0.3, 1.8));
    g.add(part(new CylinderGeometry(0.12, 0.12, 0.6, 8), darkMaterial, 0, 0.3, -2.4));
  } else if (name === 'ingenuity') {
    g.add(part(new BoxGeometry(0.14, 0.16, 0.2), standInMaterial, 0, 0.2, 0));
    g.add(part(new CylinderGeometry(0.6, 0.6, 0.012, 20), darkMaterial, 0, 0.36, 0));
    g.add(part(new BoxGeometry(0.16, 0.01, 0.42), darkMaterial, 0, 0.48, 0));
  } else {
    g.add(part(new CylinderGeometry(0.22, 0.2, 0.85, 12), standInMaterial, 0, 0.45, 0));
    g.add(part(new CylinderGeometry(0.27, 0.24, 0.6, 12), standInMaterial, 0, 1.2, 0));
    g.add(part(new SphereGeometry(0.2, 14, 10), standInMaterial, 0, 1.7, 0));
  }
  return g;
}

/** Frees a stand-in's geometry. Clones of a loaded model share its buffers, which `disposeModels` frees. */
export function disposeObject(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (mesh.isMesh && (mesh.material === standInMaterial || mesh.material === darkMaterial)) mesh.geometry.dispose();
  });
}

let users = 0;

/** A 3D view that is going to use the models says so, and says when it is done. */
export function retainModels(): void {
  users += 1;
}

/**
 * Frees every loaded model once no view uses them: about 100 MB of decoded textures that would
 * otherwise outlive the 3D view. The files stay in the browser's cache, so the next visit decodes
 * them again without a download. Counted, because two views can overlap for a moment (React mounts
 * twice in development) and one must not free what the other is drawing.
 */
export function releaseModels(): void {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  for (const pending of cache.values()) {
    void pending
      .then((root) => {
        root.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh) return;
          mesh.geometry.dispose();
          for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
            for (const value of Object.values(m)) {
              if (value instanceof Texture) {
                (value.image as { close?: () => void } | null)?.close?.();
                value.dispose();
              }
            }
            m.dispose();
          }
        });
      })
      .catch(() => undefined);
  }
  cache.clear();
}
