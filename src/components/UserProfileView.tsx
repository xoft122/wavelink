import React, { useCallback, useEffect, useRef, useState } from "react";

import { usePaginatedTrackSource } from "../hooks/usePaginatedTrackSource";
import { usePlayer } from "../hooks/usePlayer";
import {
  fetchNextPage,
  getUser,
  getUserLikedTracks,
  getUserPlaylists,
  getUserTracks,
  isFollowingUser,
} from "../services/api";
import { showSoundCloudFollowPrompt } from "../services/followPrompt";
import type { WaveLinkProfileTab } from "../services/navigation";
import {
  createPaginatedTrackSource,
  PaginatedTrackSource,
} from "../services/paginatedTrackSource";
import { SCPlaylist, SCTrack, SCUser } from "../types/soundcloud";
import {
  compactCount,
  EntitySkeletonGrid,
  ErrorState,
  PlaylistCard,
  TrackSkeleton,
} from "./EntityCards";
import { SoundCloudAvatar } from "./SoundCloudAvatar";
import { TrackCollection } from "./TrackCollection";

type ProfileTab = WaveLinkProfileTab;

interface ProfileData {
  tracks: SCTrack[];
  playlists: SCPlaylist[];
  likes: SCTrack[];
}

interface Props {
  user: SCUser;
  currentUserUrn?: string;
  onBack: () => void;
  onOpenPlaylist: (playlist: SCPlaylist) => void;
  onOpenUser: (user: SCUser) => void;
  initialTab?: ProfileTab;
  onTabChange?: (tab: ProfileTab) => void;
}

const PROFILE_TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: "tracks", label: "Tracks" },
  { id: "playlists", label: "Playlists" },
  { id: "likes", label: "Likes" },
];

const EMPTY_ERRORS: Record<ProfileTab, string | null> = {
  tracks: null,
  playlists: null,
  likes: null,
};

const EMPTY_NEXT: Record<ProfileTab, string | null> = {
  tracks: null,
  playlists: null,
  likes: null,
};

