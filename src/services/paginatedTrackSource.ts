import type { SCCollection, SCTrack } from "../types/soundcloud";

export type PaginatedTrackMergeMode = "dedupe" | "preserve";

export interface PaginatedTrackSourceSnapshot {
  tracks: SCTrack[];
  nextHref: string | null;
  totalCount: number;
  pageSize: number;
  loading: boolean;
  error: string | null;
  revision: number;
}

export interface PaginatedTrackSource {
  getSnapshot(): PaginatedTrackSourceSnapshot;
  loadNext(): Promise<PaginatedTrackSourceSnapshot>;
  subscribe(
    listener: (snapshot: PaginatedTrackSourceSnapshot) => void,
  ): () => void;
}

export interface CreatePaginatedTrackSourceOptions {
  initialTracks?: readonly SCTrack[];
  nextHref?: string | null;
  totalCount?: number;
  pageSize: number;
  loadPage: (cursor: string) => Promise<SCCollection<SCTrack>>;
  mergeMode?: PaginatedTrackMergeMode;
}

const MAX_PAGE_SIZE = 200;

function normalizedPageSize(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(value)));
}

/** Zero-based loaded-row threshold at which the next page should be queued. */
export function paginationPrefetchIndex(
  loadedCount: number,
  pageSize: number,
): number {
  const loaded = Number.isFinite(loadedCount)
    ? Math.max(0, Math.floor(loadedCount))
    : 0;
  const distance = Math.max(1, Math.ceil(normalizedPageSize(pageSize) * 0.25));
  return Math.max(0, loaded - distance);
}

function normalizedTotalCount(value: number | undefined, loaded: number): number {
  const total = Number(value);
  return Number.isFinite(total) && total >= 0
    ? Math.max(loaded, Math.min(Math.floor(total), Number.MAX_SAFE_INTEGER))
    : loaded;
}

function trackIdentity(track: SCTrack): string {
  return track.urn || track.id || track.permalink_url || "";
}

function mergeTracks(
  current: readonly SCTrack[],
  incoming: readonly SCTrack[],
  mode: PaginatedTrackMergeMode,
): SCTrack[] {
  if (mode === "preserve") return [...current, ...incoming];

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

function errorMessage(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "Could not load more SoundCloud tracks.";
}

/**
 * Stateful cursor owner shared by a rendered collection and the playback
 * queue. Snapshots are immutable copies so consumers cannot mutate another
 * consumer's ordering or pagination state.
 */
export function createPaginatedTrackSource({
  initialTracks = [],
  nextHref = null,
  totalCount,
  pageSize,
  loadPage,
  mergeMode = "dedupe",
}: CreatePaginatedTrackSourceOptions): PaginatedTrackSource {
  let tracks = mergeTracks([], initialTracks, mergeMode);
  let cursor = nextHref || null;
  let total = normalizedTotalCount(totalCount, tracks.length);
  const size = normalizedPageSize(pageSize);
  let loading = false;
  let error: string | null = null;
  let revision = 0;
  let inFlight: Promise<PaginatedTrackSourceSnapshot> | null = null;
  const requestedCursors = new Set<string>();
  const listeners = new Set<
    (snapshot: PaginatedTrackSourceSnapshot) => void
  >();

  const snapshot = (): PaginatedTrackSourceSnapshot => ({
    tracks: [...tracks],
    nextHref: cursor,
    totalCount: Math.max(total, tracks.length),
    pageSize: size,
    loading,
    error,
    revision,
  });

  const publish = (): PaginatedTrackSourceSnapshot => {
    revision += 1;
    const value = snapshot();
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch {
        // One UI subscriber must not prevent queue hydration or other views.
      }
    }
    return value;
  };

  const source: PaginatedTrackSource = {
    getSnapshot: snapshot,

    loadNext(): Promise<PaginatedTrackSourceSnapshot> {
      if (inFlight) return inFlight;
      if (!cursor) return Promise.resolve(snapshot());

      const requestedCursor = cursor;
      if (requestedCursors.has(requestedCursor)) {
        cursor = null;
        error = null;
        return Promise.resolve(publish());
      }

      requestedCursors.add(requestedCursor);
      loading = true;
      error = null;
      publish();

      const pending = Promise.resolve()
        .then(() => loadPage(requestedCursor))
        .then((page) => {
          tracks = mergeTracks(
            tracks,
            Array.isArray(page.collection) ? page.collection : [],
            mergeMode,
          );
          if (Number.isFinite(page.total_results) && page.total_results! >= 0) {
            total = Math.max(
              total,
              normalizedTotalCount(page.total_results, tracks.length),
            );
          } else {
            total = Math.max(total, tracks.length);
          }

          const candidate = page.next_href || null;
          cursor =
            candidate && !requestedCursors.has(candidate) ? candidate : null;
          loading = false;
          error = null;
          return publish();
        })
        .catch((cause) => {
          // The exact cursor remains retryable. Remove it from the cycle guard
          // because no page was successfully consumed.
          requestedCursors.delete(requestedCursor);
          cursor = requestedCursor;
          loading = false;
          error = errorMessage(cause);
          publish();
          throw cause;
        })
        .finally(() => {
          if (inFlight === pending) inFlight = null;
        });

      inFlight = pending;
      return pending;
    },

    subscribe(
      listener: (snapshot: PaginatedTrackSourceSnapshot) => void,
    ): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  return source;
}
