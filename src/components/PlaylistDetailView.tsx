import React, { useEffect, useRef, useState } from "react";

import { useExternalActionRefresh } from "../hooks/useExternalActionRefresh";
import { usePaginatedTrackSource } from "../hooks/usePaginatedTrackSource";
import { usePlayer } from "../hooks/usePlayer";
import {
  getPlaylistTrackSource,
  isPlaylistLiked,
  unlikePlaylist,
} from "../services/api";
import {
  showSoundCloudEditPlaylistPrompt,
  showSoundCloudPlaylistLikePrompt,
  showSoundCloudPlaylistRepostPrompt,
} from "../services/followPrompt";
import { player } from "../services/player";
import { PaginatedTrackSource } from "../services/paginatedTrackSource";
import { isTrackUnavailable } from "../services/trackAvailability";
import { SCPlaylist, SCUser } from "../types/soundcloud";
import { compactCount, ErrorState, TrackSkeleton } from "./EntityCards";
import { SoundCloudAvatar } from "./SoundCloudAvatar";
import { TrackCollection } from "./TrackCollection";

const FALLBACK_ART =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 320 320'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%23262626'/%3E%3Cstop offset='1' stop-color='%23ff5500'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='320' height='320' fill='url(%23g)'/%3E%3Cpath d='M63 174c31 0 31-66 62-66s31 99 62 99 31-66 62-66' fill='none' stroke='white' stroke-width='16' stroke-linecap='round'/%3E%3C/svg%3E";

