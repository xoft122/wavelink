import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import "./styles/app.css";

import { HomeView } from "./components/HomeView";
import { LibraryView } from "./components/LibraryView";
import { Navigation, MainTab } from "./components/Navigation";
import { OAuthOnboarding } from "./components/OAuthOnboarding";
import { PlaylistDetailView } from "./components/PlaylistDetailView";
import { SearchView } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { SoundCloudAvatar } from "./components/SoundCloudAvatar";
import { UserProfileView } from "./components/UserProfileView";
import { useAuth } from "./hooks/useAuth";
import { LikedTracksProvider } from "./hooks/useLikedTracks";
import { player } from "./services/player";
import { acquireWaveLinkHeaderInteraction } from "./services/topbarInteraction";
import {
  applyWaveLinkNavigationTarget,
  bindWaveLinkNavigation,
  clearWaveLinkRouteStack,
  rememberWaveLinkRouteStack,
  restoreWaveLinkRouteStack,
  waveLinkPageIdentity,
  WaveLinkNavigationTarget,
} from "./services/navigation";
import { SCPlaylist, SCUser } from "./types/soundcloud";

type Route = WaveLinkNavigationTarget;

function BrandMark() {
  return (
    <span className="wl-mark" aria-hidden="true">
      <svg viewBox="0 0 36 36">
        <defs><linearGradient id="wl-shell-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff8a1f"/><stop offset="1" stopColor="#ff3d72"/></linearGradient></defs>
        <rect width="36" height="36" rx="11" fill="url(#wl-shell-gradient)" />
        <path d="M6 20c3.4 0 3.4-7.5 6.8-7.5S16.2 23 19.6 23s3.4-7.5 6.8-7.5S29.8 20 30 20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function SavedSessionGate({
  isChecking,
  error,
  onRetry,
}: {
  isChecking: boolean;
  error: string | null;
  onRetry: () => Promise<unknown>;
}) {
  return (
    <div className="sc-app wl-app">
      <div
        className="wl-session-gate"
        role={isChecking ? "status" : "alert"}
        aria-live="polite"
      >
        <div className="wl-session-gate__brand">
          <BrandMark />
          <span>WaveLink</span>
        </div>
        {isChecking ? (
          <>
            <span className="wl-session-gate__spinner" aria-hidden="true" />
            <strong>Opening WaveLink…</strong>
            <p>Your SoundCloud library is getting ready.</p>
          </>
        ) : (
          <>
            <span className="wl-session-gate__error" aria-hidden="true">!</span>
            <strong>WaveLink couldn&apos;t reach SoundCloud</strong>
            <p>
              {error ||
                "Your saved session is still available. Try again in a moment."}
            </p>
            <button
              type="button"
              className="wl-btn wl-btn--primary"
              onClick={() => void onRetry()}
            >
              Retry
            </button>
          </>
        )}
      </div>
    </div>
  );
}

class WaveLinkErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[WaveLink] Account UI render failed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="sc-app wl-app">
          <div className="wl-page">
            <div className="wl-state wl-state--error" role="alert">
              <span className="wl-state__icon" aria-hidden="true">!</span>
              <div>
                <strong>WaveLink couldn’t render this SoundCloud response</strong>
                <p>Your SoundCloud session is still saved. Reload WaveLink to try the request again.</p>
              </div>
              <button
                type="button"
                className="wl-btn wl-btn--quiet"
                onClick={() => window.location.reload()}
              >
                Reload WaveLink
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const {
    isConnecting,
    isChecking,
    error,
    session,
    settings,
    hasSavedCredentials,
    connect,
    disconnect,
    refreshSession,
  } = useAuth();
  if (!session?.authenticated) {
    if (hasSavedCredentials) {
      return (
        <SavedSessionGate
          isChecking={isChecking}
          error={error}
          onRetry={refreshSession}
        />
      );
    }
    return (
      <div className="sc-app wl-app">
        <OAuthOnboarding
          isConnecting={isConnecting}
          error={error}
          initialWebClientId={settings.webClientId}
          onConnect={connect}
        />
      </div>
    );
  }

  return (
    <WaveLinkErrorBoundary>
      <LikedTracksProvider>
        <div className="wl-account-root">
          <AccountShell
            key={(session.user as SCUser).urn || (session.user as SCUser).id}
            user={session.user as SCUser}
            onDisconnect={() => {
              player.stop();
              clearWaveLinkRouteStack();
              disconnect();
            }}
            onConnect={connect}
            isConnecting={isConnecting}
            authError={error}
          />
        </div>
      </LikedTracksProvider>
    </WaveLinkErrorBoundary>
  );
}

interface AccountShellProps {
  user: SCUser;
  onDisconnect: () => void;
  onConnect: (accessToken: string, webClientId: string) => Promise<boolean>;
  isConnecting: boolean;
  authError: string | null;
}

