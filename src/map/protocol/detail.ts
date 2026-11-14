/**
 * Pure pixel maths for live detail: an upsampled package tile gives the colour, a finer greyscale
 * image gives the texture. Only the texture’s high-pass is used, so the planet keeps one colour grade.
 */

/** High-pass radius in pixels. It grows with the upsampling, or ridges and crater rims turn to grain. */
export function highPassRadius(zoom: number, ancestorZoom: number): number {
  return Math.max(2, Math.min(48, 1.5 * 2 ** (zoom - ancestorZoom)));
}

/** Rec. 709 luminance of RGBA pixels, 0 to 255. */
export function luminance(rgba: Uint8ClampedArray | Uint8Array, out = new Float32Array(rgba.length / 4)): Float32Array {
  for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
    out[i] = 0.2126 * (rgba[p] ?? 0) + 0.7152 * (rgba[p + 1] ?? 0) + 0.0722 * (rgba[p + 2] ?? 0);
  }
  return out;
}

function boxBlurPass(src: Float32Array, dst: Float32Array, w: number, h: number, r: number, horizontal: boolean): void {
  const n = horizontal ? w : h;
  const lines = horizontal ? h : w;
  const stride = horizontal ? 1 : w;
  const lineStride = horizontal ? w : 1;
  const norm = 1 / (2 * r + 1);
  for (let line = 0; line < lines; line += 1) {
    const base = line * lineStride;
    // The window starts centred on the first sample, with the edge value repeated outside.
    const first = src[base] ?? 0;
    const last = src[base + (n - 1) * stride] ?? 0;
    let sum = first * (r + 1);
    for (let i = 1; i <= r; i += 1) sum += src[base + Math.min(n - 1, i) * stride] ?? 0;
    for (let i = 0; i < n; i += 1) {
      dst[base + i * stride] = sum * norm;
      const add = i + r + 1 < n ? (src[base + (i + r + 1) * stride] ?? 0) : last;
      const sub = i - r >= 0 ? (src[base + (i - r) * stride] ?? 0) : first;
      sum += add - sub;
    }
  }
}

/** Three box blurs: close to a Gaussian of the given radius. */
export function blur(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius / 1.6));
  const a = Float32Array.from(src);
  const b = new Float32Array(src.length);
  for (let pass = 0; pass < 3; pass += 1) {
    boxBlurPass(a, b, w, h, r, true);
    boxBlurPass(b, a, w, h, r, false);
  }
  return a;
}

export interface DetailLayer {
  /** Greyscale detail over the padded tile, 0 to 255. */
  lum: Float32Array;
  /** 0 to 1 per pixel: where the detail exists. Omit for full coverage. */
  mask?: Float32Array;
  radius: number;
  /** How strongly the texture shows; 1 is the texture’s own contrast. */
  gain: number;
}

/**
 * Blends detail into a base tile, in place.
 * `base` is RGBA of size*size; each layer’s arrays are (size + 2 * pad) squared, centred on the tile.
 */
export function blendDetail(base: Uint8ClampedArray, size: number, pad: number, layers: readonly DetailLayer[]): void {
  const full = size + 2 * pad;
  for (const layer of layers) {
    const low = blur(layer.lum, full, full, layer.radius);
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const q = (y + pad) * full + (x + pad);
        const m = layer.mask ? (layer.mask[q] ?? 0) : 1;
        if (m <= 0.004) continue;
        // High-pass as a fraction of full scale, limited softly so one bright rock cannot blow out.
        const hp = Math.tanh((((layer.lum[q] ?? 0) - (low[q] ?? 0)) / 255) * layer.gain * 2.2) / 2.2;
        const p = (y * size + x) * 4;
        const r = base[p] ?? 0;
        const g = base[p + 1] ?? 0;
        const b = base[p + 2] ?? 0;
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const k = 1 + hp * m * 2.4;
        // Strong brightening moves toward grey: sunlit rims are pale dust, not neon orange.
        const grey = Math.max(0, Math.min(0.6, (k - 1.12) * 1.6));
        base[p] = (r * (1 - grey) + lum * grey) * k;
        base[p + 1] = (g * (1 - grey) + lum * grey) * k;
        base[p + 2] = (b * (1 - grey) + lum * grey) * k;
      }
    }
  }
}
