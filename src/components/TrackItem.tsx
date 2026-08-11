import React, { useEffect, useId, useState } from "react";
import { isRenderableTrack, SCTrack, SCUser } from "../types/soundcloud";
import { getTrack } from "../services/api";
import { showSoundCloudTrackRepostPrompt } from "../services/followPrompt";
import { WAVELINK_HEART_ICON } from "../services/panelActions";
import { player } from "../services/player";
import {
  isTrackUnavailable,
  trackUnavailableLabel,
} from "../services/trackAvailability";
import { useExternalActionRefresh } from "../hooks/useExternalActionRefresh";
import {
  soundCloudTrackArtworkUrl,
  WAVELINK_TRACK_FALLBACK_ARTWORK,
} from "../services/trackArtwork";

function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const PlayIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    width="20"
    height="20"
    aria-hidden="true"
  >
    <path d="m7.05 3.606 13.49 7.788a.7.7 0 0 1 0 1.212L7.05 20.394A.7.7 0 0 1 6 19.788V4.212a.7.7 0 0 1 1.05-.606" />
  </svg>
);

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg
    viewBox={WAVELINK_HEART_ICON.viewBox}
    fill={filled ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth={WAVELINK_HEART_ICON.strokeWidth}
    width={WAVELINK_HEART_ICON.width}
    height={WAVELINK_HEART_ICON.height}
    aria-hidden="true"
  >
    <path d={WAVELINK_HEART_ICON.path} />
  </svg>
);

const SoundCloudIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden="true">
    <path d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z" />
  </svg>
);

interface Props {
  track: SCTrack;
  isActive: boolean;
  isPlaying: boolean;
  isLiked?: boolean;
  onPlay: (track: SCTrack) => void;
  onLike?: (track: SCTrack) => void;
  onOpenUser?: (user: SCUser) => void;
  onContextMenu?: (
    track: SCTrack,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
}

export function TrackItem({
  track,
  isActive,
  isPlaying,
  isLiked,
  onPlay,
  onLike,
  onOpenUser,
  onContextMenu,
}: Props) {
  const accessibilityId = useId();
  const [reposted, setReposted] = useState(Boolean(track?.reposted_by_user));
  const [actionError, setActionError] = useState<string | null>(null);
  const repostRefresh = useExternalActionRefresh(
    async () => {
      const refreshed = await getTrack(track.urn || track.id);
      setReposted(Boolean(refreshed.reposted_by_user));
      setActionError(null);
    },
    (cause) => {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Could not refresh this repost.",
      );
    },
  );

  useEffect(() => {
    setReposted(Boolean(track?.reposted_by_user));
  }, [track?.id, track?.reposted_by_user, track?.urn]);

  if (!isRenderableTrack(track)) return null;
  const unavailable = isTrackUnavailable(track);
  const unavailableLabel = trackUnavailableLabel(track);
  const titleId = `${accessibilityId}-title`;
  const artistId = `${accessibilityId}-artist`;
  const availabilityId = `${accessibilityId}-availability`;
  const artwork = soundCloudTrackArtworkUrl(track.artwork_url, "t67x67");

