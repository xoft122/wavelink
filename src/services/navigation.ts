import type { SCPlaylist, SCUser } from "../types/soundcloud";

export type WaveLinkMainTab = "home" | "search" | "library" | "settings";
export type WaveLinkSearchTab = "tracks" | "playlists" | "users";
export type WaveLinkLibraryTab =
  | "liked-tracks"
  | "playlists"
  | "liked-playlists"
  | "followings";
export type WaveLinkProfileTab = "tracks" | "playlists" | "likes";

export type WaveLinkNavigationTarget =
  | {
      kind: "main";
      tab: WaveLinkMainTab;
      query?: string;
      searchDraft?: string;
      searchTab?: WaveLinkSearchTab;
      libraryTab?: WaveLinkLibraryTab;
    }
  | { kind: "user"; user: SCUser; profileTab?: WaveLinkProfileTab }
  | { kind: "playlist"; playlist: SCPlaylist };

interface WaveLinkRouteSession {
  version: 1;
  ownerId: string;
  routes: WaveLinkNavigationTarget[];
}

interface WaveLinkNavigationBridge {
  pending: WaveLinkNavigationTarget | null;
  routeSession?: WaveLinkRouteSession;
}

type NavigationWindow = Window & {
  __waveLinkNavigation?: WaveLinkNavigationBridge;
};

const EVENT_NAME = "wavelink:navigate";
export const WAVELINK_ROUTE_STACK_LIMIT = 32;

const HOME_ROUTE: WaveLinkNavigationTarget = { kind: "main", tab: "home" };

/**
 * Identify the mounted page without including state that changes inside it.
 * AccountShell uses this to reset its shared scroll container only when the
 * user actually navigates to a different page.
 */
export function waveLinkPageIdentity(
  route: WaveLinkNavigationTarget,
): string {
  if (route.kind === "main") return `main:${route.tab}`;
  if (route.kind === "user") return `user:${route.user.urn || route.user.id}`;
  return `playlist:${route.playlist.urn || route.playlist.id}`;
}

function isSearchTab(value: unknown): value is WaveLinkSearchTab {
  return value === "tracks" || value === "playlists" || value === "users";
}

function isLibraryTab(value: unknown): value is WaveLinkLibraryTab {
  return (
    value === "liked-tracks" ||
    value === "playlists" ||
    value === "liked-playlists" ||
    value === "followings"
  );
}

function isProfileTab(value: unknown): value is WaveLinkProfileTab {
  return value === "tracks" || value === "playlists" || value === "likes";
}

function hasIdentity(value: unknown): value is { id?: string; urn?: string } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { id?: unknown; urn?: unknown };
  return (
    (typeof candidate.urn === "string" && candidate.urn.length > 0) ||
    (typeof candidate.id === "string" && candidate.id.length > 0)
  );
}

export function isWaveLinkNavigationTarget(
  value: unknown,
): value is WaveLinkNavigationTarget {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    kind?: unknown;
    tab?: unknown;
    query?: unknown;
    searchDraft?: unknown;
    searchTab?: unknown;
    libraryTab?: unknown;
    profileTab?: unknown;
    user?: unknown;
    playlist?: unknown;
  };
  if (candidate.kind === "main") {
    const knownTab =
      candidate.tab === "home" ||
      candidate.tab === "search" ||
      candidate.tab === "library" ||
      candidate.tab === "settings";
    if (!knownTab) return false;
    const hasValidQuery =
      candidate.query === undefined ||
      (candidate.tab === "search" &&
        typeof candidate.query === "string" &&
        candidate.query.trim().length > 0);
    const hasValidSearchState =
      candidate.tab === "search"
        ? (candidate.searchDraft === undefined ||
            typeof candidate.searchDraft === "string") &&
          (candidate.searchTab === undefined || isSearchTab(candidate.searchTab)) &&
          candidate.libraryTab === undefined
        : candidate.searchDraft === undefined &&
          candidate.searchTab === undefined;
    const hasValidLibraryState =
      candidate.tab === "library"
        ? candidate.libraryTab === undefined || isLibraryTab(candidate.libraryTab)
        : candidate.libraryTab === undefined;
    return hasValidQuery && hasValidSearchState && hasValidLibraryState;
  }
  if (candidate.kind === "user") {
    const user = candidate.user as Partial<SCUser> | undefined;
    return (
      hasIdentity(user) &&
      typeof user.username === "string" &&
      user.username.length > 0 &&
      (candidate.profileTab === undefined || isProfileTab(candidate.profileTab))
    );
  }
  if (candidate.kind === "playlist") {
    const playlist = candidate.playlist as Partial<SCPlaylist> | undefined;
    return (
      hasIdentity(playlist) &&
      typeof playlist.title === "string" &&
      playlist.title.length > 0 &&
      hasIdentity(playlist.user)
    );
  }
  return false;
}