interface Props {
  playlist: SCPlaylist;
  currentUserUrn?: string;
  onBack: () => void;
  onOpenUser: (user: SCUser) => void;
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "";
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hr ${minutes % 60} min`;
}

export function PlaylistDetailView({ playlist, currentUserUrn, onBack, onOpenUser }: Props) {
  const [detail, setDetail] = useState<SCPlaylist>(playlist);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [liked, setLiked] = useState(Boolean(playlist.user_favorite));
  const [reposted, setReposted] = useState(Boolean(playlist.reposted_by_user));
  const [actionBusy, setActionBusy] = useState<"like" | null>(null);
  const [trackSource, setTrackSource] =
    useState<PaginatedTrackSource | null>(null);
  const [playPreparing, setPlayPreparing] = useState(false);
  const trackSnapshot = usePaginatedTrackSource(trackSource);
  const { tracksPerLoad } = usePlayer();
  const [actionError, setActionError] = useState<string | null>(null);
  const detailRequestGenerationRef = useRef(0);

  useEffect(() => {
    let active = true;
    const generation = ++detailRequestGenerationRef.current;
    setLoading(true);
    setError(null);
    const playlistKey = playlist.urn || playlist.id;
    void Promise.all([
      getPlaylistTrackSource(playlistKey, tracksPerLoad),
      isPlaylistLiked(playlistKey, {
        force: playlist.user_favorite === true,
      }).catch(() => null),
    ])
      .then(([result, isLiked]) => {
        if (active && detailRequestGenerationRef.current === generation) {
          const { playlist: value, source } = result;
          const resolvedLiked =
            isLiked ??
            (playlist.user_favorite === true || value.user_favorite === true);
          setDetail({ ...value, user_favorite: resolvedLiked });
          setTrackSource(source);
          setLiked(resolvedLiked);
          setReposted(Boolean(value.reposted_by_user));
        }
      })
      .catch((cause) => {
        if (active && detailRequestGenerationRef.current === generation) {
          setError(cause instanceof Error ? cause.message : "Could not load this playlist.");
        }
      })
      .finally(() => {
        if (active && detailRequestGenerationRef.current === generation) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [playlist.id, playlist.urn, playlist.user_favorite, retryKey, tracksPerLoad]);

  const externalRefresh = useExternalActionRefresh(
    async () => {
      const generation = ++detailRequestGenerationRef.current;
      const playlistKey = playlist.urn || playlist.id;
      const [result, isLiked] = await Promise.all([
        getPlaylistTrackSource(playlistKey, tracksPerLoad),
        isPlaylistLiked(playlistKey, { force: true }),
      ]);
      if (detailRequestGenerationRef.current !== generation) return;
      const { playlist: value, source } = result;
      setDetail({ ...value, user_favorite: isLiked });
      setTrackSource(source);
      setLiked(isLiked);
      setReposted(Boolean(value.reposted_by_user));
      setActionError(null);
      setError(null);
      setLoading(false);
    },
    (cause) => {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh this playlist.",
      );
    },
  );

  const tracks = trackSnapshot?.tracks ?? (Array.isArray(detail.tracks) ? detail.tracks : []);
  const firstAvailableTrackIndex = tracks.findIndex(
    (track) => !isTrackUnavailable(track),
  );
  const artwork = detail.artwork_url?.replace("-large", "-t500x500") ?? FALLBACK_ART;
  const isOwner = (detail.user.urn || detail.user.id) === currentUserUrn;

  const playAll = async () => {
    if (playPreparing) return;
    setPlayPreparing(true);
    try {
      let snapshot = trackSource?.getSnapshot() ?? null;
      let availableTracks = snapshot?.tracks ?? tracks;
      let availableIndex = availableTracks.findIndex(
        (track) => !isTrackUnavailable(track),
      );
      while (availableIndex < 0 && snapshot?.nextHref) {
        snapshot = await trackSource!.loadNext();
        availableTracks = snapshot.tracks;
        availableIndex = availableTracks.findIndex(
          (track) => !isTrackUnavailable(track),
        );
      }
      if (availableIndex < 0) return;
      const context = {
        label: detail.title,
        target: { kind: "playlist", playlist: detail } as const,
      };
      if (trackSource) {
        player.setQueueFromSource(trackSource, availableIndex, context);
      } else {
        player.setQueue(availableTracks, availableIndex, context);
      }
      await player.loadTrack(availableTracks[availableIndex]);
    } finally {
      setPlayPreparing(false);
    }
  };

  const toggleLike = async () => {
    if (actionBusy || loading || externalRefresh.refreshing) return;
    if (!liked) {
      setActionError(null);
      showSoundCloudPlaylistLikePrompt(detail, {
        onOpen: externalRefresh.requestRefresh,
      });
      return;
    }
    setActionBusy("like");
    setActionError(null);
    try {
      await unlikePlaylist(detail.urn || detail.id);
      detailRequestGenerationRef.current += 1;
      setLiked(false);
      setDetail((current) => ({ ...current, user_favorite: false }));
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Could not update this like.");
    } finally {
      setActionBusy(null);
    }
  };

  const toggleRepost = () => {
    if (actionBusy || externalRefresh.refreshing) return;
    setActionError(null);
    showSoundCloudPlaylistRepostPrompt(detail, reposted, {
      onOpen: externalRefresh.requestRefresh,
    });
  };

  return (
    <div className="wl-page wl-detail-page">
      <button type="button" className="wl-back" onClick={onBack}>← Back</button>

      <section className="wl-detail-hero wl-detail-hero--playlist">
        <img
          className="wl-detail-hero__art"
          src={artwork}
          alt=""
          onError={(event) => { event.currentTarget.src = FALLBACK_ART; }}
        />
        <div className="wl-detail-hero__copy">
          <span className="wl-eyebrow">SoundCloud playlist</span>
          <h1>{detail.title}</h1>
          {detail.description && <p className="wl-detail-hero__description">{detail.description}</p>}
          <div className="wl-detail-hero__byline">
            <button type="button" className="wl-profile-link" onClick={() => onOpenUser(detail.user)}>
              <SoundCloudAvatar
                avatarUrl={detail.user.avatar_url}
                preset="t50x50"
                alt=""
              />
              {detail.user.username}
            </button>
            <span>•</span>
            <span>{compactCount(detail.tracks_count ?? detail.track_count)} tracks</span>
            {detail.duration > 0 && <><span>•</span><span>{formatDuration(detail.duration)}</span></>}
          </div>
          <div className="wl-detail-hero__actions">
            <button
              type="button"
              className="wl-btn wl-btn--primary wl-btn--play"
              onClick={() => void playAll()}
              disabled={
                loading ||
                playPreparing ||
                (firstAvailableTrackIndex < 0 && !trackSnapshot?.nextHref)
              }
            >
              <span aria-hidden="true">▶</span>{" "}
              {playPreparing ? "Preparing…" : "Play"}
            </button>
            <a className="wl-btn wl-btn--quiet" href={detail.permalink_url} target="_blank" rel="noreferrer">
              Open on SoundCloud ↗
            </a>
            <button type="button" className={liked ? "wl-btn wl-btn--quiet wl-btn--active" : "wl-btn wl-btn--quiet"} onClick={() => void toggleLike()} disabled={loading || Boolean(actionBusy) || externalRefresh.refreshing} aria-haspopup={liked ? undefined : "dialog"}>
              {liked ? "♥ Liked" : "♡ Like"}
            </button>
            {!isOwner && (
              <button type="button" className={reposted ? "wl-btn wl-btn--quiet wl-btn--active" : "wl-btn wl-btn--quiet"} onClick={toggleRepost} disabled={Boolean(actionBusy) || externalRefresh.refreshing} aria-haspopup="dialog">
                {reposted ? "↻ Reposted" : "↻ Repost"}
              </button>
            )}
            {isOwner && (
              <button
                type="button"
                className="wl-btn wl-btn--quiet"
                disabled={externalRefresh.refreshing}
                aria-haspopup="dialog"
                onClick={() => {
                  setActionError(null);
                  showSoundCloudEditPlaylistPrompt(detail, {
                    onOpen: externalRefresh.requestRefresh,
                  });
                }}
              >
                Edit playlist
              </button>
            )}
          </div>
          {actionError && <div className="wl-inline-error" role="alert">{actionError}</div>}
        </div>
      </section>

      <section className="wl-section wl-detail-tracks">
        <div className="wl-section__heading">
          <div><span className="wl-eyebrow">Tracklist</span><h2>{detail.title}</h2></div>
        </div>
        {loading ? (
          <TrackSkeleton count={8} />
        ) : error ? (
          <ErrorState message={error} onRetry={() => setRetryKey((key) => key + 1)} />
        ) : (
          <TrackCollection
            tracks={tracks}
            paginationSource={trackSource ?? undefined}
            emptyMessage="This playlist has no playable tracks."
            onOpenUser={onOpenUser}
            context={{
              label: detail.title,
              target: { kind: "playlist", playlist: detail },
            }}
          />
        )}
        {!loading && trackSnapshot?.error ? (
          <div className="wl-load-more">
            <button
              type="button"
              className="wl-btn wl-btn--quiet"
              disabled={trackSnapshot.loading}
              onClick={() => void trackSource?.loadNext().catch(() => {})}
            >
              Retry loading the next {tracksPerLoad}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
