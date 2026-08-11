import React, { useEffect, useRef, useState } from "react";
import { SCPlaylist, SCTrack } from "../types/soundcloud";
import { fetchNextPage, getPlaylist, getPlaylists } from "../services/api";
import { player } from "../services/player";
import { usePlayer } from "../hooks/usePlayer";
import { useLikedTracks } from "../hooks/useLikedTracks";
import { TrackItem } from "./TrackItem";
import { t } from "../i18n";

const FALLBACK_ART =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 44'%3E%3Crect width='44' height='44' fill='%23333'/%3E%3Ccircle cx='22' cy='22' r='8' fill='%23ff5500' opacity='.6'/%3E%3Ccircle cx='22' cy='22' r='3' fill='%23ff5500'/%3E%3C/svg%3E";

export function PlaylistsView() {
  const [playlists, setPlaylists] = useState<SCPlaylist[]>([]);
  const [detail, setDetail] = useState<SCPlaylist | null>(null);
  const [nextHref, setNextHref] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openReqId = useRef(0);
  const { track: activeTrack, isPlaying } = usePlayer();
  const { likedIds, toggleLike } = useLikedTracks();

  useEffect(() => {
    void (async () => {
      try {
        const data = await getPlaylists(20);
        setPlaylists(data?.collection ?? []);
        setNextHref(data?.next_href ?? null);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load playlists",
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const loadMore = async () => {
    if (!nextHref || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await fetchNextPage<SCPlaylist>(nextHref);
      setPlaylists((current) => [...current, ...(page.collection ?? [])]);
      setNextHref(page.next_href ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load more playlists");
    } finally {
      setIsLoadingMore(false);
    }
  };

  const openPlaylist = async (pl: SCPlaylist) => {
    const reqId = ++openReqId.current;
    setIsLoadingDetail(true);
    try {
      const full = await getPlaylist(pl.id);
      if (reqId !== openReqId.current) return; // stale — user clicked another playlist
      setDetail(full);
    } catch {
      if (reqId !== openReqId.current) return;
      setDetail(pl);
    } finally {
      if (reqId === openReqId.current) setIsLoadingDetail(false);
    }
  };

  const handlePlay = (track: SCTrack) => {
    if (!detail) return;
    if (activeTrack?.id === track.id) {
      player.toggle();
    } else {
      player.setQueue(detail.tracks, detail.tracks.indexOf(track), {
        label: detail.title,
        target: { kind: "playlist", playlist: detail },
      });
      void player.loadTrack(track);
    }
  };

  // ── Playlist detail ────────────────────────────────────────────────────────
  if (detail) {
    return (
      <div className="sc-view">
        <button className="sc-back-btn" onClick={() => setDetail(null)}>
          ← {t("back")}
        </button>
        <h2 className="sc-view__title">{detail.title}</h2>
        <p className="sc-view__subtitle">
          {detail.user.username} ·{" "}
          {t("track_count", String(detail.tracks_count))}
        </p>
        <div className="sc-track-list">
          {detail.tracks.map((track) => (
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
      </div>
    );
  }

  // ── Playlist grid ──────────────────────────────────────────────────────────
  return (
    <div className="sc-view">
      <h2 className="sc-view__title">{t("view_sets")}</h2>
      {(isLoading || isLoadingDetail) && (
        <div className="sc-spinner">
          <span />
          <span />
          <span />
        </div>
      )}
      {error && <div className="sc-error">{error}</div>}
      {!isLoading && !error && playlists.length === 0 && (
        <p className="sc-empty">{t("empty_sets")}</p>
      )}
      <div className="sc-playlist-grid">
        {playlists.map((pl) => (
          <div
            key={pl.id}
            className="sc-playlist-card"
            onClick={() => void openPlaylist(pl)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => e.key === "Enter" && void openPlaylist(pl)}
            aria-label={`Open playlist ${pl.title}`}
          >
            <img
              src={
                pl.artwork_url?.replace("-large", "-t300x300") ?? FALLBACK_ART
              }
              alt=""
              className="sc-playlist-card__art"
              onError={(e) => {
                (e.target as HTMLImageElement).src = FALLBACK_ART;
              }}
            />
            <div className="sc-playlist-card__info">
              <span className="sc-playlist-card__title">{pl.title}</span>
              <span className="sc-playlist-card__count">
                {t("track_count", String(pl.tracks_count))}
              </span>
            </div>
          </div>
        ))}
      </div>
      {nextHref && !error && (
        <div className="sc-load-more">
          <button
            className="sc-retry-btn"
            type="button"
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
