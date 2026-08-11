import React, { useState } from "react";
import { useLikedTracks } from "../hooks/useLikedTracks";
import { usePlayer } from "../hooks/usePlayer";
import { WAVELINK_HEART_ICON } from "../services/panelActions";
import { player } from "../services/player";
import {
  isTrackUnavailable,
  trackUnavailableLabel,
} from "../services/trackAvailability";
import {
  SOUNDCLOUD_REPEAT_VIEW_BOX,
  soundCloudRepeatPaths,
} from "../services/soundCloudIcons";

const FALLBACK_ART =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 52 52'%3E%3Crect width='52' height='52' fill='%23333'/%3E%3Cpath d='M8 29c4 0 4-9 8-9s4 12 8 12 4-9 8-9 4 6 12 6' fill='none' stroke='%23ff5d54' stroke-width='3' stroke-linecap='round'/%3E%3C/svg%3E";

function fmtTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function ControlIcon({
  name,
  repeatMode = "off",
}: {
  name: "prev" | "next" | "play" | "pause" | "shuffle" | "repeat" | "queue";
  repeatMode?: "off" | "all" | "one";
}) {
  if (name === "play") {
    return <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M3 1.8v12.4a.8.8 0 0 0 1.2.7l9.6-6.2a.8.8 0 0 0 0-1.4L4.2 1.1A.8.8 0 0 0 3 1.8Z" /></svg>;
  }
  if (name === "pause") {
    return <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor"><path d="M2.5 1.5h4v13h-4zm7 0h4v13h-4z" /></svg>;
  }
  if (name === "shuffle") {
    return <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h3.4c5.2 0 5.4 10 10.6 10h4"/><path d="m18 14 3 3-3 3M3 17h3.4c1.7 0 2.8-1.1 3.8-2.7M14 7.7C14.9 7.3 15.8 7 17 7h4M18 4l3 3-3 3"/></svg>;
  }
  if (name === "repeat") {
    return (
      <svg
        viewBox={SOUNDCLOUD_REPEAT_VIEW_BOX}
        width="17"
        height="17"
        fill="currentColor"
        aria-hidden="true"
      >
        {soundCloudRepeatPaths(repeatMode === "one").map((path) => (
          <path key={path} d={path} />
        ))}
      </svg>
    );
  }
  if (name === "queue") {
    return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><path d="M4 6h11M4 11h11M4 16h7"/><path d="m16 14 4 2.5-4 2.5v-5Z"/></svg>;
  }
  const mirrored = name === "next";
  return <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" style={{ transform: mirrored ? "scaleX(-1)" : undefined }}><path d="M2 1.5h2v13H2zm2.8 6.5 8.7-6v12z" /></svg>;
}

