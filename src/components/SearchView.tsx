import React, { useCallback, useEffect, useRef, useState } from "react";

import { usePaginatedTrackSource } from "../hooks/usePaginatedTrackSource";
import { usePlayer } from "../hooks/usePlayer";
import {
  fetchNextPage,
  searchPlaylists,
  searchTracks,
  searchUsers,
} from "../services/api";
import type { WaveLinkSearchTab } from "../services/navigation";
import type { PaginatedTrackSource } from "../services/paginatedTrackSource";
import { createSearchTrackSource } from "../services/searchTrackSource";
import { SCPlaylist, SCTrack, SCUser } from "../types/soundcloud";
import {
  EntitySkeletonGrid,
  ErrorState,
  PlaylistCard,
  TrackSkeleton,
  UserCard,
} from "./EntityCards";
import { TrackCollection } from "./TrackCollection";

type SearchTab = WaveLinkSearchTab;

interface Bucket<T> {
  items: T[];
  nextHref: string | null;
  query: string;
  error: string | null;
}

interface SearchBuckets {
  tracks: Bucket<SCTrack>;
  playlists: Bucket<SCPlaylist>;
  users: Bucket<SCUser>;
}

const EMPTY_BUCKET = { items: [], nextHref: null, query: "", error: null };

const TABS: Array<{ id: SearchTab; label: string }> = [
  { id: "tracks", label: "Tracks" },
  { id: "playlists", label: "Playlists" },
  { id: "users", label: "People" },
];

interface Props {
  initialQuery?: string;
  initialDraft?: string;
  initialTab?: SearchTab;
  onOpenPlaylist: (playlist: SCPlaylist) => void;
  onOpenUser: (user: SCUser) => void;
  onStateChange?: (state: {
    query?: string;
    draft: string;
    tab: SearchTab;
  }) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Search failed. Please try again.";
}

