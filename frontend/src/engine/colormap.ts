/** Gradiente térmico KDE: Cian #00F0FF → ámbar → Naranja → Rojo neón #FF2A54. */
const STOPS: [number, number, number, number, number][] = [
  [0.0, 0, 240, 255, 0],
  [0.07, 0, 240, 255, 0],
  [0.2, 0, 170, 255, 0.26],
  [0.36, 0, 240, 255, 0.52],
  [0.55, 250, 214, 60, 0.68],
  [0.72, 255, 138, 0, 0.8],
  [0.88, 255, 42, 84, 0.9],
  [1.0, 255, 110, 140, 0.97],
];

function build(): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < STOPS.length - 2 && v > STOPS[k + 1][0]) k++;
    const [a0, r0, g0, b0, al0] = STOPS[k];
    const [a1, r1, g1, b1, al1] = STOPS[k + 1];
    const t = Math.min(1, Math.max(0, (v - a0) / (a1 - a0)));
    lut[i * 4] = r0 + (r1 - r0) * t;
    lut[i * 4 + 1] = g0 + (g1 - g0) * t;
    lut[i * 4 + 2] = b0 + (b1 - b0) * t;
    lut[i * 4 + 3] = (al0 + (al1 - al0) * t) * 255;
  }
  return lut;
}

export const THERMAL_LUT = build();

/** Color sólido (opaco) para una firma IR 0..1 — trazas, anillos de pulso, etiquetas. */
export function irColor(ir: number, alpha = 1): string {
  const v = Math.round(Math.min(1, 0.36 + ir * 0.64) * 255) * 4;
  return `rgba(${THERMAL_LUT[v]},${THERMAL_LUT[v + 1]},${THERMAL_LUT[v + 2]},${alpha})`;
}

export function irRGB(ir: number): [number, number, number] {
  const v = Math.round(Math.min(1, 0.36 + ir * 0.64) * 255) * 4;
  return [THERMAL_LUT[v], THERMAL_LUT[v + 1], THERMAL_LUT[v + 2]];
}
