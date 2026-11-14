/** 10 m to 5000 km in 1-2-5 steps. */
const STEPS_M = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000];
const MAX_PX = 120;

export function pickScale(metresPerPixel: number): { metres: number; px: number; label: string } {
  let metres = STEPS_M[0] ?? 10;
  for (const step of STEPS_M) {
    if (step / metresPerPixel <= MAX_PX) metres = step;
  }
  const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`;
  return { metres, px: Math.max(8, Math.round(metres / metresPerPixel)), label };
}
