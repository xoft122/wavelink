import type { SCCollection, SCTrack } from "../types/soundcloud";

export const PROFILE_TRACK_BATCH_MAX_PAGES = 10;
export const PROFILE_TRACK_BATCH_MAX_TRACKS = 2_000;

export type ProfileTrackBatchStopReason =
  | "complete"
  | "page_limit"
  | "track_limit"
  | "repeated_cursor"
  | "stale";

export interface ProfileTrackPageSnapshot {
  tracks: SCTrack[];
  nextHref: string | null;
  pagesLoaded: number;
}

export interface ProfileTrackBatchResult extends ProfileTrackPageSnapshot {
  stopReason: ProfileTrackBatchStopReason;
}

interface LoadProfileTrackBatchOptions {
  tracks: readonly SCTrack[];
  nextHref: string | null;
  loadNext: (cursor: string) => Promise<SCCollection<SCTrack>>;
  maxPages?: number;
  maxTracks?: number;
  isCurrent?: () => boolean;
  onPage?: (snapshot: ProfileTrackPageSnapshot) => void;
}

function trackIdentity(track: SCTrack): string {
  return track.urn || track.id || track.permalink_url || "";
}

export function mergeUniqueProfileTracks(
  current: readonly SCTrack[],
  incoming: readonly SCTrack[],
): SCTrack[] {
  const merged: SCTrack[] = [];
  const seen = new Set<string>();
  for (const track of [...current, ...incoming]) {
    const identity = trackIdentity(track);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    merged.push(track);
  }
  return merged;
}

function positiveLimit(value: number, fallback: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Drain a large, bounded batch of an artist's track pages. Each successful
 * page is committed through onPage so a later network failure never discards
 * already-loaded tracks, and the failed cursor remains available for retry.
 */
export async function loadProfileTrackBatch({
  tracks: initialTracks,
  nextHref: initialNextHref,
  loadNext,
  maxPages = PROFILE_TRACK_BATCH_MAX_PAGES,
  maxTracks = PROFILE_TRACK_BATCH_MAX_TRACKS,
  isCurrent = () => true,
  onPage,
}: LoadProfileTrackBatchOptions): Promise<ProfileTrackBatchResult> {
  const pageLimit = positiveLimit(maxPages, PROFILE_TRACK_BATCH_MAX_PAGES);
  const trackLimit = positiveLimit(maxTracks, PROFILE_TRACK_BATCH_MAX_TRACKS);
  let tracks = mergeUniqueProfileTracks([], initialTracks);
  let nextHref = initialNextHref || null;
  let pagesLoaded = 0;
  const seenCursors = new Set<string>();

  while (
    nextHref &&
    pagesLoaded < pageLimit &&
    tracks.length < trackLimit
  ) {
    if (!isCurrent()) {
      return { tracks, nextHref, pagesLoaded, stopReason: "stale" };
    }
    if (seenCursors.has(nextHref)) {
      const snapshot = { tracks, nextHref: null, pagesLoaded };
      onPage?.(snapshot);
      return { ...snapshot, stopReason: "repeated_cursor" };
    }

    const requestedCursor = nextHref;
    seenCursors.add(requestedCursor);
    const page = await loadNext(requestedCursor);
    if (!isCurrent()) {
      return {
        tracks,
        nextHref: requestedCursor,
        pagesLoaded,
        stopReason: "stale",
      };
    }

    tracks = mergeUniqueProfileTracks(tracks, page.collection ?? []);
    pagesLoaded += 1;
    nextHref = page.next_href || null;
    if (nextHref && seenCursors.has(nextHref)) {
      const snapshot = { tracks, nextHref: null, pagesLoaded };
      onPage?.(snapshot);
      return { ...snapshot, stopReason: "repeated_cursor" };
    }
    onPage?.({ tracks, nextHref, pagesLoaded });
  }

  return {
    tracks,
    nextHref,
    pagesLoaded,
    stopReason: !nextHref
      ? "complete"
      : tracks.length >= trackLimit
        ? "track_limit"
        : "page_limit",
  };
}
