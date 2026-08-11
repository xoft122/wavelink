export interface MarqueeMotion {
  distancePx: number;
  durationMs: number;
  offsets: readonly [number, number, number, number, number];
}

const MARQUEE_SPEED_PX_PER_SECOND = 12;
const MARQUEE_END_PAUSE_MS = 1_000;
const MARQUEE_MIN_TRAVEL_MS = 1_500;

/**
 * Build a Spotify-like ping-pong timeline for overflowing metadata.
 * Returning null keeps short text completely static.
 */
export function calculateMarqueeMotion(
  overflowPx: number,
): MarqueeMotion | null {
  const distancePx = Math.ceil(Math.max(0, overflowPx));
  if (distancePx <= 1) return null;

  const travelMs = Math.max(
    MARQUEE_MIN_TRAVEL_MS,
    (distancePx / MARQUEE_SPEED_PX_PER_SECOND) * 1_000,
  );
  const durationMs = travelMs * 2 + MARQUEE_END_PAUSE_MS * 2;
  const firstPauseEnd = MARQUEE_END_PAUSE_MS / durationMs;
  const farEdgeArrival =
    (MARQUEE_END_PAUSE_MS + travelMs) / durationMs;
  const farEdgePauseEnd =
    (MARQUEE_END_PAUSE_MS * 2 + travelMs) / durationMs;

  return {
    distancePx,
    durationMs,
    offsets: [0, firstPauseEnd, farEdgeArrival, farEdgePauseEnd, 1],
  };
}
