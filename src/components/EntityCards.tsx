import React from "react";

import {
  isRenderablePlaylist,
  isRenderableUser,
  SCPlaylist,
  SCUser,
} from "../types/soundcloud";
import { SoundCloudAvatar } from "./SoundCloudAvatar";

const FALLBACK_PLAYLIST =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 240 240'%3E%3Cdefs%3E%3ClinearGradient id='g' x1='0' y1='0' x2='1' y2='1'%3E%3Cstop stop-color='%23262626'/%3E%3Cstop offset='1' stop-color='%23ff5500'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='240' height='240' fill='url(%23g)'/%3E%3Cpath d='M46 130c24 0 24-50 48-50s24 76 48 76 24-50 48-50' fill='none' stroke='white' stroke-width='13' stroke-linecap='round' opacity='.9'/%3E%3C/svg%3E";

export function compactCount(value?: number): string {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

function safeImage(event: React.SyntheticEvent<HTMLImageElement>, fallback: string) {
  const image = event.currentTarget;
  if (image.src !== fallback) image.src = fallback;
}

interface PlaylistCardProps {
  playlist: SCPlaylist;
  onOpen: (playlist: SCPlaylist) => void;
  onOpenUser?: (user: SCUser) => void;
  compact?: boolean;
}

export function PlaylistCard({
  playlist,
  onOpen,
  onOpenUser,
  compact = false,
}: PlaylistCardProps) {
  if (!isRenderablePlaylist(playlist)) return null;
  const artwork =
    playlist.artwork_url?.replace("-large", "-t300x300") ?? FALLBACK_PLAYLIST;
  const trackCount = playlist.tracks_count ?? playlist.track_count ?? 0;

  return (
    <article className={`wl-entity-card${compact ? " wl-entity-card--compact" : ""}`}>
      <button
        type="button"
        className="wl-entity-card__main"
        onClick={() => onOpen(playlist)}
        aria-label={`Open playlist ${playlist.title}`}
      >
        <span className="wl-entity-card__art-wrap">
          <img
            className="wl-entity-card__art"
            src={artwork}
            alt=""
            onError={(event) => safeImage(event, FALLBACK_PLAYLIST)}
          />
          <span className="wl-entity-card__play" aria-hidden="true">▶</span>
        </span>
        <span className="wl-entity-card__copy">
          <strong>{playlist.title}</strong>
          <small>{compactCount(trackCount)} tracks</small>
        </span>
      </button>
      <div className="wl-entity-card__footer">
        <button
          type="button"
          className="wl-text-action"
          onClick={() => onOpenUser?.(playlist.user)}
          disabled={!onOpenUser}
        >
          {playlist.user.username}
        </button>
        <a
          href={playlist.permalink_url}
          target="_blank"
          rel="noreferrer"
          className="wl-source-link"
          aria-label={`Open ${playlist.title} on SoundCloud`}
          title="Open on SoundCloud"
        >
          SoundCloud ↗
        </a>
      </div>
    </article>
  );
}

interface UserCardProps {
  user: SCUser;
  onOpen: (user: SCUser) => void;
}

export function UserCard({ user, onOpen }: UserCardProps) {
  if (!isRenderableUser(user)) return null;
  return (
    <article className="wl-entity-card wl-user-card">
      <button
        type="button"
        className="wl-entity-card__main"
        onClick={() => onOpen(user)}
        aria-label={`Open profile ${user.username}`}
      >
        <span className="wl-entity-card__art-wrap wl-user-card__avatar-wrap">
          <SoundCloudAvatar
            className="wl-entity-card__art wl-user-card__avatar"
            avatarUrl={user.avatar_url}
            preset="t500x500"
            alt=""
          />
        </span>
        <span className="wl-entity-card__copy">
          <strong>{user.username}{user.verified ? " ✓" : ""}</strong>
          <small>{compactCount(user.followers_count)} followers</small>
        </span>
      </button>
      <div className="wl-entity-card__footer">
        <span>{user.city || user.country || "SoundCloud artist"}</span>
        <a
          href={user.permalink_url}
          target="_blank"
          rel="noreferrer"
          className="wl-source-link"
          aria-label={`Open ${user.username} on SoundCloud`}
        >
          SoundCloud ↗
        </a>
      </div>
    </article>
  );
}

export function EntitySkeletonGrid({ count = 6 }: { count?: number }) {
  return (
    <div className="wl-entity-grid" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="wl-entity-card wl-skeleton-card" key={index}>
          <div className="wl-skeleton wl-skeleton--art" />
          <div className="wl-skeleton wl-skeleton--line" />
          <div className="wl-skeleton wl-skeleton--line wl-skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export function TrackSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="wl-track-skeleton" aria-label="Loading" aria-busy="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="wl-track-skeleton__row" key={index}>
          <div className="wl-skeleton wl-track-skeleton__art" />
          <div>
            <div className="wl-skeleton wl-skeleton--line" />
            <div className="wl-skeleton wl-skeleton--line wl-skeleton--short" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry?: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="wl-state wl-state--error" role="alert">
      <span className="wl-state__icon" aria-hidden="true">!</span>
      <div>
        <strong>Couldn’t load this section</strong>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button type="button" className="wl-btn wl-btn--quiet" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
