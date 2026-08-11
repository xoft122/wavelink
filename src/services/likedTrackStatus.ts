import type { SoundCloudUrn } from "../types/soundcloud";

export const LIKED_TRACK_STATUS_EVENT = "wavelink:liked-track-status";

export interface LikedTrackStatusDetail {
  trackId: SoundCloudUrn;
  liked: boolean;
}

export function canonicalLikedTrackId(value: unknown): SoundCloudUrn | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(?:soundcloud:tracks:)?(\d+)$/);
  return match ? `soundcloud:tracks:${match[1]}` : null;
}

export function parseLikedTrackStatusDetail(
  value: unknown,
): LikedTrackStatusDetail | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const trackId = canonicalLikedTrackId(candidate.trackId);
  if (!trackId || typeof candidate.liked !== "boolean") return null;
  return { trackId, liked: candidate.liked };
}

export function publishLikedTrackStatus(
  trackId: SoundCloudUrn,
  liked: boolean,
  target: EventTarget = window,
): boolean {
  const detail = parseLikedTrackStatusDetail({ trackId, liked });
  if (!detail) return false;
  target.dispatchEvent(
    new CustomEvent<LikedTrackStatusDetail>(LIKED_TRACK_STATUS_EVENT, {
      detail,
    }),
  );
  return true;
}

export function subscribeLikedTrackStatus(
  handler: (detail: LikedTrackStatusDetail) => void,
  target: EventTarget = window,
): () => void {
  const listener: EventListener = (event) => {
    const detail = parseLikedTrackStatusDetail(
      (event as CustomEvent<unknown>).detail,
    );
    if (detail) handler(detail);
  };
  target.addEventListener(LIKED_TRACK_STATUS_EVENT, listener);
  return () => target.removeEventListener(LIKED_TRACK_STATUS_EVENT, listener);
}
