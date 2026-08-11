import type { SCCollection, SCSearchResult, SCTrack } from "../types/soundcloud";
import {
  createPaginatedTrackSource,
  type PaginatedTrackSource,
  type PaginatedTrackSourceSnapshot,
} from "./paginatedTrackSource";

export const SEARCH_TRACK_RESULT_LIMIT = 300;

export interface CreateSearchTrackSourceOptions {
  initialPage: SCSearchResult;
  pageSize: number;
  loadPage: (cursor: string) => Promise<SCCollection<SCTrack>>;
}

function trackIdentity(track: SCTrack): string {
  return track.urn || track.id || track.permalink_url || "";
}

interface SearchTrackWindow {
  tracks: SCTrack[];
  consumed: number;
}

function takeTrackWindow(
  incoming: readonly SCTrack[],
  seen: Set<string>,
  limit: number,
): SearchTrackWindow {
  if (limit <= 0) return { tracks: [], consumed: 0 };

  const window = incoming.slice(0, limit);
  const accepted: SCTrack[] = [];
  for (const track of window) {
    const identity = trackIdentity(track);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    accepted.push(track);
  }
  return { tracks: accepted, consumed: window.length };
}

function cappedTotal(total: number | undefined, loaded: number): number {
  const value = Number(total);
  if (!Number.isFinite(value) || value < 0) return loaded;
  return Math.max(
    loaded,
    Math.min(SEARCH_TRACK_RESULT_LIMIT, Math.floor(value)),
  );
}

function projectSearchSnapshot(
  snapshot: PaginatedTrackSourceSnapshot,
): PaginatedTrackSourceSnapshot {
  const terminal =
    !snapshot.loading && !snapshot.error && snapshot.nextHref === null;
  return {
    ...snapshot,
    // SoundCloud's total_results can be much larger than WaveLink's bounded
    // search window. Once the source is terminal, only the actually reachable
    // unique rows belong in the queue total.
    totalCount: terminal
      ? snapshot.tracks.length
      : Math.max(
          snapshot.tracks.length,
          Math.min(SEARCH_TRACK_RESULT_LIMIT, snapshot.totalCount),
        ),
  };
}

/**
 * SoundCloud track search occasionally rejects a deep cursor around the 300th
 * result. WaveLink deliberately treats that late failure as the end of its
 * bounded search window. This gives the playback queue a clean hard boundary,
 * so normal related-track autoplay can take over instead of surfacing a page
 * retry error.
 *
 * The initial search request stays outside this factory. A failure before any
 * result has been received is therefore still reported by SearchView.
 */
export function createSearchTrackSource({
  initialPage,
  pageSize,
  loadPage,
}: CreateSearchTrackSourceOptions): PaginatedTrackSource {
  const seen = new Set<string>();
  const initialWindow = takeTrackWindow(
    Array.isArray(initialPage.collection) ? initialPage.collection : [],
    seen,
    SEARCH_TRACK_RESULT_LIMIT,
  );
  const initialTracks = initialWindow.tracks;
  let consumed = initialWindow.consumed;
  let accepted = initialTracks.length;
  const initialCursor =
    consumed >= SEARCH_TRACK_RESULT_LIMIT
      ? null
      : initialPage.next_href || null;

  const source = createPaginatedTrackSource({
    initialTracks,
    nextHref: initialCursor,
    totalCount: cappedTotal(initialPage.total_results, accepted),
    pageSize,
    mergeMode: "dedupe",
    loadPage: async (cursor) => {
      if (consumed >= SEARCH_TRACK_RESULT_LIMIT) {
        return {
          collection: [],
          next_href: null,
          total_results: accepted,
        };
      }

      try {
        const page = await loadPage(cursor);
        const pageWindow = takeTrackWindow(
          Array.isArray(page.collection) ? page.collection : [],
          seen,
          SEARCH_TRACK_RESULT_LIMIT - consumed,
        );
        consumed += pageWindow.consumed;
        accepted += pageWindow.tracks.length;

        return {
          ...page,
          collection: pageWindow.tracks,
          next_href:
            consumed >= SEARCH_TRACK_RESULT_LIMIT
              ? null
              : page.next_href || null,
          total_results: cappedTotal(page.total_results, accepted),
        };
      } catch (cause) {
        // Do not disguise an error when the source has never produced a
        // result. Once search results exist, a deep-page failure is the clean
        // end of WaveLink's intentionally bounded search window.
        if (accepted === 0) throw cause;
        return {
          collection: [],
          next_href: null,
          total_results: accepted,
        };
      }
    },
  });

  // Keep the cap/error policy structural so React and the cross-bundle player
  // see the same terminal cursor and exact total from their shared source.
  return {
    getSnapshot: () => projectSearchSnapshot(source.getSnapshot()),
    loadNext: () => source.loadNext().then(projectSearchSnapshot),
    subscribe: (listener) =>
      source.subscribe((snapshot) => listener(projectSearchSnapshot(snapshot))),
  };
}
