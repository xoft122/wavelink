export interface HorizontalRect {
  left: number;
  right: number;
}

export interface NativeTransportControlCenters {
  shuffle: number;
  repeat: number;
  queue: number;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Resolves WaveLink's extra controls around Spotify's untouched
 * Previous/Play/Next trio. Returned coordinates are relative to the transport
 * host, so the overlay never participates in the host's flex sizing.
 */
export function nativeTransportControlCenters(
  hostLeft: number,
  previous: HorizontalRect,
  playPause: HorizontalRect,
  next: HorizontalRect,
  controlSize = 32,
  fallbackGap = 8,
): NativeTransportControlCenters {
  const size = finitePositive(controlSize, 32);
  const fallbackStep = size + finitePositive(fallbackGap, 8);
  const previousCenter = (previous.left + previous.right) / 2;
  const playPauseCenter = (playPause.left + playPause.right) / 2;
  const nextCenter = (next.left + next.right) / 2;
  const candidateLeftStep = playPauseCenter - previousCenter;
  const candidateRightStep = nextCenter - playPauseCenter;
  const leftStep =
    Number.isFinite(candidateLeftStep) &&
    candidateLeftStep >= size &&
    candidateLeftStep <= 96
      ? candidateLeftStep
      : fallbackStep;
  const rightStep =
    Number.isFinite(candidateRightStep) &&
    candidateRightStep >= size &&
    candidateRightStep <= 96
      ? candidateRightStep
      : fallbackStep;
  const outerStep = (leftStep + rightStep) / 2;
  const origin = Number.isFinite(hostLeft) ? hostLeft : 0;
  const shuffle = previousCenter - origin - leftStep;
  const repeat = nextCenter - origin + rightStep;

  return {
    shuffle,
    repeat,
    queue: repeat + outerStep,
  };
}