export function SearchView({
  initialQuery = "",
  initialDraft,
  initialTab = "tracks",
  onOpenPlaylist,
  onOpenUser,
  onStateChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<SearchTab>(initialTab);
  const [query, setQuery] = useState(
    initialDraft === undefined ? initialQuery.trim() : initialDraft,
  );
  const [buckets, setBuckets] = useState<SearchBuckets>({
    tracks: { ...EMPTY_BUCKET },
    playlists: { ...EMPTY_BUCKET },
    users: { ...EMPTY_BUCKET },
  });
  const [loading, setLoading] = useState<SearchTab | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [trackSource, setTrackSource] =
    useState<PaginatedTrackSource | null>(null);
  const trackSnapshot = usePaginatedTrackSource(trackSource);
  const { tracksPerLoad } = usePlayer();
  const searchGeneration = useRef(0);
  const committedQuery = useRef(initialQuery.trim());

  const runSearch = useCallback(async (tab: SearchTab, rawQuery: string) => {
    const clean = rawQuery.trim();
    if (!clean) return;
    const generation = ++searchGeneration.current;
    setLoadingMore(false);
    setLoading(tab);
    if (tab === "tracks") {
      // The player retains its own reference if the old results are already
      // queued. The view must drop them immediately so a failed new query can
      // never be masked by the previous source snapshot.
      setTrackSource(null);
      setBuckets((current) => ({
        ...current,
        tracks: {
          items: [],
          nextHref: null,
          query: clean,
          error: null,
        },
      }));
    }
    try {
      if (tab === "tracks") {
        const data = await searchTracks(clean, tracksPerLoad);
        if (generation !== searchGeneration.current) return;
        const source = createSearchTrackSource({
          initialPage: data,
          pageSize: tracksPerLoad,
          loadPage: (cursor) => fetchNextPage<SCTrack>(cursor),
        });
        const initialSnapshot = source.getSnapshot();
        setTrackSource(source);
        setBuckets((current) => ({
          ...current,
          tracks: {
            items: initialSnapshot.tracks,
            nextHref: initialSnapshot.nextHref,
            query: clean,
            error: null,
          },
        }));
      } else if (tab === "playlists") {
        const data = await searchPlaylists(clean, 30);
        if (generation !== searchGeneration.current) return;
        setBuckets((current) => ({
          ...current,
          playlists: { items: data.collection ?? [], nextHref: data.next_href, query: clean, error: null },
        }));
      } else {
        const data = await searchUsers(clean, 30);
        if (generation !== searchGeneration.current) return;
        setBuckets((current) => ({
          ...current,
          users: { items: data.collection ?? [], nextHref: data.next_href, query: clean, error: null },
        }));
      }
    } catch (error) {
      if (generation !== searchGeneration.current) return;
      const message = errorMessage(error);
      setBuckets((current) => ({
        ...current,
        [tab]: { ...current[tab], query: clean, error: message },
      }));
    } finally {
      if (generation === searchGeneration.current) setLoading(null);
    }
  }, [tracksPerLoad]);

  useEffect(() => {
    const clean = initialQuery.trim();
    if (clean) void runSearch(initialTab, clean);
  }, [initialQuery, initialTab, runSearch]);

  const submit = (event?: React.FormEvent) => {
    event?.preventDefault();
    const clean = query.trim();
    committedQuery.current = clean;
    onStateChange?.({ query: clean || undefined, draft: query, tab: activeTab });
    void runSearch(activeTab, query);
  };

  const selectTab = (tab: SearchTab) => {
    setActiveTab(tab);
    const clean = query.trim();
    if (clean && buckets[tab].query !== clean) {
      committedQuery.current = clean;
      void runSearch(tab, clean);
    }
    onStateChange?.({
      query: committedQuery.current || undefined,
      draft: query,
      tab,
    });
  };

  const loadMore = async () => {
    const bucket = buckets[activeTab];
    if (!bucket.nextHref || loadingMore) return;
    const generation = searchGeneration.current;
    const tab = activeTab;
    const nextHref = bucket.nextHref;
    setLoadingMore(true);
    try {
      if (tab === "tracks") {
        if (!trackSource) return;
        await trackSource.loadNext();
      } else if (tab === "playlists") {
        const page = await fetchNextPage<SCPlaylist>(nextHref);
        if (generation !== searchGeneration.current) return;
        setBuckets((current) => ({
          ...current,
          playlists: {
            ...current.playlists,
            items: [...current.playlists.items, ...(page.collection ?? [])],
            nextHref: page.next_href,
          },
        }));
      } else {
        const page = await fetchNextPage<SCUser>(nextHref);
        if (generation !== searchGeneration.current) return;
        setBuckets((current) => ({
          ...current,
          users: {
            ...current.users,
            items: [...current.users.items, ...(page.collection ?? [])],
            nextHref: page.next_href,
          },
        }));
      }
    } catch (error) {
      if (generation !== searchGeneration.current) return;
      const message = errorMessage(error);
      setBuckets((current) => ({
        ...current,
        [tab]: { ...current[tab], error: message },
      }));
    } finally {
      if (generation === searchGeneration.current) setLoadingMore(false);
    }
  };

  const bucket =
    activeTab === "tracks" && trackSource && trackSnapshot
      ? {
          ...buckets.tracks,
          items: trackSnapshot.tracks,
          nextHref: trackSnapshot.nextHref,
          error: trackSnapshot.error,
        }
      : buckets[activeTab];
  const isLoading = loading === activeTab;
  const isLoadingMore =
    activeTab === "tracks" ? Boolean(trackSnapshot?.loading) : loadingMore;
  const hasSearched = Boolean(bucket.query);
  const blockingError = Boolean(bucket.error && bucket.items.length === 0);

  return (
    <div className="wl-page wl-search-page">
      <header className="wl-page-heading wl-page-heading--search">
        <span className="wl-eyebrow">SoundCloud catalog</span>
        <h1>Find your next favorite</h1>
        <p>Search tracks, playlists and creators without leaving Spotify.</p>
        <form className="wl-search-box" onSubmit={submit}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path fill="currentColor" d="m21.53 20.47-4.7-4.7A8 8 0 1 0 15.4 17.2l4.72 4.72a1 1 0 0 0 1.41-1.41ZM4 10a6 6 0 1 1 12 0 6 6 0 0 1-12 0Z" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => {
              const draft = event.target.value;
              setQuery(draft);
              onStateChange?.({
                query: committedQuery.current || undefined,
                draft,
                tab: activeTab,
              });
            }}
            placeholder="Artists, tracks or playlists"
            aria-label="Search SoundCloud"
            autoFocus
          />
          {query && (
            <button
              type="button"
              className="wl-search-box__clear"
              onClick={() => {
                searchGeneration.current++;
                setLoading(null);
                setLoadingMore(false);
                setTrackSource(null);
                setQuery("");
                committedQuery.current = "";
                onStateChange?.({ draft: "", tab: activeTab });
              }}
              aria-label="Clear search"
            >×</button>
          )}
          <button type="submit" className="wl-btn wl-btn--primary" disabled={!query.trim() || isLoading}>
            {isLoading ? "Searching…" : "Search"}
          </button>
        </form>
      </header>

      <div className="wl-tabs" role="tablist" aria-label="Search categories">
        {TABS.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "wl-tab wl-tab--active" : "wl-tab"}
            key={tab.id}
            onClick={() => selectTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="wl-search-results" aria-live="polite">
        {isLoading ? (
          activeTab === "tracks" ? <TrackSkeleton count={7} /> : <EntitySkeletonGrid count={8} />
        ) : blockingError ? (
          <ErrorState
            message={bucket.error ?? "Search failed. Please try again."}
            onRetry={() => void runSearch(activeTab, query)}
          />
        ) : !hasSearched ? (
          <div className="wl-search-prompt">
            <span aria-hidden="true">⌕</span>
            <strong>Search all of SoundCloud</strong>
            <p>Results come from SoundCloud through WaveLink&apos;s Spotify-only transport.</p>
          </div>
        ) : bucket.items.length === 0 ? (
          <div className="wl-state">
            <span className="wl-state__icon" aria-hidden="true">0</span>
            <div><strong>No {activeTab} found</strong><p>Try a different spelling or a broader search.</p></div>
          </div>
        ) : activeTab === "tracks" ? (
          <TrackCollection
            tracks={bucket.items as SCTrack[]}
            paginationSource={trackSource ?? undefined}
            onOpenUser={onOpenUser}
            context={{
              label: buckets.tracks.query
                ? `Search · ${buckets.tracks.query}`
                : "SoundCloud Search",
              target: {
                kind: "main",
                tab: "search",
                query: buckets.tracks.query || undefined,
              },
            }}
          />
        ) : activeTab === "playlists" ? (
          <div className="wl-entity-grid">
            {buckets.playlists.items.map((playlist) => (
              <PlaylistCard
                key={playlist.urn || playlist.id}
                playlist={playlist}
                onOpen={onOpenPlaylist}
                onOpenUser={onOpenUser}
              />
            ))}
          </div>
        ) : (
          <div className="wl-entity-grid wl-user-grid">
            {buckets.users.items.map((user) => (
              <UserCard key={user.urn || user.id} user={user} onOpen={onOpenUser} />
            ))}
          </div>
        )}

        {!isLoading && bucket.error && bucket.items.length > 0 ? (
          <div className="wl-inline-error" role="alert">{bucket.error}</div>
        ) : null}

        {!isLoading && bucket.nextHref && (
          <div className="wl-load-more">
            <button type="button" className="wl-btn wl-btn--quiet" onClick={() => void loadMore()} disabled={isLoadingMore}>
              {isLoadingMore
                ? "Loading…"
                : bucket.error
                  ? "Retry loading more"
                  : activeTab === "tracks"
                    ? `Load next ${tracksPerLoad}`
                    : "Load more"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
