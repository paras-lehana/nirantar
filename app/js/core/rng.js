// Deterministic randomness: the same seed always builds the same plant, so every demo is reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Stateless hash noise in [0, 1): used for telemetry so any timestamp can be computed on demand.
export function hash01(a, b = 0, c = 0) {
  let h = 2166136261 ^ a;
  h = Math.imul(h ^ b, 16777619);
  h = Math.imul(h ^ c, 16777619);
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

// Approximately normal noise (sum of 3 uniforms), mean 0, sd ~1.
export function gauss(a, b, c) {
  return (hash01(a, b, c) + hash01(a + 7, b + 13, c) + hash01(a + 31, b, c + 17) - 1.5) * 2;
}

export function strHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
