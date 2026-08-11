import React, { useCallback, useEffect, useState } from "react";
import { SCTrack } from "../types/soundcloud";
import { fetchNextPage, getLikedTracks } from "../services/api";
import { player } from "../services/player";
import { usePlayer } from "../hooks/usePlayer";
import { useLikedTracks } from "../hooks/useLikedTracks";
import { TrackItem } from "./TrackItem";
import { t } from "../i18n";

export function LikedTracksView() {
  const [tracks, setTracks] = useState<SCTrack[]>([]);
  const [nextHref, setNextHref] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const { track: activeTrack, isPlaying } = usePlayer();
  const { likedIds, toggleLike } = useLikedTracks();

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    setNextHref(null);
    void (async () => {
      try {
        const data = await getLikedTracks(50);
        setTracks(
          (data?.collection ?? [])
            .map((item) => item.track)
            .filter(Boolean) as SCTrack[],
        );
        setNextHref(data?.next_href ?? null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load liked tracks",
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, [retryKey]);

  const loadMore = useCallback(async () => {
    if (!nextHref || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const more = await fetchNextPage<{ track: SCTrack; created_at: string }>(
        nextHref,
      );
      const newTracks = (more.collection ?? [])
        .map((item) => item.track)
        .filter(Boolean) as SCTrack[];
      setTracks((prev) => [...prev, ...newTracks]);
      setNextHref(more.next_href ?? null);
    } catch {
      // ignore — user can click again
    } finally {
      setIsLoadingMore(false);
    }
  }, [nextHref, isLoadingMore]);

  const handlePlay = useCallback(
    (track: SCTrack) => {
      if (activeTrack?.id === track.id) {
        player.toggle();
      } else {
        player.setQueue(tracks, tracks.indexOf(track), {
          label: "Liked tracks",
          target: { kind: "main", tab: "library" },
        });
        void player.loadTrack(track);
      }
    },
    [tracks, activeTrack],
  );

  // When unliking from this view, remove the track from the displayed list.
  const handleLike = useCallback(
    async (track: SCTrack) => {
      const wasLiked = likedIds.has(track.id);
      const success = await toggleLike(track);
      if (wasLiked && success) {
        setTracks((prev) => prev.filter((t) => t.id !== track.id));
      }
    },
    [likedIds, toggleLike],
  );

  return (
    <div className="sc-view">
      <h2 className="sc-view__title">{t("view_liked")}</h2>
      {isLoading && (
        <div className="sc-spinner">
          <span />
          <span />
          <span />
        </div>
      )}
      {error && (
        <>
          <div className="sc-error">{error}</div>
          <div className="sc-load-more">
            <button
              className="sc-retry-btn"
              onClick={() => setRetryKey((k) => k + 1)}
            >
              Retry
            </button>
          </div>
        </>
      )}
      {!isLoading && !error && tracks.length === 0 && (
        <p className="sc-empty">{t("empty_liked")}</p>
      )}
      <div className="sc-track-list">
        {tracks.map((track) => (
          <TrackItem
            key={track.id}
            track={track}
            isActive={activeTrack?.id === track.id}
            isPlaying={activeTrack?.id === track.id && isPlaying}
            isLiked={likedIds.has(track.id)}
            onPlay={handlePlay}
            onLike={(t) => void handleLike(t)}
          />
        ))}
      </div>
      {nextHref && !error && (
        <div className="sc-load-more">
          <button
            className="sc-retry-btn"
            onClick={() => void loadMore()}
            disabled={isLoadingMore}
          >
            {isLoadingMore ? "…" : t("load_more")}
          </button>
        </div>
      )}
    </div>
  );
}