function AccountShell({
  user,
  onDisconnect,
  onConnect,
  isConnecting,
  authError,
}: AccountShellProps) {
  const [routes, setRoutes] = useState<Route[]>(() =>
    restoreWaveLinkRouteStack(user),
  );
  const [externalRouteRevision, setExternalRouteRevision] = useState(0);
  const routesRef = useRef(routes);
  const mainRef = useRef<HTMLElement | null>(null);
  const route = routes[routes.length - 1] ?? { kind: "main", tab: "home" };
  const pageIdentity = waveLinkPageIdentity(route);
  const activeMain: MainTab =
    routes[0]?.kind === "main" ? routes[0].tab : "home";

  useLayoutEffect(
    () => acquireWaveLinkHeaderInteraction(document.body),
    [],
  );

  useLayoutEffect(() => {
    mainRef.current?.scrollTo({
      top: 0,
      left: 0,
      behavior: "auto",
    });
  }, [pageIdentity]);

  const commitRoutes = useCallback((update: (current: Route[]) => Route[]) => {
    const next = update(routesRef.current);
    if (next === routesRef.current) return;
    const remembered = rememberWaveLinkRouteStack(user, next);
    routesRef.current = remembered;
    setRoutes(remembered);
  }, [user]);

  const rememberLeaf = useCallback((update: (route: Route) => Route) => {
    const current = routesRef.current;
    const leaf = current[current.length - 1];
    if (!leaf) return;
    const next = [...current.slice(0, -1), update(leaf)];
    routesRef.current = rememberWaveLinkRouteStack(user, next);
  }, [user]);

  const navigateTarget = useCallback((target: WaveLinkNavigationTarget) => {
    commitRoutes((current) => applyWaveLinkNavigationTarget(current, target));
  }, [commitRoutes]);
  const navigateExternalTarget = useCallback((target: WaveLinkNavigationTarget) => {
    commitRoutes((current) =>
      applyWaveLinkNavigationTarget(current, target, { forceExact: true }),
    );
    setExternalRouteRevision((revision) => revision + 1);
  }, [commitRoutes]);
  const navigateMain = useCallback((tab: MainTab, query?: string) => {
    navigateTarget({ kind: "main", tab, query });
  }, [navigateTarget]);
  const pushPlaylist = useCallback((playlist: SCPlaylist) => {
    navigateTarget({ kind: "playlist", playlist });
  }, [navigateTarget]);
  const pushUser = useCallback((profile: SCUser) => {
    navigateTarget({ kind: "user", user: profile });
  }, [navigateTarget]);
  const goBack = useCallback(() => {
    commitRoutes((current) =>
      current.length > 1 ? current.slice(0, -1) : current,
    );
  }, [commitRoutes]);

  useEffect(
    () => bindWaveLinkNavigation(navigateExternalTarget),
    [navigateExternalTarget],
  );

  const content = useMemo(() => {
    if (route.kind === "playlist") {
      return (
        <PlaylistDetailView
          playlist={route.playlist}
          currentUserUrn={user.urn || user.id}
          onBack={goBack}
          onOpenUser={pushUser}
        />
      );
    }
    if (route.kind === "user") {
      return (
        <UserProfileView
          key={`${externalRouteRevision}:${route.user.urn || route.user.id}:${route.profileTab ?? "tracks"}`}
          user={route.user}
          currentUserUrn={user.urn || user.id}
          onBack={goBack}
          onOpenPlaylist={pushPlaylist}
          onOpenUser={pushUser}
          initialTab={route.profileTab}
          onTabChange={(profileTab) =>
            rememberLeaf((leaf) =>
              leaf.kind === "user" ? { ...leaf, profileTab } : leaf,
            )
          }
        />
      );
    }
    if (route.tab === "search") {
      return (
        <SearchView
          key={`${externalRouteRevision}:search:${route.query ?? ""}:${route.searchDraft ?? ""}:${route.searchTab ?? "tracks"}`}
          initialQuery={route.query}
          initialDraft={route.searchDraft}
          initialTab={route.searchTab}
          onOpenPlaylist={pushPlaylist}
          onOpenUser={pushUser}
          onStateChange={({ query, draft, tab }) =>
            rememberLeaf((leaf) =>
              leaf.kind === "main" && leaf.tab === "search"
                ? {
                    ...leaf,
                    query,
                    searchDraft: draft,
                    searchTab: tab,
                  }
                : leaf,
            )
          }
        />
      );
    }
    if (route.tab === "library") {
      return (
        <LibraryView
          key={`${externalRouteRevision}:library:${route.libraryTab ?? "liked-tracks"}`}
          initialTab={route.libraryTab}
          onOpenPlaylist={pushPlaylist}
          onOpenUser={pushUser}
          onTabChange={(libraryTab) =>
            rememberLeaf((leaf) =>
              leaf.kind === "main" && leaf.tab === "library"
                ? { ...leaf, libraryTab }
                : leaf,
            )
          }
        />
      );
    }
    if (route.tab === "settings") {
      return (
        <SettingsView
          onDisconnect={onDisconnect}
          onConnect={onConnect}
          isConnecting={isConnecting}
          authError={authError}
        />
      );
    }
    return (
      <HomeView
        user={user}
        onOpenPlaylist={pushPlaylist}
        onOpenUser={pushUser}
        onOpenLibrary={() => navigateMain("library")}
      />
    );
  // Route state is intentionally the SPA's source of truth. Callback identities
  // are recreated during render but do not change what the selected route means.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalRouteRevision, route, user]);

  return (
    <div className="sc-app wl-app wl-shell">
      <header className="wl-topbar">
        <button
          type="button"
          className="wl-brand wl-brand--button"
          onClick={() => navigateMain("home")}
          aria-label="Open WaveLink Home"
          title="WaveLink Home"
        >
          <BrandMark /><span>WaveLink</span><small>SoundCloud</small>
        </button>
        <Navigation active={activeMain} onChange={navigateMain} />
        <button
          type="button"
          className="wl-user-chip"
          onClick={() => pushUser(user)}
          aria-label={`Open ${user.username} SoundCloud profile`}
          title={user.username}
        >
          <SoundCloudAvatar
            avatarUrl={user.avatar_url}
            preset="t67x67"
            alt=""
          />
          <span>{user.username}</span>
        </button>
      </header>
      <main ref={mainRef} className="wl-main">{content}</main>
    </div>
  );
}