export function NowPlaying() {
  const state = usePlayer();
  const [queueOpen, setQueueOpen] = useState(false);
  const { likedIds, toggleLike } = useLikedTracks();
  const track = state.track;
  if (!track) return null;

  const key = track.urn || track.id;
  const liked = likedIds.has(key);
  const currentSeconds = state.duration * state.position;
  const repeatLabel = state.repeat === "one" ? "Repeat one" : state.repeat === "all" ? "Repeat all" : "Repeat off";
  const cycleRepeat = () => {
    player.setRepeat(state.repeat === "off" ? "all" : state.repeat === "all" ? "one" : "off");
  };

  return (
    <section className="sc-now-playing" aria-label="WaveLink now playing">
      <div className="sc-now-playing__cover-slot">
        <div className="sc-now-playing__cover-wrap">
          <img
            className="sc-now-playing__cover"
            src={track.artwork_url?.replace("-large", "-t200x200") ?? FALLBACK_ART}
            alt=""
            onError={(event) => {
              event.currentTarget.src = FALLBACK_ART;
            }}
          />
        </div>
      </div>

      <div className="sc-now-playing__top">
        <div className="sc-now-playing__track-info">
          <a className="sc-now-playing__title" href={track.permalink_url} target="_blank" rel="noreferrer">
            {track.title}
          </a>
          <a className="sc-now-playing__artist" href={track.user.permalink_url} target="_blank" rel="noreferrer">
            {track.user.username} · SoundCloud
          </a>
        </div>
        <button
          className={`sc-now-playing__like${liked ? " sc-now-playing__like--active" : ""}`}
          type="button"
          onClick={() => void toggleLike(track)}
          aria-label={liked ? "Unlike on SoundCloud" : "Like on SoundCloud"}
        >
          <svg viewBox={WAVELINK_HEART_ICON.viewBox} width={WAVELINK_HEART_ICON.width} height={WAVELINK_HEART_ICON.height} fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth={WAVELINK_HEART_ICON.strokeWidth}><path d={WAVELINK_HEART_ICON.path} /></svg>
        </button>
        <button
          className="sc-now-playing__ctrl"
          type="button"
          onClick={() => {
            setQueueOpen(false);
            player.stop();
          }}
          aria-label="Close WaveLink player"
          title="Stop and close"
        >
          <svg viewBox="0 0 16 16" width="14" height="14" stroke="currentColor" strokeWidth="1.8"><path d="m3 3 10 10M13 3 3 13" /></svg>
        </button>
      </div>

      <div className="sc-now-playing__bottom">
        <div className="sc-now-playing__transport">
          <button
            className={`sc-now-playing__ctrl${state.shuffle ? " sc-now-playing__ctrl--active" : ""}`}
            type="button"
            onClick={() => player.setShuffle(!state.shuffle)}
            aria-label={state.shuffle ? "Disable shuffle" : "Enable shuffle"}
            aria-pressed={state.shuffle}
            title={state.shuffle ? "Shuffle on" : "Shuffle off"}
          >
            <ControlIcon name="shuffle" />
          </button>
          <button className="sc-now-playing__ctrl" type="button" onClick={() => void player.prev()} aria-label="Previous">
            <ControlIcon name="prev" />
          </button>
          <button className="sc-now-playing__ctrl sc-now-playing__ctrl--play" type="button" onClick={() => player.toggle()} aria-label={state.isPlaying ? "Pause" : "Play"}>
            <ControlIcon name={state.isPlaying ? "pause" : "play"} />
          </button>
          <button className="sc-now-playing__ctrl" type="button" onClick={() => void player.next()} aria-label="Next">
            <ControlIcon name="next" />
          </button>
          <button
            className={`sc-now-playing__ctrl${state.repeat !== "off" ? " sc-now-playing__ctrl--active" : ""}`}
            data-repeat={state.repeat}
            type="button"
            onClick={cycleRepeat}
            aria-label={repeatLabel}
            title={repeatLabel}
          >
            <ControlIcon name="repeat" repeatMode={state.repeat} />
          </button>
        </div>

        <span className="sc-now-playing__time">{fmtTime(currentSeconds)}</span>
        <input
          className="sc-now-playing__progress"
          type="range"
          min="0"
          max="1"
          step="0.001"
          value={Number.isFinite(state.position) ? state.position : 0}
          onChange={(event) => player.seek(Number(event.target.value))}
          aria-label="Playback position"
          style={{ "--progress-pct": `${Math.max(0, Math.min(1, state.position)) * 100}%` } as React.CSSProperties}
        />
        <span className="sc-now-playing__time">{fmtTime(state.duration)}</span>

        <div className="sc-now-playing__volume">
          <input
            className="sc-now-playing__vol-input"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={state.isMuted ? 0 : state.volume}
            onChange={(event) => player.setSyncedVolume(Number(event.target.value))}
            aria-label="WaveLink volume"
            style={{ "--vol-pct": `${(state.isMuted ? 0 : state.volume) * 100}%` } as React.CSSProperties}
          />
        </div>

        <button
          className={`sc-now-playing__ctrl sc-now-playing__queue-toggle${queueOpen ? " sc-now-playing__ctrl--active" : ""}`}
          type="button"
          onClick={() => setQueueOpen((value) => !value)}
          aria-label={`${queueOpen ? "Close" : "Open"} WaveLink queue`}
          aria-expanded={queueOpen}
          title="WaveLink queue"
        >
          <ControlIcon name="queue" />
          {state.queue.length > 0 && <span className="sc-now-playing__queue-count">{state.queue.length}</span>}
        </button>
      </div>

      {state.error && <div className="sc-now-playing__error">{state.error}</div>}
      {!state.error && state.notice && (
        <div className="sc-now-playing__notice">{state.notice}</div>
      )}

      {queueOpen && (
        <aside className="sc-queue" aria-label="WaveLink queue">
          <header className="sc-queue__header">
            <div>
              <strong>WaveLink queue</strong>
              <span>{state.queue.length} {state.queue.length === 1 ? "track" : "tracks"}</span>
            </div>
            <button type="button" className="sc-queue__close" onClick={() => setQueueOpen(false)} aria-label="Close queue">×</button>
          </header>

          <div className="sc-queue__settings">
            <button
              type="button"
              className={state.autoplayRelated ? "sc-queue__pill sc-queue__pill--active" : "sc-queue__pill"}
              onClick={() => player.setAutoplayRelated(!state.autoplayRelated)}
              aria-pressed={state.autoplayRelated}
            >
              Autoplay related {state.autoplayRelated ? "on" : "off"}
            </button>
            {state.queue.length > 1 && (
              <button type="button" className="sc-queue__clear" onClick={() => player.clearQueue(true)}>
                Clear upcoming
              </button>
            )}
          </div>

          <ol className="sc-queue__list">
            {state.queue.map((queuedTrack, index) => {
              const active = index === state.queueIndex;
              const unavailable = isTrackUnavailable(queuedTrack);
              const unavailableLabel = trackUnavailableLabel(queuedTrack);
              return (
                <li
                  className={`sc-queue__item${active ? " sc-queue__item--active" : ""}${unavailable ? " sc-queue__item--unavailable" : ""}`}
                  key={`${queuedTrack.urn || queuedTrack.id}-${index}`}
                >
                  <button
                    type="button"
                    className="sc-queue__main"
                    disabled={unavailable}
                    onClick={
                      unavailable
                        ? undefined
                        : () => void player.playQueueIndex(index)
                    }
                    aria-current={active ? "true" : undefined}
                    aria-label={
                      unavailable
                        ? `${queuedTrack.title}. ${unavailableLabel}`
                        : `Play ${queuedTrack.title}`
                    }
                  >
                    <img src={queuedTrack.artwork_url?.replace("-large", "-t50x50") ?? FALLBACK_ART} alt="" />
                    <span>
                      <strong>{queuedTrack.title}</strong>
                      <small>{queuedTrack.user.username}</small>
                      {unavailable && (
                        <small className="sc-queue__availability">
                          {unavailableLabel}
                        </small>
                      )}
                    </span>
                  </button>
                  <div className="sc-queue__actions">
                    <button type="button" onClick={() => player.reorderQueue(index, index - 1)} disabled={index === 0} aria-label={`Move ${queuedTrack.title} up`}>↑</button>
                    <button type="button" onClick={() => player.reorderQueue(index, index + 1)} disabled={index === state.queue.length - 1} aria-label={`Move ${queuedTrack.title} down`}>↓</button>
                    <button type="button" onClick={() => void player.removeFromQueue(index)} aria-label={`Remove ${queuedTrack.title} from queue`}>×</button>
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      )}
    </section>
  );
}