export function UserProfileView({
  user,
  currentUserUrn,
  onBack,
  onOpenPlaylist,
  onOpenUser,
  initialTab = "tracks",
  onTabChange,
}: Props) {
  const [profile, setProfile] = useState(user);
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);
  const [data, setData] = useState<ProfileData>({ tracks: [], playlists: [], likes: [] });
  const [loaded, setLoaded] = useState<Set<ProfileTab>>(() => new Set());
  const [loadingTabs, setLoadingTabs] = useState<Set<ProfileTab>>(() => new Set());
  const [errors, setErrors] = useState<Record<ProfileTab, string | null>>(EMPTY_ERRORS);
  const [nextHrefs, setNextHrefs] = useState<Record<ProfileTab, string | null>>(EMPTY_NEXT);
  const [loadingMore, setLoadingMore] = useState<ProfileTab | null>(null);
  const [trackSource, setTrackSource] =
    useState<PaginatedTrackSource | null>(null);
  const [likesSource, setLikesSource] =
    useState<PaginatedTrackSource | null>(null);
  const trackSnapshot = usePaginatedTrackSource(trackSource);
  const likesSnapshot = usePaginatedTrackSource(likesSource);
  const { tracksPerLoad } = usePlayer();
  const [following, setFollowing] = useState(Boolean(user.followed_by_user));
  const [actionError, setActionError] = useState<string | null>(null);

  const loadedRef = useRef<Set<ProfileTab>>(new Set());
  const inFlightRef = useRef<Set<ProfileTab>>(new Set());
  const generationRef = useRef<Record<ProfileTab, number>>({ tracks: 0, playlists: 0, likes: 0 });
  const followGenerationRef = useRef(0);

  const profileUrn = user.urn || user.id;
  const isSelf = profileUrn === currentUserUrn;

  const refreshFollowing = useCallback(async (force = false) => {
    if (isSelf) return;
    const generation = ++followGenerationRef.current;
    try {
      const value = await isFollowingUser(profileUrn, { force });
      if (generation !== followGenerationRef.current) return;
      setFollowing(value);
      setActionError(null);
    } catch (cause) {
      if (generation !== followGenerationRef.current) return;
      setActionError(
        cause instanceof Error ? cause.message : "Could not read follow status.",
      );
    }
  }, [isSelf, profileUrn]);

  useEffect(() => {
    let active = true;
    void getUser(profileUrn)
      .then((value) => {
        if (active) setProfile(value);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [profileUrn]);

  useEffect(() => {
    setFollowing(Boolean(user.followed_by_user));
    void refreshFollowing();
    return () => {
      followGenerationRef.current += 1;
    };
  }, [refreshFollowing, user.followed_by_user]);

  useEffect(() => {
    if (isSelf) return;
    const refreshAfterReturn = () => {
      if (document.visibilityState !== "hidden") {
        void refreshFollowing(true);
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshAfterReturn();
    };
    window.addEventListener("focus", refreshAfterReturn);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", refreshAfterReturn);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isSelf, refreshFollowing]);

  const markLoading = (tab: ProfileTab, value: boolean) => {
    setLoadingTabs((current) => {
      const next = new Set(current);
      if (value) next.add(tab);
      else next.delete(tab);
      return next;
    });
  };

  const loadTab = useCallback(async (tab: ProfileTab, force = false) => {
    if (!force && (loadedRef.current.has(tab) || inFlightRef.current.has(tab))) return;
    const generation = ++generationRef.current[tab];
    inFlightRef.current.add(tab);
    markLoading(tab, true);
    setErrors((current) => ({ ...current, [tab]: null }));
    try {
      if (tab === "tracks") {
        const result = await getUserTracks(profileUrn, tracksPerLoad);
        if (generation !== generationRef.current[tab]) return;
        const source = createPaginatedTrackSource({
          initialTracks: result.collection ?? [],
          nextHref: result.next_href,
          totalCount: result.total_results ?? profile.track_count,
          pageSize: tracksPerLoad,
          loadPage: (cursor) => fetchNextPage<SCTrack>(cursor),
          mergeMode: "dedupe",
        });
        const snapshot = source.getSnapshot();
        setTrackSource(source);
        const tracks = snapshot.tracks;
        setData((current) => ({ ...current, tracks }));
        setNextHrefs((current) => ({
          ...current,
          tracks: snapshot.nextHref,
        }));
      } else if (tab === "playlists") {
        const result = await getUserPlaylists(profileUrn);
        if (generation !== generationRef.current[tab]) return;
        setData((current) => ({
          ...current,
          playlists: result.collection ?? [],
        }));
        setNextHrefs((current) => ({
          ...current,
          playlists: result.next_href ?? null,
        }));
      } else {
        const result = await getUserLikedTracks(profileUrn, tracksPerLoad);
        if (generation !== generationRef.current[tab]) return;
        const source = createPaginatedTrackSource({
          initialTracks: result.collection ?? [],
          nextHref: result.next_href,
          totalCount: result.total_results,
          pageSize: tracksPerLoad,
          loadPage: (cursor) => fetchNextPage<SCTrack>(cursor),
          mergeMode: "dedupe",
        });
        const snapshot = source.getSnapshot();
        setLikesSource(source);
        setData((current) => ({ ...current, likes: snapshot.tracks }));
        setNextHrefs((current) => ({
          ...current,
          likes: snapshot.nextHref,
        }));
      }
      loadedRef.current.add(tab);
      setLoaded(new Set(loadedRef.current));
    } catch (cause) {
      if (generation !== generationRef.current[tab]) return;
      loadedRef.current.add(tab);
      setLoaded(new Set(loadedRef.current));
      setErrors((current) => ({
        ...current,
        [tab]: cause instanceof Error ? cause.message : "Could not load this profile.",
      }));
    } finally {
      if (generation === generationRef.current[tab]) {
        inFlightRef.current.delete(tab);
        markLoading(tab, false);
      }
    }
  }, [profile.track_count, profileUrn, tracksPerLoad]);

  useEffect(() => {
    void loadTab(activeTab);
  }, [activeTab, loadTab]);

  useEffect(() => () => {
    generationRef.current.tracks += 1;
    generationRef.current.playlists += 1;
    generationRef.current.likes += 1;
  }, [profileUrn]);

  useEffect(() => {
    if (!trackSnapshot) return;
    setData((current) => ({ ...current, tracks: trackSnapshot.tracks }));
    setNextHrefs((current) => ({
      ...current,
      tracks: trackSnapshot.nextHref,
    }));
    setErrors((current) => ({ ...current, tracks: trackSnapshot.error }));
  }, [trackSnapshot]);

  useEffect(() => {
    if (!likesSnapshot) return;
    setData((current) => ({ ...current, likes: likesSnapshot.tracks }));
    setNextHrefs((current) => ({
      ...current,
      likes: likesSnapshot.nextHref,
    }));
    setErrors((current) => ({ ...current, likes: likesSnapshot.error }));
  }, [likesSnapshot]);

  const loadMoreForActiveTab = async () => {
    const tab = activeTab;
    const nextHref = nextHrefs[tab];
    if (!nextHref || loadingMore === tab) return;
    const source =
      tab === "tracks" ? trackSource : tab === "likes" ? likesSource : null;
    if (source) {
      try {
        setLoadingMore(tab);
        await source.loadNext();
      } catch {
        // Successful earlier pages stay visible and the failed cursor can retry.
      } finally {
        setLoadingMore((current) => (current === tab ? null : current));
      }
      return;
    }

    const generation = generationRef.current[tab];
    setLoadingMore(tab);
    try {
      if (tab === "playlists") {
        const result = await fetchNextPage<SCPlaylist>(nextHref);
        if (generation !== generationRef.current[tab]) return;
        setData((current) => ({
          ...current,
          playlists: [...current.playlists, ...(result.collection ?? [])],
        }));
        setNextHrefs((current) => ({ ...current, playlists: result.next_href ?? null }));
      } else {
        const result = await fetchNextPage<SCTrack>(nextHref);
        if (generation !== generationRef.current[tab]) return;
        setData((current) => ({
          ...current,
          [tab]: [...current[tab], ...(result.collection ?? [])],
        }));
        setNextHrefs((current) => ({ ...current, [tab]: result.next_href ?? null }));
      }
    } catch (cause) {
      if (generation === generationRef.current[tab]) {
        setErrors((current) => ({
          ...current,
          [tab]: cause instanceof Error ? cause.message : "Could not load more results.",
        }));
      }
    } finally {
      if (generation === generationRef.current[tab]) {
        setLoadingMore((current) => current === tab ? null : current);
      }
    }
  };

  const items = data[activeTab];
  const activeTrackSource =
    activeTab === "tracks"
      ? trackSource
      : activeTab === "likes"
        ? likesSource
        : null;
  const activeTrackSnapshot =
    activeTab === "tracks"
      ? trackSnapshot
      : activeTab === "likes"
        ? likesSnapshot
        : null;
  const isLoading = loadingTabs.has(activeTab) || !loaded.has(activeTab);
  const error = errors[activeTab];
  const hasItems = items.length > 0;
  const blockingError = Boolean(error && !hasItems);

  return (
    <div className="wl-page wl-detail-page">
      <button type="button" className="wl-back" onClick={onBack}>← Back</button>

      <section className="wl-detail-hero wl-detail-hero--profile">
        <SoundCloudAvatar
          className="wl-detail-hero__art wl-detail-hero__avatar"
          avatarUrl={profile.avatar_url}
          preset="t500x500"
          alt=""
        />
        <div className="wl-detail-hero__copy">
          <span className="wl-eyebrow">SoundCloud profile</span>
          <h1>{profile.username}{profile.verified ? <span className="wl-verified" title="Verified">✓</span> : null}</h1>
          {(profile.city || profile.country) && (
            <p className="wl-detail-hero__location">{[profile.city, profile.country].filter(Boolean).join(", ")}</p>
          )}
          {profile.description && <p className="wl-detail-hero__description">{profile.description}</p>}
          <div className="wl-account-hero__stats">
            <span><strong>{compactCount(profile.followers_count)}</strong> followers</span>
            <span><strong>{compactCount(profile.followings_count)}</strong> following</span>
            <span><strong>{compactCount(profile.track_count)}</strong> tracks</span>
          </div>
          <div className="wl-detail-hero__actions">
            {!isSelf && (
              <button
                type="button"
                className={following ? "wl-btn wl-btn--quiet" : "wl-btn wl-btn--primary"}
                onClick={() => showSoundCloudFollowPrompt(profile, following)}
                aria-haspopup="dialog"
                aria-label={`${following ? "Manage following" : "Follow"} ${profile.username} on SoundCloud`}
              >
                {following ? "Following" : "Follow"}
              </button>
            )}
            <a className="wl-btn wl-btn--quiet" href={profile.permalink_url} target="_blank" rel="noreferrer">
              Open on SoundCloud ↗
            </a>
          </div>
          {actionError && <div className="wl-inline-error" role="alert">{actionError}</div>}
        </div>
      </section>

      <div className="wl-tabs" role="tablist" aria-label={`${profile.username} profile sections`}>
        {PROFILE_TABS.map((tab) => (
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

      <section className="wl-profile-content" aria-live="polite">
        {isLoading ? (
          activeTab === "playlists" ? <EntitySkeletonGrid count={8} /> : <TrackSkeleton count={8} />
        ) : blockingError ? (
          <ErrorState
            message={error ?? "Could not load this profile."}
            onRetry={() => void loadTab(activeTab, true)}
          />
        ) : items.length === 0 ? (
          <div className="wl-state"><span className="wl-state__icon" aria-hidden="true">⌁</span><div><strong>No {activeTab} yet</strong><p>There’s nothing to show in this section.</p></div></div>
        ) : activeTab === "playlists" ? (
          <div className="wl-entity-grid">
            {data.playlists.map((playlist) => (
              <PlaylistCard
                key={playlist.urn || playlist.id}
                playlist={playlist}
                onOpen={onOpenPlaylist}
                onOpenUser={onOpenUser}
              />
            ))}
          </div>
        ) : (
          <TrackCollection
            tracks={activeTab === "tracks" ? data.tracks : data.likes}
            paginationSource={activeTrackSource ?? undefined}
            onOpenUser={onOpenUser}
            context={{
              label:
                activeTab === "tracks"
                  ? `${profile.username} · Tracks`
                  : `${profile.username} · Likes`,
              target: { kind: "user", user: profile, profileTab: activeTab },
            }}
          />
        )}

        {!isLoading && error && hasItems && (
          <div className="wl-inline-error" role="alert">{error}</div>
        )}

        {!isLoading && (activeTrackSnapshot?.nextHref ?? nextHrefs[activeTab]) && (
          <div className="wl-load-more">
            <button type="button" className="wl-btn wl-btn--quiet" onClick={() => void loadMoreForActiveTab()} disabled={Boolean(activeTrackSnapshot?.loading) || loadingMore === activeTab}>
              {activeTrackSnapshot?.loading || loadingMore === activeTab
                ? "Loading…"
                : error
                  ? "Retry load more"
                  : activeTrackSource
                    ? `Load next ${tracksPerLoad}`
                    : "Load more"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
