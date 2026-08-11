import React, { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchNextPage,
  getFollowings,
  getLikedPlaylists,
  getLikedTracks,
  getPlaylists,
} from "../services/api";
import { showSoundCloudCreatePlaylistPrompt } from "../services/followPrompt";
import { useExternalActionRefresh } from "../hooks/useExternalActionRefresh";
import type { WaveLinkLibraryTab } from "../services/navigation";
import { SCPlaylist, SCTrack, SCUser } from "../types/soundcloud";
import {
  EntitySkeletonGrid,
  ErrorState,
  PlaylistCard,
  TrackSkeleton,
  UserCard,
} from "./EntityCards";
import { TrackCollection } from "./TrackCollection";

type LibraryTab = WaveLinkLibraryTab;

interface Page<T> {
  items: T[];
  nextHref: string | null;
  loaded: boolean;
  error: string | null;
}

interface LibraryState {
  likedTracks: Page<SCTrack>;
  playlists: Page<SCPlaylist>;
  likedPlaylists: Page<SCPlaylist>;
  followings: Page<SCUser>;
}

type LibraryKey = keyof LibraryState;

const emptyPage = <T,>(): Page<T> => ({
  items: [],
  nextHref: null,
  loaded: false,
  error: null,
});

const TABS: Array<{ id: LibraryTab; label: string }> = [
  { id: "liked-tracks", label: "Liked tracks" },
  { id: "playlists", label: "Your playlists" },
  { id: "liked-playlists", label: "Liked playlists" },
  { id: "followings", label: "Following" },
];

const tabRecord = <T,>(value: T): Record<LibraryTab, T> => ({
  "liked-tracks": value,
  playlists: value,
  "liked-playlists": value,
  followings: value,
});

function keyForTab(tab: LibraryTab): LibraryKey {
  if (tab === "liked-tracks") return "likedTracks";
  if (tab === "liked-playlists") return "likedPlaylists";
  return tab;
}

interface Props {
  initialTab?: LibraryTab;
  onOpenPlaylist: (playlist: SCPlaylist) => void;
  onOpenUser: (user: SCUser) => void;
  onTabChange?: (tab: LibraryTab) => void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Could not load your SoundCloud library.";
}

