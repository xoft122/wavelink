import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  getLikedTrackIds,
  invalidateLikedTrackIds,
  unlikeTrack,
} from "../services/api";
import { showSoundCloudLikePrompt } from "../services/followPrompt";
import {
  canonicalLikedTrackId,
  publishLikedTrackStatus,
  subscribeLikedTrackStatus,
} from "../services/likedTrackStatus";
import { SCTrack, SoundCloudUrn } from "../types/soundcloud";

type LikeableTrack = Pick<
  SCTrack,
  "id" | "urn" | "title" | "permalink_url"
>;

interface LikedTracksValue {
  likedIds: Set<SoundCloudUrn>;
  toggleLike: (track: LikeableTrack) => Promise<boolean>;
}

const LikedTracksContext = createContext<LikedTracksValue | null>(null);

// Mount one provider for the whole custom app so every WaveLink view shares
// the same SoundCloud like state and refresh lifecycle.
export function LikedTracksProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [likedIds, setLikedIds] = useState<Set<SoundCloudUrn>>(new Set());
  const externalRefreshPendingRef = useRef<Set<SoundCloudUrn>>(new Set());
  const externalRefreshInFlightRef = useRef(false);
  const pendingUnlikeIdsRef = useRef<Set<SoundCloudUrn>>(new Set());
  const refreshGenerationRef = useRef(0);

  const refreshLikedIds = useCallback(async (
    force = false,
    publishPending = false,
  ): Promise<boolean> => {
    const generation = ++refreshGenerationRef.current;
    try {
      const ids = await getLikedTrackIds({ force });
      if (generation !== refreshGenerationRef.current) return false;
      setLikedIds(ids);
      if (publishPending) {
        for (const trackId of externalRefreshPendingRef.current) {
          publishLikedTrackStatus(trackId, ids.has(trackId));
        }
        externalRefreshPendingRef.current.clear();
      }
      return true;
    } catch {
      // Preserve the last known heart state if SoundCloud is temporarily down.
      return false;
    }
  }, []);

  useEffect(() => {
    void refreshLikedIds();
  }, [refreshLikedIds]);

  useEffect(() => {
    const refreshAfterReturn = () => {
      if (
        externalRefreshPendingRef.current.size === 0 ||
        document.visibilityState === "hidden" ||
        externalRefreshInFlightRef.current
      ) {
        return;
      }
      externalRefreshInFlightRef.current = true;
      void refreshLikedIds(true, true).finally(() => {
        externalRefreshInFlightRef.current = false;
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAfterReturn();
    };
    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshLikedIds]);

  useEffect(
    () =>
      subscribeLikedTrackStatus(({ trackId, liked }) => {
        refreshGenerationRef.current += 1;
        invalidateLikedTrackIds();
        setLikedIds((current) => {
          const next = new Set(current);
          if (liked) next.add(trackId);
          else next.delete(trackId);
          return next;
        });
      }),
    [],
  );

  useEffect(() => {
    const resetForCredentials = () => {
      refreshGenerationRef.current += 1;
      externalRefreshPendingRef.current.clear();
      pendingUnlikeIdsRef.current.clear();
      invalidateLikedTrackIds();
      setLikedIds(new Set());
      void refreshLikedIds(true);
    };
    window.addEventListener("wavelink:settings", resetForCredentials);
    return () =>
      window.removeEventListener("wavelink:settings", resetForCredentials);
  }, [refreshLikedIds]);

  const toggleLike = useCallback(
    async (track: LikeableTrack): Promise<boolean> => {
      const trackId =
        canonicalLikedTrackId(track.urn || track.id) ||
        track.urn ||
        track.id;
      const wasLiked = likedIds.has(trackId);

      if (!wasLiked) {
        showSoundCloudLikePrompt(track, {
          onOpen: () => {
            externalRefreshPendingRef.current.add(trackId);
            invalidateLikedTrackIds();
          },
        });
        return false;
      }

      if (pendingUnlikeIdsRef.current.has(trackId)) return false;
      pendingUnlikeIdsRef.current.add(trackId);
      refreshGenerationRef.current += 1;
      setLikedIds((current) => {
        const next = new Set(current);
        next.delete(trackId);
        return next;
      });

      try {
        await unlikeTrack(trackId);
        publishLikedTrackStatus(trackId, false);
        return true;
      } catch (cause) {
        console.warn("[WaveLink] unlike failed:", cause);
        Spicetify.showNotification(
          "WaveLink: SoundCloud could not remove this like.",
          true,
          5_000,
        );
        setLikedIds((current) => {
          const next = new Set(current);
          next.add(trackId);
          return next;
        });
        return false;
      } finally {
        pendingUnlikeIdsRef.current.delete(trackId);
      }
    },
    [likedIds],
  );

  return React.createElement(
    LikedTracksContext.Provider,
    { value: { likedIds, toggleLike } },
    children,
  );
}

export function useLikedTracks(): LikedTracksValue {
  const context = useContext(LikedTracksContext);
  if (!context) {
    throw new Error(
      "useLikedTracks must be rendered inside LikedTracksProvider",
    );
  }
  return context;
}
