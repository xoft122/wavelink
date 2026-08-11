import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { getFeed, getRecentlyPlayed } from "../services/api";
import {
  LocalPlayHistoryEntry,
  loadLocalPlayHistory,
  removeLocalPlayHistoryTrack,
  subscribeLocalPlayHistoryChanged,
} from "../services/localPlayHistory";
import { subscribePlayHistoryRecorded } from "../services/playHistoryStatus";
import {
  canExpandRecentHistory,
  visibleRecentHistory,
} from "../services/recentHistoryDisclosure";
import {
  isRenderablePlaylist,
  isRenderableTrack,
  SCPlaylist,
  SCStreamItem,
  SCTrack,
  SCUser,
} from "../types/soundcloud";
import {
  compactCount,
  EntitySkeletonGrid,
  ErrorState,
  PlaylistCard,
  TrackSkeleton,
} from "./EntityCards";
import { HistoryContextMenu } from "./HistoryContextMenu";
import { SoundCloudAvatar } from "./SoundCloudAvatar";
import { TrackCollection } from "./TrackCollection";

interface Props {
  user: SCUser;
  onOpenPlaylist: (playlist: SCPlaylist) => void;
  onOpenUser: (user: SCUser) => void;
  onOpenLibrary: () => void;
}

interface LoadState {
  recent: SCTrack[];
  feed: SCStreamItem[];
  recentError: string | null;
  feedError: string | null;
}

type HistorySource = "wavelink" | "soundcloud";

interface HistoryContextMenuState {
  track: SCTrack;
  clientX: number;
  clientY: number;
  playedAt: number;
  anchor: HTMLElement;
}

const INITIAL: LoadState = {
  recent: [],
  feed: [],
  recentError: null,
  feedError: null,
};

function message(error: unknown): string {
  return error instanceof Error ? error.message : "SoundCloud returned an unexpected response.";
}

function collection(value: unknown): unknown[] {
  if (!value || typeof value !== "object") return [];
  const items = (value as { collection?: unknown }).collection;
  return Array.isArray(items) ? items : [];
}

function recentTracks(value: unknown): SCTrack[] {
  return collection(value).flatMap((item) => {
    if (isRenderableTrack(item)) return [item];
    if (item && typeof item === "object") {
      const nested = (item as { track?: unknown }).track;
      if (isRenderableTrack(nested)) return [nested];
    }
    return [];
  });
}

function feedItems(value: unknown): SCStreamItem[] {
  return collection(value).filter((item): item is SCStreamItem => {
    if (!item || typeof item !== "object") return false;
    const entry = item as { track?: unknown; playlist?: unknown };
    return isRenderableTrack(entry.track) || isRenderablePlaylist(entry.playlist);
  });
}

