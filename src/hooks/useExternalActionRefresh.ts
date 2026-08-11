import { useCallback, useEffect, useRef, useState } from "react";

export interface ExternalActionRefreshState {
  requestRefresh: () => void;
  pending: boolean;
  refreshing: boolean;
}

/**
 * Refreshes protected SoundCloud state only after the user returns from the
 * public SoundCloud page opened by a WaveLink handoff prompt.
 */
export function useExternalActionRefresh(
  refresh: () => Promise<void>,
  onError?: (cause: unknown) => void,
): ExternalActionRefreshState {
  const refreshRef = useRef(refresh);
  const onErrorRef = useRef(onError);
  const pendingRef = useRef(false);
  const inFlightRef = useRef(false);
  const generationRef = useRef(0);
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  refreshRef.current = refresh;
  onErrorRef.current = onError;

  const requestRefresh = useCallback(() => {
    generationRef.current += 1;
    pendingRef.current = true;
    setPending(true);
  }, []);

  const refreshAfterReturn = useCallback(() => {
    if (
      !pendingRef.current ||
      inFlightRef.current ||
      document.visibilityState === "hidden"
    ) {
      return;
    }

    const generation = generationRef.current;
    inFlightRef.current = true;
    setRefreshing(true);

    void refreshRef.current()
      .then(() => {
        if (generationRef.current !== generation) return;
        pendingRef.current = false;
        setPending(false);
      })
      .catch((cause) => {
        // Keep the request pending so another focus/visibility event can retry.
        onErrorRef.current?.(cause);
      })
      .finally(() => {
        inFlightRef.current = false;
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    if (!pending) return;

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAfterReturn();
    };

    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pending, refreshAfterReturn]);

  return { requestRefresh, pending, refreshing };
}
