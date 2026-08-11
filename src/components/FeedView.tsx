import React, { useCallback, useEffect, useState } from "react";
import { SCStreamItem, SCTrack } from "../types/soundcloud";
import { fetchNextPage, getFeed } from "../services/api";
import { player } from "../services/player";
import { usePlayer } from "../hooks/usePlayer";
import { useLikedTracks } from "../hooks/useLikedTracks";
import { TrackItem } from "./TrackItem";
import { t } from "../i18n";

function extractTracks(items: SCStreamItem[]): SCTrack[] {
  return items
    .filter((item) => Boolean(item.track))
    .map((item) => item.track as SCTrack);
}

export function FeedView() {
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
        const feed = await getFeed(30);
        setTracks(extractTracks(feed?.collection ?? []));
        setNextHref(feed?.next_href ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load feed");
      } finally {
        setIsLoading(false);
      }
    })();
  }, [retryKey]);

  const loadMore = useCallback(async () => {
    if (!nextHref || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const more = await fetchNextPage<SCStreamItem>(nextHref);
      setTracks((prev) => [...prev, ...extractTracks(more.collection ?? [])]);
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
          label: "SoundCloud Feed",
          target: { kind: "main", tab: "home" },
        });
        void player.loadTrack(track);
      }
    },
    [tracks, activeTrack],
  );

  return (
    <div className="sc-view">
      <h2 className="sc-view__title">{t("view_feed")}</h2>
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
        <p className="sc-empty">{t("empty_feed")}</p>
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
            onLike={(t) => void toggleLike(t)}
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