export function HomeView({ user, onOpenPlaylist, onOpenUser, onOpenLibrary }: Props) {
  const [state, setState] = useState<LoadState>(INITIAL);
  const [localRecent, setLocalRecent] = useState<LocalPlayHistoryEntry[]>(
    loadLocalPlayHistory,
  );
  const [historySource, setHistorySource] =
    useState<HistorySource>("wavelink");
  const [expandedHistory, setExpandedHistory] = useState<Record<HistorySource, boolean>>({
    wavelink: false,
    soundcloud: false,
  });
  const [recentLoading, setRecentLoading] = useState(true);
  const [feedLoading, setFeedLoading] = useState(true);
  const [recentRetryKey, setRecentRetryKey] = useState(0);
  const [feedRetryKey, setFeedRetryKey] = useState(0);
  const [historyContextMenu, setHistoryContextMenu] =
    useState<HistoryContextMenuState | null>(null);
  const recentRequestGeneration = useRef(0);
  const historyDisclosureButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingCollapseScrollSource = useRef<HistorySource | null>(null);

  useEffect(() => {
    let active = true;
    const generation = ++recentRequestGeneration.current;
    setRecentLoading(true);
    void getRecentlyPlayed(100)
      .then((value) => {
        if (!active || generation !== recentRequestGeneration.current) return;
        setState((current) => ({
          ...current,
          recent: recentTracks(value),
          recentError: null,
        }));
      })
      .catch((cause) => {
        if (!active || generation !== recentRequestGeneration.current) return;
        setState((current) => ({
          ...current,
          recent: [],
          recentError: message(cause),
        }));
      })
      .finally(() => {
        if (active) setRecentLoading(false);
      });
    return () => {
      active = false;
    };
  }, [recentRetryKey]);

  useEffect(() => {
    let active = true;
    setFeedLoading(true);
    void getFeed(40)
      .then((value) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          feed: feedItems(value),
          feedError: null,
        }));
      })
      .catch((cause) => {
        if (!active) return;
        setState((current) => ({
          ...current,
          feed: [],
          feedError: message(cause),
        }));
      })
      .finally(() => {
        if (active) setFeedLoading(false);
      });
    return () => {
      active = false;
    };
  }, [feedRetryKey]);

  useEffect(() => {
    const refreshLocalRecent = () => {
      setLocalRecent(loadLocalPlayHistory());
    };
    const unsubscribe = subscribeLocalPlayHistoryChanged(refreshLocalRecent);
    // Cover a playback that started between the initial render and this
    // effect subscribing to the cross-bundle event.
    refreshLocalRecent();
    return unsubscribe;
  }, []);

  useEffect(() => {
    let active = true;
    let refreshInFlight = false;
    let trailingRefresh = false;

    const refreshRecent = () => {
      if (refreshInFlight) {
        trailingRefresh = true;
        return;
      }
      refreshInFlight = true;
      const generation = ++recentRequestGeneration.current;
      void getRecentlyPlayed(100)
        .then((value) => {
          if (!active || generation !== recentRequestGeneration.current) return;
          setRecentLoading(false);
          setState((current) => ({
            ...current,
            recent: recentTracks(value),
            recentError: null,
          }));
        })
        .catch((cause) => {
          if (!active || generation !== recentRequestGeneration.current) return;
          setRecentLoading(false);
          setState((current) => ({
            ...current,
            // A background refresh failure must not erase a known-good list.
            recentError:
              current.recent.length === 0
                ? message(cause)
                : current.recentError,
          }));
        })
        .finally(() => {
          if (!active) return;
          refreshInFlight = false;
          if (trailingRefresh) {
            trailingRefresh = false;
            refreshRecent();
          }
        });
    };

    const unsubscribe = subscribePlayHistoryRecorded(refreshRecent);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const feedTracks = useMemo(
    () => state.feed.flatMap((item) => (isRenderableTrack(item?.track) ? [item.track] : [])),
    [state.feed],
  );
  const feedPlaylists = useMemo(
    () => state.feed.flatMap((item) => (
      isRenderablePlaylist(item?.playlist) ? [item.playlist] : []
    )),
    [state.feed],
  );
  const localRecentTracks = useMemo(
    () => localRecent.map((entry) => entry.track),
    [localRecent],
  );
  const activeHistory =
    historySource === "wavelink" ? localRecentTracks : state.recent;
  const isHistoryExpanded = expandedHistory[historySource];
  const visibleHistory = visibleRecentHistory(activeHistory, isHistoryExpanded);
  const historyListId = `wl-history-list-${historySource}`;
  const historyEmptyMessage = historySource === "wavelink"
    ? "Tracks you play in WaveLink will appear here."
    : "Your SoundCloud listening history will appear here.";
  const historyContextLabel = historySource === "wavelink"
    ? "WaveLink history"
    : "SoundCloud history";

  const dismissHistoryContextMenu = useCallback(
    (restoreFocus = false) => {
      const anchor = historyContextMenu?.anchor;
      setHistoryContextMenu(null);
      if (restoreFocus && anchor?.isConnected) {
        window.requestAnimationFrame(() => {
          if (anchor.isConnected) anchor.focus({ preventScroll: true });
        });
      }
    },
    [historyContextMenu],
  );

  const openHistoryContextMenu = useCallback(
    (track: SCTrack, event: React.MouseEvent<HTMLDivElement>) => {
      const historyEntry = localRecent.find(
        (entry) => entry.track.urn === (track.urn || track.id),
      );
      if (!historyEntry) return;

      const anchorBounds = event.currentTarget.getBoundingClientRect();
      const hasPointerCoordinates = event.clientX !== 0 || event.clientY !== 0;
      setHistoryContextMenu({
        track,
        clientX: hasPointerCoordinates
          ? event.clientX
          : anchorBounds.left + Math.min(anchorBounds.width / 2, 80),
        clientY: hasPointerCoordinates
          ? event.clientY
          : anchorBounds.top + anchorBounds.height / 2,
        playedAt: historyEntry.playedAt,
        anchor: event.currentTarget,
      });
    },
    [localRecent],
  );

  const deleteHistoryTrack = useCallback((track: SCTrack, playedAt: number) => {
    if (!removeLocalPlayHistoryTrack(track.urn || track.id, playedAt)) {
      setLocalRecent(loadLocalPlayHistory());
      Spicetify.showNotification(
        "WaveLink: Could not delete this track from Recently played.",
        true,
      );
    }
    setHistoryContextMenu(null);
  }, []);

  useEffect(() => {
    setHistoryContextMenu(null);
  }, [historySource]);

  useLayoutEffect(() => {
    const collapsedSource = pendingCollapseScrollSource.current;
    if (!collapsedSource || expandedHistory[collapsedSource]) return;

    pendingCollapseScrollSource.current = null;
    if (collapsedSource !== historySource) return;

    const frame = window.requestAnimationFrame(() => {
      const button = historyDisclosureButtonRef.current;
      if (!button?.isConnected) return;

      button.scrollIntoView({
        behavior: "auto",
        block: "center",
        inline: "nearest",
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [expandedHistory, historySource]);

  return (
    <div className="wl-page wl-home">
      <section className="wl-account-hero">
        <div className="wl-account-hero__glow" aria-hidden="true" />
        <SoundCloudAvatar
          className="wl-account-hero__avatar"
          avatarUrl={user.avatar_url}
          preset="t500x500"
          alt=""
        />
        <div className="wl-account-hero__copy">
          <span className="wl-eyebrow">Your SoundCloud</span>
          <h1>Welcome back, {user.username}</h1>
          <p>{user.description || "Your feed, library and discoveries — together inside Spotify."}</p>
          <div className="wl-account-hero__stats" aria-label="SoundCloud account stats">
            <span><strong>{compactCount(user.followers_count)}</strong> followers</span>
            <span><strong>{compactCount(user.followings_count)}</strong> following</span>
            <span><strong>{compactCount(user.track_count)}</strong> tracks</span>
          </div>
          <div className="wl-account-hero__actions">
            <button type="button" className="wl-btn wl-btn--primary" onClick={onOpenLibrary}>
              Open your library
            </button>
            <a className="wl-btn wl-btn--quiet" href={user.permalink_url} target="_blank" rel="noreferrer">
              View on SoundCloud ↗
            </a>
          </div>
        </div>
      </section>

      <section className="wl-section wl-history">
        <div className="wl-section__heading wl-history__heading">
          <div>
            <span className="wl-eyebrow">Jump back in</span>
            <h2>Recently played</h2>
          </div>
          <div
            className="wl-tabs wl-history__tabs"
            role="tablist"
            aria-label="Recently played source"
          >
            {(["wavelink", "soundcloud"] as const).map((source) => (
              <button
                type="button"
                role="tab"
                id={`wl-history-tab-${source}`}
                aria-controls="wl-history-panel"
                aria-selected={historySource === source}
                className={
                  historySource === source
                    ? "wl-tab wl-tab--active"
                    : "wl-tab"
                }
                key={source}
                onClick={() => setHistorySource(source)}
              >
                {source === "wavelink" ? "WaveLink" : "SoundCloud"}
              </button>
            ))}
          </div>
        </div>
        <div
          className="wl-history__panel"
          id="wl-history-panel"
          role="tabpanel"
          aria-labelledby={`wl-history-tab-${historySource}`}
        >
          {historySource === "soundcloud" && recentLoading ? (
            <TrackSkeleton count={4} />
          ) : historySource === "soundcloud" && state.recentError ? (
            <ErrorState
              message={state.recentError}
              onRetry={() => setRecentRetryKey((key) => key + 1)}
            />
          ) : (
            <>
              <div id={historyListId}>
                <TrackCollection
                  tracks={visibleHistory}
                  queueTracks={activeHistory}
                  emptyMessage={historyEmptyMessage}
                  onOpenUser={onOpenUser}
                  onTrackContextMenu={
                    historySource === "wavelink"
                      ? openHistoryContextMenu
                      : undefined
                  }
                  context={{
                    label: historyContextLabel,
                    target: { kind: "main", tab: "home" },
                  }}
                />
              </div>
              {canExpandRecentHistory(activeHistory) && (
                <div className="wl-load-more wl-history__disclosure">
                  <button
                    ref={historyDisclosureButtonRef}
                    type="button"
                    className="wl-btn wl-btn--quiet"
                    aria-expanded={isHistoryExpanded}
                    aria-controls={historyListId}
                    onClick={() => {
                      pendingCollapseScrollSource.current = isHistoryExpanded
                        ? historySource
                        : null;
                      setExpandedHistory((current) => ({
                        ...current,
                        [historySource]: !current[historySource],
                      }));
                    }}
                  >
                    {isHistoryExpanded ? "Show less" : `Show all ${activeHistory.length}`}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {historyContextMenu && (
        <HistoryContextMenu
          track={historyContextMenu.track}
          clientX={historyContextMenu.clientX}
          clientY={historyContextMenu.clientY}
          playedAt={historyContextMenu.playedAt}
          onDelete={deleteHistoryTrack}
          onDismiss={dismissHistoryContextMenu}
        />
      )}

      <section className="wl-section">
        <div className="wl-section__heading">
          <div>
            <span className="wl-eyebrow">Fresh from SoundCloud</span>
            <h2>Your feed</h2>
          </div>
          {!feedLoading && (feedTracks.length > 0 || feedPlaylists.length > 0) && (
            <span className="wl-section__meta">
              {feedTracks.length + feedPlaylists.length} updates
            </span>
          )}
        </div>

        {feedLoading ? (
          <div className="wl-feed-columns">
            <TrackSkeleton count={5} />
            <EntitySkeletonGrid count={4} />
          </div>
        ) : state.feedError ? (
          <ErrorState
            message={state.feedError}
            onRetry={() => setFeedRetryKey((key) => key + 1)}
          />
        ) : state.feed.length === 0 ? (
          <div className="wl-state">
            <span className="wl-state__icon" aria-hidden="true">⌁</span>
            <div>
              <strong>Your feed is quiet</strong>
              <p>Follow more artists on SoundCloud and their new uploads will appear here.</p>
            </div>
          </div>
        ) : (
          <div className="wl-feed-columns">
            <div className="wl-feed-column">
              <h3>Tracks</h3>
              <TrackCollection
                tracks={feedTracks}
                onOpenUser={onOpenUser}
                context={{
                  label: "SoundCloud Feed",
                  target: { kind: "main", tab: "home" },
                }}
              />
            </div>
            <div className="wl-feed-column">
              <h3>Playlists</h3>
              {feedPlaylists.length > 0 ? (
                <div className="wl-entity-grid wl-entity-grid--feed">
                  {feedPlaylists.map((playlist) => (
                    <PlaylistCard
                      key={playlist.urn || playlist.id}
                      playlist={playlist}
                      compact
                      onOpen={onOpenPlaylist}
                      onOpenUser={onOpenUser}
                    />
                  ))}
                </div>
              ) : (
                <p className="wl-empty">No playlist updates in this page of your feed.</p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