function bridge(): WaveLinkNavigationBridge {
  const owner = window as NavigationWindow;
  owner.__waveLinkNavigation ??= { pending: null };
  return owner.__waveLinkNavigation;
}

function ownerIdentity(user: Pick<SCUser, "id" | "urn">): string {
  return user.urn || user.id;
}

function normalizedRouteStack(value: unknown): WaveLinkNavigationTarget[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every(isWaveLinkNavigationTarget)) return null;
  if (value[0].kind !== "main") return null;
  if (value.length <= WAVELINK_ROUTE_STACK_LIMIT) return value.slice();
  return [value[0], ...value.slice(-(WAVELINK_ROUTE_STACK_LIMIT - 1))];
}

/**
 * Restore the last WaveLink page for this account in the current Spotify
 * renderer. The window-owned value disappears naturally after Spotify exits.
 */
export function restoreWaveLinkRouteStack(
  user: Pick<SCUser, "id" | "urn">,
): WaveLinkNavigationTarget[] {
  const ownerId = ownerIdentity(user);
  const current = bridge().routeSession;
  if (current?.version === 1 && current.ownerId === ownerId) {
    const routes = normalizedRouteStack(current.routes);
    if (routes) {
      current.routes = routes;
      return routes.slice();
    }
  }
  const routes = [{ ...HOME_ROUTE }];
  bridge().routeSession = { version: 1, ownerId, routes };
  return routes.slice();
}

/** Remember a complete, bounded back stack without writing to web storage. */
export function rememberWaveLinkRouteStack(
  user: Pick<SCUser, "id" | "urn">,
  value: WaveLinkNavigationTarget[],
): WaveLinkNavigationTarget[] {
  const ownerId = ownerIdentity(user);
  const routes = normalizedRouteStack(value) ?? [{ ...HOME_ROUTE }];
  bridge().routeSession = { version: 1, ownerId, routes };
  return routes.slice();
}

/** Forget the in-memory page when the SoundCloud account is disconnected. */
export function clearWaveLinkRouteStack(): void {
  delete bridge().routeSession;
}

function hasExplicitMainState(
  target: Extract<WaveLinkNavigationTarget, { kind: "main" }>,
): boolean {
  return (
    target.query !== undefined ||
    target.searchDraft !== undefined ||
    target.searchTab !== undefined ||
    target.libraryTab !== undefined
  );
}

/** Apply a validated navigation request while preserving useful back state. */
export function applyWaveLinkNavigationTarget(
  value: WaveLinkNavigationTarget[],
  target: WaveLinkNavigationTarget,
  options: { forceExact?: boolean } = {},
): WaveLinkNavigationTarget[] {
  const routes = normalizedRouteStack(value) ?? [{ ...HOME_ROUTE }];
  if (!isWaveLinkNavigationTarget(target)) return routes;

  if (target.kind === "main") {
    const root = routes[0];
    if (
      !options.forceExact &&
      root.kind === "main" &&
      root.tab === target.tab &&
      !hasExplicitMainState(target)
    ) {
      return routes.length === 1 ? routes : [root];
    }
    return [{ ...target }];
  }

  const leaf = routes[routes.length - 1];
  if (target.kind === "playlist") {
    if (
      leaf?.kind === "playlist" &&
      (leaf.playlist.urn || leaf.playlist.id) ===
        (target.playlist.urn || target.playlist.id)
    ) {
      return options.forceExact
        ? [...routes.slice(0, -1), target]
        : routes;
    }
    return [...routes, target];
  }

  if (
    leaf?.kind === "user" &&
    (leaf.user.urn || leaf.user.id) === (target.user.urn || target.user.id)
  ) {
    if (!options.forceExact && target.profileTab === undefined) return routes;
    return [...routes.slice(0, -1), target];
  }
  return [...routes, target];
}

/** Navigate to the WaveLink custom app and deliver an internal route request. */
export function openInWaveLink(target: WaveLinkNavigationTarget): void {
  if (!isWaveLinkNavigationTarget(target)) return;
  bridge().pending = target;
  try {
    (
      Spicetify.Platform.History as { push: (path: string) => void }
    ).push("/wavelink");
  } catch {}
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: target }));
}

/** Bind the React app to route requests emitted by the always-on extension. */
export function bindWaveLinkNavigation(
  handler: (target: WaveLinkNavigationTarget) => void,
): () => void {
  const consume = (value: unknown) => {
    if (!isWaveLinkNavigationTarget(value)) return;
    handler(value);
    if (bridge().pending === value) bridge().pending = null;
  };
  const onNavigate = (event: Event) => {
    consume((event as CustomEvent<unknown>).detail);
  };
  window.addEventListener(EVENT_NAME, onNavigate);
  const pending = bridge().pending;
  // Consume synchronously so a fast custom-app unmount cannot let a stale
  // timer swallow the deep link before the next mount gets a chance to bind.
  if (pending) consume(pending);
  return () => window.removeEventListener(EVENT_NAME, onNavigate);
}
