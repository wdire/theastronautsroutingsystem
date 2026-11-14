/**
 * How a crew member looks in 3D. People wear the white Z-2 suit with bands of their own colour on the
 * upper arms and thighs, the way EVA crews are told apart on camera (the ISS suits' red stripes, Apollo's
 * commander bands). Androids keep the suit's shape but are drawn as machines: graphite plating with seams,
 * and a lit band where a visor would be. Every member carries a name tag above the helmet.
 */
import { CanvasTexture, Color, LinearFilter, Material, MeshStandardMaterial, SRGBColorSpace, Sprite, SpriteMaterial, type Object3D, type SkinnedMesh } from 'three';

export interface CrewLook {
  id: string;
  name: string;
  role: string;
  /** Band colour, CSS hex. */
  color: string;
  android: boolean;
  /** The visitor themself. */
  me: boolean;
}

/**
 * The suit's bind pose, in metres above the boots (see suit.ts): bands sit on the upper arm and the thigh.
 * Read in the shader from the unskinned position, so the bands move with the limbs.
 */
const BANDS = /* glsl */ `
float crewBand(vec3 p) {
  float arm = step(0.24, abs(p.x)) * step(1.24, p.y) * step(p.y, 1.36);
  float thigh = step(0.6, p.y) * step(p.y, 0.7) * step(0.04, abs(p.x));
  return max(arm, thigh);
}
`;

function bandedSuit(base: MeshStandardMaterial, color: string): MeshStandardMaterial {
  const m = base.clone();
  const band = new Color(color);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uBand = { value: band };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vBind;\nuniform vec3 uBand;\n${BANDS}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, uBand, crewBand(vBind) * 0.92);');
  };
  m.customProgramCacheKey = () => 'areo-suit-band';
  return m;
}

function androidShell(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: new Color('#9aa0a8'), metalness: 0.25, roughness: 0.45 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBind = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  // Plating: a seam every 14 cm up the body, and lighter panels on the chest and the outer limbs.
  float seam = 1.0 - smoothstep(0.0, 0.012, 0.5 - abs(fract(vBind.y / 0.14) - 0.5));
  diffuseColor.rgb *= 1.0 - seam * 0.55;
  float panel = step(0.5, fract(vBind.x * 3.1 + vBind.y * 0.4));
  diffuseColor.rgb *= 0.92 + panel * 0.12;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
  // A lit band across the face of the helmet, and a small one at the chest: the machine is on.
  // The suit faces -z in its own frame.
  float eye = step(1.69, vBind.y) * step(vBind.y, 1.725) * step(vBind.z, -0.02);
  float chest = step(1.3, vBind.y) * step(vBind.y, 1.33) * step(vBind.z, -0.12) * step(abs(vBind.x), 0.06);
  totalEmissiveRadiance += vec3(0.42, 0.86, 1.0) * (eye * 2.4 + chest * 1.2);`,
      );
  };
  m.customProgramCacheKey = () => 'areo-android';
  return m;
}

/** Dresses a rigged suit for a member. Returns what to dispose. */
export function dress(root: Object3D, look: CrewLook): () => void {
  const made: Material[] = [];
  root.traverse((o) => {
    const mesh = o as SkinnedMesh;
    if (!mesh.isSkinnedMesh) return;
    const base = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as MeshStandardMaterial;
    const next = look.android ? androidShell() : bandedSuit(base, look.color);
    made.push(next);
    mesh.material = next;
  });
  return () => made.forEach((m) => m.dispose());
}

/** A name tag that keeps its size on screen, above the helmet. */
export function nameTag(look: CrewLook): Sprite {
  const scale = 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d') as (CanvasRenderingContext2D & { letterSpacing?: string }) | null;
  const name = look.name.slice(0, 28);
  const role = look.role.toUpperCase().slice(0, 32);
  const accent = look.android ? '#7fdcff' : look.color;
  // Laid out in CSS pixels; the context is scaled for a sharper canvas before anything is drawn.
  const font = (w: number, px: number) => `${w} ${px}px Archivo, system-ui, sans-serif`;
  const PAD = 10;
  const BAR = 3;
  const CARD_H = 40;
  const STEM = 14;
  const kind = look.android ? 'ANDROID' : '';
  let nameW = 0;
  let roleW = 0;
  let kindW = 0;
  let youW = 0;
  if (ctx) {
    ctx.font = font(650, 14);
    nameW = ctx.measureText(name).width;
    ctx.font = font(600, 9.5);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.9px';
    roleW = ctx.measureText(role).width;
    kindW = kind ? ctx.measureText(kind).width + 8 : 0;
    youW = look.me ? ctx.measureText('YOU').width + 10 : 0;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }
  const width = Math.ceil(PAD + BAR + 8 + Math.max(nameW + (youW ? youW + 6 : 0), kindW + roleW) + PAD);
  canvas.width = Math.ceil(width * scale);
  canvas.height = (CARD_H + STEM + 2) * scale;
  if (ctx) {
    ctx.scale(scale, scale);
    // The card: dark glass with a hairline edge, like the rest of the helmet display.
    ctx.fillStyle = 'rgba(12,12,14,0.74)';
    ctx.beginPath();
    ctx.roundRect(0.5, 0.5, width - 1, CARD_H, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 1;
    ctx.stroke();
    // The suit band's colour, as a bar down the left edge.
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.roundRect(PAD, 9, BAR, CARD_H - 18, 1.5);
    ctx.fill();
    const x = PAD + BAR + 8;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#ffffff';
    ctx.font = font(650, 14);
    ctx.fillText(name, x, 19);
    ctx.font = font(600, 9.5);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.9px';
    if (look.me) {
      // A small outlined chip says which one is the visitor.
      const cx = x + nameW + 6;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.roundRect(cx + 0.5, 7.5, youW - 1, 14, 3);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText('YOU', cx + 5, 18);
    }
    if (kind) {
      ctx.fillStyle = accent;
      ctx.fillText(kind, x, 32.5);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText(role, x + kindW, 32.5);
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
    // A hairline stem down to the helmet, ending in a dot, so the tag reads as pinned to its wearer.
    const mid = width / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.beginPath();
    ctx.moveTo(mid, CARD_H + 0.5);
    ctx.lineTo(mid, CARD_H + STEM - 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(mid, CARD_H + STEM - 1, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearFilter;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthWrite: false, transparent: true, sizeAttenuation: false, fog: false }));
  // About 56 px tall (card and stem) on a typical screen, whatever the distance.
  const h = 0.07;
  sprite.scale.set((h * canvas.width) / canvas.height, h, 1);
  sprite.center.set(0.5, 0);
  // The stem's end sits just over the helmet.
  sprite.position.set(0, 2.02, 0);
  sprite.renderOrder = 10;
  sprite.userData.dispose = () => {
    texture.dispose();
    sprite.material.dispose();
  };
  return sprite;
}