export function LibraryView({
  initialTab = "liked-tracks",
  onOpenPlaylist,
  onOpenUser,
  onTabChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<LibraryTab>(initialTab);
  const [loadingTabs, setLoadingTabs] = useState<Set<LibraryTab>>(() => new Set());
  const [loadingMoreTabs, setLoadingMoreTabs] = useState<Set<LibraryTab>>(() => new Set());
  const [state, setState] = useState<LibraryState>({
    likedTracks: emptyPage(),
    playlists: emptyPage(),
    likedPlaylists: emptyPage(),
    followings: emptyPage(),
  });

  // Render state alone cannot guard requests because closures can outlive a tab
  // switch. These per-tab refs prevent duplicate fetches and reject stale data.
  const loadedRef = useRef(tabRecord(false));
  const inFlightRef = useRef(tabRecord(false));
  const paginationInFlightRef = useRef(tabRecord(false));
  const generationRef = useRef(tabRecord(0));

  const markTab = useCallback((
    setter: React.Dispatch<React.SetStateAction<Set<LibraryTab>>>,
    tab: LibraryTab,
    value: boolean,
  ) => {
    setter((current) => {
      const next = new Set(current);
      if (value) next.add(tab);
      else next.delete(tab);
      return next;
    });
  }, []);

  const load = useCallback(async (tab: LibraryTab, force = false) => {
    if (!force && (loadedRef.current[tab] || inFlightRef.current[tab])) {
      return false;
    }

    const key = keyForTab(tab);
    const generation = ++generationRef.current[tab];
    inFlightRef.current[tab] = true;

    // A complete reload supersedes any page request already running for the tab.
    paginationInFlightRef.current[tab] = false;
    markTab(setLoadingMoreTabs, tab, false);
    markTab(setLoadingTabs, tab, true);

    try {
      if (tab === "liked-tracks") {
        const data = await getLikedTracks(80);
        if (generationRef.current[tab] !== generation) return false;
        const tracks = (data.collection ?? []).flatMap((item) => item.track ? [item.track] : []);
        setState((current) => ({
          ...current,
          likedTracks: { items: tracks, nextHref: data.next_href, loaded: true, error: null },
        }));
      } else if (tab === "playlists") {
        const data = await getPlaylists(40);
        if (generationRef.current[tab] !== generation) return false;
        setState((current) => ({
          ...current,
          playlists: { items: data.collection ?? [], nextHref: data.next_href, loaded: true, error: null },
        }));
      } else if (tab === "liked-playlists") {
        const data = await getLikedPlaylists(40);
        if (generationRef.current[tab] !== generation) return false;
        setState((current) => ({
          ...current,
          likedPlaylists: { items: data.collection ?? [], nextHref: data.next_href, loaded: true, error: null },
        }));
      } else {
        const data = await getFollowings(60);
        if (generationRef.current[tab] !== generation) return false;
        setState((current) => ({
          ...current,
          followings: { items: data.collection ?? [], nextHref: data.next_href, loaded: true, error: null },
        }));
      }
      loadedRef.current[tab] = true;
      return true;
    } catch (error) {
      if (generationRef.current[tab] !== generation) return false;
      const errorText = message(error);
      loadedRef.current[tab] = true;
      setState((current) => ({
        ...current,
        [key]: { ...current[key], loaded: true, error: errorText },
      }));
      return false;
    } finally {
      if (generationRef.current[tab] === generation) {
        inFlightRef.current[tab] = false;
        markTab(setLoadingTabs, tab, false);
      }
    }
  }, [markTab]);

  const playlistCreateRefresh = useExternalActionRefresh(
    async () => {
      setActiveTab("playlists");
      onTabChange?.("playlists");
      const refreshed = await load("playlists", true);
      if (!refreshed) {
        throw new Error("Could not refresh your SoundCloud playlists.");
      }
    },
  );

  useEffect(() => {
    void load(activeTab);
  }, [activeTab, load]);

  const loadMore = async (tab: LibraryTab) => {
    const key = keyForTab(tab);
    const page = state[key];
    if (!page.nextHref || inFlightRef.current[tab] || paginationInFlightRef.current[tab]) return;

    const nextHref = page.nextHref;
    const generation = generationRef.current[tab];
    paginationInFlightRef.current[tab] = true;
    markTab(setLoadingMoreTabs, tab, true);

    try {
      if (tab === "liked-tracks") {
        const result = await fetchNextPage<{ track: SCTrack; created_at: string | null }>(nextHref);
        if (generationRef.current[tab] !== generation) return;
        const tracks = (result.collection ?? []).flatMap((item) => item.track ? [item.track] : []);
        setState((current) => ({
          ...current,
          likedTracks: {
            ...current.likedTracks,
            items: [...current.likedTracks.items, ...tracks],
            nextHref: result.next_href,
          },
        }));
      } else if (tab === "playlists") {
        const result = await fetchNextPage<SCPlaylist>(nextHref);
        if (generationRef.current[tab] !== generation) return;
        setState((current) => ({
          ...current,
          playlists: {
            ...current.playlists,
            items: [...current.playlists.items, ...(result.collection ?? [])],
            nextHref: result.next_href,
          },
        }));
      } else if (tab === "liked-playlists") {
        const result = await fetchNextPage<SCPlaylist>(nextHref);
        if (generationRef.current[tab] !== generation) return;
        setState((current) => ({
          ...current,
          likedPlaylists: {
            ...current.likedPlaylists,
            items: [...current.likedPlaylists.items, ...(result.collection ?? [])],
            nextHref: result.next_href,
          },
        }));
      } else {
        const result = await fetchNextPage<SCUser>(nextHref);
        if (generationRef.current[tab] !== generation) return;
        setState((current) => ({
          ...current,
          followings: {
            ...current.followings,
            items: [...current.followings.items, ...(result.collection ?? [])],
            nextHref: result.next_href,
          },
        }));
      }
    } catch (error) {
      if (generationRef.current[tab] !== generation) return;
      const errorText = message(error);
      setState((current) => ({ ...current, [key]: { ...current[key], error: errorText } }));
    } finally {
      if (generationRef.current[tab] === generation) {
        paginationInFlightRef.current[tab] = false;
        markTab(setLoadingMoreTabs, tab, false);
      }
    }
  };

  const current = activeTab === "liked-tracks"
    ? state.likedTracks
    : activeTab === "liked-playlists"
      ? state.likedPlaylists
      : state[activeTab];
  const isLoading = loadingTabs.has(activeTab);
  const isLoadingMore = loadingMoreTabs.has(activeTab);

  return (
    <div className="wl-page wl-library-page">
      <header className="wl-page-heading">
        <span className="wl-eyebrow">Saved on SoundCloud</span>
        <h1>Your library</h1>
        <p>Everything you’ve liked, created and followed — synced from your account.</p>
        <button
          type="button"
          className="wl-btn wl-btn--primary wl-page-heading__action"
          disabled={playlistCreateRefresh.refreshing}
          aria-haspopup="dialog"
          onClick={() => {
            showSoundCloudCreatePlaylistPrompt({
              onOpen: playlistCreateRefresh.requestRefresh,
            });
          }}
        >
          {playlistCreateRefresh.refreshing ? "Refreshing playlists..." : "+ New playlist"}
        </button>
      </header>

      <div className="wl-tabs wl-tabs--wrap" role="tablist" aria-label="Library categories">
        {TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "wl-tab wl-tab--active" : "wl-tab"}
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              onTabChange?.(tab.id);
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="wl-library-content" aria-live="polite">
        {isLoading || !current.loaded ? (
          activeTab === "liked-tracks" ? <TrackSkeleton count={8} /> : <EntitySkeletonGrid count={8} />
        ) : current.error ? (
          <ErrorState message={current.error} onRetry={() => void load(activeTab, true)} />
        ) : current.items.length === 0 ? (
          <div className="wl-state">
            <span className="wl-state__icon" aria-hidden="true">♡</span>
            <div>
              <strong>Nothing here yet</strong>
              <p>Your {TABS.find((tab) => tab.id === activeTab)?.label.toLowerCase()} will appear here.</p>
            </div>
          </div>
        ) : activeTab === "liked-tracks" ? (
          <TrackCollection
            tracks={state.likedTracks.items}
            onOpenUser={onOpenUser}
            context={{
              label: "Liked tracks",
              target: { kind: "main", tab: "library" },
            }}
          />
        ) : activeTab === "followings" ? (
          <div className="wl-entity-grid wl-user-grid">
            {state.followings.items.map((user) => (
              <UserCard key={user.urn || user.id} user={user} onOpen={onOpenUser} />
            ))}
          </div>
        ) : (
          <div className="wl-entity-grid">
            {(activeTab === "playlists" ? state.playlists.items : state.likedPlaylists.items).map((playlist) => (
              <PlaylistCard
                key={playlist.urn || playlist.id}
                playlist={playlist}
                onOpen={onOpenPlaylist}
                onOpenUser={onOpenUser}
              />
            ))}
          </div>
        )}

        {!isLoading && !current.error && current.nextHref && (
          <div className="wl-load-more">
            <button type="button" className="wl-btn wl-btn--quiet" onClick={() => void loadMore(activeTab)} disabled={isLoadingMore}>
              {isLoadingMore ? "Loading…" : "Load more"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
