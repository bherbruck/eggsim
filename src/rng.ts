export type Rand = () => number;

export function mulberry32(a: number): Rand {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const rr = (r: Rand, a: number, b: number) => a + (b - a) * r();
export const modp = (a: number, m: number) => ((a % m) + m) % m;
export function gaussR(r: Rand) {
  let u = 0;
  while (!u) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * r());
}
