import { useEffect, useState } from "react";

import type {
  PaginatedTrackSource,
  PaginatedTrackSourceSnapshot,
} from "../services/paginatedTrackSource";

/** Keep React views synchronized with a source that may also be advanced by
 * the global player/queue after the user starts playback. */
export function usePaginatedTrackSource(
  source: PaginatedTrackSource | null,
): PaginatedTrackSourceSnapshot | null {
  const [state, setState] = useState<{
    source: PaginatedTrackSource | null;
    snapshot: PaginatedTrackSourceSnapshot | null;
  }>(() => ({ source, snapshot: source?.getSnapshot() ?? null }));

  // Effects subscribe after render. If a query swaps sources quickly, never
  // expose the previous source's snapshot during that one-render gap.
  const snapshot =
    state.source === source
      ? state.snapshot
      : source?.getSnapshot() ?? null;

  useEffect(() => {
    if (!source) {
      setState({ source: null, snapshot: null });
      return;
    }
    setState({ source, snapshot: source.getSnapshot() });
    return source.subscribe((nextSnapshot) => {
      setState({ source, snapshot: nextSnapshot });
    });
  }, [source]);

  return snapshot;
}