  return (
    <div
      className={`sc-track${isActive ? " sc-track--active" : ""}${unavailable ? " sc-track--unavailable" : ""}`}
      onClick={unavailable ? undefined : () => onPlay(track)}
      onContextMenu={(event) => {
        if (!onContextMenu) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu(track, event);
      }}
      role={unavailable ? "group" : "button"}
      tabIndex={unavailable ? undefined : 0}
      aria-haspopup={onContextMenu ? "menu" : undefined}
      aria-labelledby={
        unavailable ? `${titleId} ${artistId}` : undefined
      }
      aria-describedby={unavailable ? availabilityId : undefined}
      onKeyDown={(e) => {
        if (
          !unavailable &&
          e.target === e.currentTarget &&
          e.key === "Enter"
        ) {
          onPlay(track);
        }
      }}
      aria-label={
        unavailable
          ? undefined
          : `${isActive && isPlaying ? "Pause" : "Play"} ${track.title} by ${track.user.username}`
      }
    >
      <div className="sc-track__art-wrap">
        <img
          src={artwork}
          alt=""
          className="sc-track__art"
          onError={(e) => {
            const image = e.currentTarget;
            if (image.getAttribute("src") !== WAVELINK_TRACK_FALLBACK_ARTWORK) {
              image.src = WAVELINK_TRACK_FALLBACK_ARTWORK;
            }
          }}
        />
        {!unavailable && isActive ? (
          <div
            className={`sc-track__indicator${isPlaying ? " sc-track__indicator--playing" : ""}`}
            aria-hidden="true"
          >
            {isPlaying ? (
              <>
                <span />
                <span />
                <span />
              </>
            ) : (
              <PlayIcon />
            )}
          </div>
        ) : !unavailable ? (
          <div className="sc-track__hover-play" aria-hidden="true">
            <PlayIcon />
          </div>
        ) : null}
      </div>

      <div className="sc-track__info">
        <span
          id={titleId}
          className="sc-track__title sc-track__link"
          title={track.title}
        >
          {track.title}
        </span>
        <a
          id={artistId}
          className="sc-track__artist sc-track__link"
          href={track.user.permalink_url}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.stopPropagation();
            if (onOpenUser) {
              event.preventDefault();
              onOpenUser(track.user);
            }
          }}
          title={onOpenUser ? "Open profile in WaveLink" : "Open the uploader on SoundCloud"}
        >
          {track.user.username}
        </a>
        {unavailable && (
          <span
            id={availabilityId}
            className="sc-track__availability"
          >
            {unavailableLabel}
          </span>
        )}
      </div>

      <a
        className="sc-track__source"
        href={track.sharing === "private" ? track.user.permalink_url : track.permalink_url}
        target="_blank"
        rel="noreferrer"
        onClick={(event) => event.stopPropagation()}
        aria-label="Source: SoundCloud"
        title="Source: SoundCloud"
      >
        <SoundCloudIcon />
      </a>

      <div className="sc-track__quick-actions" aria-label={`Actions for ${track.title}`}>
        <button
          type="button"
          disabled={unavailable}
          onClick={(event) => {
            event.stopPropagation();
            if (unavailable) return;
            player.playNext(track);
          }}
          aria-label={`Play ${track.title} next`}
          title="Play next"
        >
          <span aria-hidden="true">+1</span>
        </button>
        <button
          type="button"
          disabled={unavailable}
          onClick={(event) => {
            event.stopPropagation();
            if (unavailable) return;
            if (!player.getState().track) {
              setActionError("Start a SoundCloud track before adding to its queue.");
              return;
            }
            setActionError(null);
            player.addToQueue(track);
          }}
          aria-label={`Add ${track.title} to queue`}
          title={actionError ?? "Add to queue"}
        >
          <span aria-hidden="true">≡+</span>
        </button>
        <button
          type="button"
          className={reposted ? "sc-track__repost--active" : undefined}
          disabled={repostRefresh.refreshing}
          onClick={(event) => {
            event.stopPropagation();
            setActionError(null);
            showSoundCloudTrackRepostPrompt(
              track.sharing === "private"
                ? { ...track, permalink_url: track.user.permalink_url }
                : track,
              reposted,
              { onOpen: repostRefresh.requestRefresh },
            );
          }}
          aria-haspopup="dialog"
          aria-label={reposted ? `Remove repost of ${track.title}` : `Repost ${track.title}`}
          title={actionError ?? (reposted ? "Manage repost on SoundCloud" : "Repost on SoundCloud")}
        >
          <span aria-hidden="true">↻</span>
        </button>
      </div>

      <span className="sc-track__duration">{fmtDuration(track.duration)}</span>

      {onLike && (
        <button
          className={`sc-track__like-btn${isLiked ? " sc-track__like-btn--liked" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onLike(track);
          }}
          aria-label={isLiked ? "Unlike" : "Like"}
          title={isLiked ? "Unlike" : "Like"}
          type="button"
        >
          <HeartIcon filled={isLiked ?? false} />
        </button>
      )}
    </div>
  );
}
