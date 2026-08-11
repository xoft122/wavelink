import type { SoundCloudUrn } from "../types/soundcloud";

export const PLAY_HISTORY_RECORDED_EVENT = "wavelink:play-history-recorded";

export interface PlayHistoryRecordedDetail {
  trackUrn: SoundCloudUrn;
}

export interface PlayHistoryAttemptClaim {
  attemptedLoadId: number;
  trackUrn: SoundCloudUrn | null;
}

export function canonicalPlayHistoryTrackUrn(
  value: unknown,
): SoundCloudUrn | null {
  if (typeof value !== "string") return null;
  const match = value
    .trim()
    .match(/^(?:soundcloud:tracks:)?([0-9]{1,32})$/);
  return match ? `soundcloud:tracks:${match[1]}` : null;
}

/**
 * Claim one history mutation for an actual playback load. The player calls
 * this only after audio.play() succeeds; the generation check prevents a
 * stale play promise from recording whichever newer track is now selected.
 */
export function claimPlayHistoryAttempt(
  attemptedLoadId: number,
  expectedLoadId: number,
  currentLoadId: number,
  trackUrn: unknown,
): PlayHistoryAttemptClaim {
  const canonical = canonicalPlayHistoryTrackUrn(trackUrn);
  const validGeneration =
    Number.isSafeInteger(expectedLoadId) &&
    expectedLoadId >= 0 &&
    expectedLoadId === currentLoadId;
  if (
    !canonical ||
    !validGeneration ||
    attemptedLoadId === expectedLoadId
  ) {
    return { attemptedLoadId, trackUrn: null };
  }
  return { attemptedLoadId: expectedLoadId, trackUrn: canonical };
}

export function parsePlayHistoryRecordedDetail(
  value: unknown,
): PlayHistoryRecordedDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const trackUrn = canonicalPlayHistoryTrackUrn(
    (value as Record<string, unknown>).trackUrn,
  );
  return trackUrn ? { trackUrn } : null;
}

export function publishPlayHistoryRecorded(
  trackUrn: SoundCloudUrn,
  target: EventTarget = window,
): boolean {
  const detail = parsePlayHistoryRecordedDetail({ trackUrn });
  if (!detail) return false;
  target.dispatchEvent(
    new CustomEvent<PlayHistoryRecordedDetail>(
      PLAY_HISTORY_RECORDED_EVENT,
      { detail },
    ),
  );
  return true;
}

export function subscribePlayHistoryRecorded(
  handler: (detail: PlayHistoryRecordedDetail) => void,
  target: EventTarget = window,
): () => void {
  const listener: EventListener = (event) => {
    const detail = parsePlayHistoryRecordedDetail(
      (event as CustomEvent<unknown>).detail,
    );
    if (detail) handler(detail);
  };
  target.addEventListener(PLAY_HISTORY_RECORDED_EVENT, listener);
  return () =>
    target.removeEventListener(PLAY_HISTORY_RECORDED_EVENT, listener);
}
