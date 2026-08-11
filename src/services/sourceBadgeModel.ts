export type SourceBadgeSource = "soundcloud" | "spotify" | null;
export type SourceBadgeSide = "left" | "right";
export type SourceBadgeDisplayMode = "icon-text" | "icon-only";

export interface SourceBadgePreferences {
  enabled: boolean;
  side: SourceBadgeSide;
  dodgeOnHover: boolean;
  linkEnabled: boolean;
  displayMode: SourceBadgeDisplayMode;
  hideWithFullscreenPlayer: boolean;
}

export interface PersistedSourceBadgePreferences {
  enabled?: unknown;
  side?: unknown;
  dodgeOnHover?: unknown;
  linkEnabled?: unknown;
  displayMode?: unknown;
  hideWithFullscreenPlayer?: unknown;
}

export interface SourceBadgeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type SourceBadgeHoverZone = SourceBadgeBounds;

export interface SourceBadgePresentationInput {
  source: SourceBadgeSource;
  runtimeSide: unknown;
  fullscreenPlayerHidden: boolean;
  soundCloudUrl?: unknown;
  trackTitle?: unknown;
}

export interface SourceBadgeFullscreenPlayerState {
  source: SourceBadgeSource;
  soundCloudPlayerHidden: boolean;
  spotifyPlayerHidden: boolean;
}

export interface SourceBadgePresentation {
  visible: boolean;
  side: SourceBadgeSide;
  labelVisible: boolean;
  href: string | null;
  pointerInteractive: boolean;
  fadeWithFullscreenPlayer: boolean;
  dockAtViewportEdge: boolean;
  ariaHidden: boolean;
  ariaLabel: string;
}

export const DEFAULT_SOURCE_BADGE_PREFERENCES: Readonly<SourceBadgePreferences> =
  Object.freeze({
    enabled: true,
    side: "left",
    dodgeOnHover: false,
    linkEnabled: true,
    displayMode: "icon-text",
    // This preserves the previous behavior. When false and Spotify's
    // fullscreen player bar folds away, the indicator remains visible and
    // follows it down to the physical screen edge.
    hideWithFullscreenPlayer: false,
  });

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

export function normalizeSourceBadgeSide(value: unknown): SourceBadgeSide {
  return value === "right" ? "right" : "left";
}

export function normalizeSourceBadgeDisplayMode(
  value: unknown,
): SourceBadgeDisplayMode {
  return value === "icon-only" ? "icon-only" : "icon-text";
}

export function normalizeSourceBadgePreferences(
  value: PersistedSourceBadgePreferences | null | undefined,
): SourceBadgePreferences {
  const source = value ?? {};
  return {
    enabled: normalizeBoolean(
      source.enabled,
      DEFAULT_SOURCE_BADGE_PREFERENCES.enabled,
    ),
    side: normalizeSourceBadgeSide(source.side),
    dodgeOnHover: normalizeBoolean(
      source.dodgeOnHover,
      DEFAULT_SOURCE_BADGE_PREFERENCES.dodgeOnHover,
    ),
    linkEnabled: normalizeBoolean(
      source.linkEnabled,
      DEFAULT_SOURCE_BADGE_PREFERENCES.linkEnabled,
    ),
    displayMode: normalizeSourceBadgeDisplayMode(source.displayMode),
    hideWithFullscreenPlayer: normalizeBoolean(
      source.hideWithFullscreenPlayer,
      DEFAULT_SOURCE_BADGE_PREFERENCES.hideWithFullscreenPlayer,
    ),
  };
}

export function oppositeSourceBadgeSide(
  side: SourceBadgeSide,
): SourceBadgeSide {
  return side === "left" ? "right" : "left";
}

export function sourceBadgeSideForHomeArea(
  configuredSide: unknown,
  dodgeOnHover: boolean,
  pointerInsideHomeArea: boolean,
): SourceBadgeSide {
  const normalized = normalizeSourceBadgeSide(configuredSide);
  return dodgeOnHover && pointerInsideHomeArea
    ? oppositeSourceBadgeSide(normalized)
    : normalized;
}

/**
 * Each playback owner has a different fullscreen-collapse signal. Keeping the
 * choice source-aware prevents Spotify's retained cinema class from hiding a
 * SoundCloud badge (and vice versa) during a playback handoff.
 */
export function sourceBadgeFullscreenPlayerHidden(
  state: SourceBadgeFullscreenPlayerState,
): boolean {
  if (state.source === "soundcloud") return state.soundCloudPlayerHidden;
  if (state.source === "spotify") return state.spotifyPlayerHidden;
  return false;
}

export function createSourceBadgeHoverZone(
  bounds: SourceBadgeBounds,
  padding = 8,
): SourceBadgeHoverZone | null {
  const values = [bounds.left, bounds.top, bounds.right, bounds.bottom];
  if (
    !values.every(Number.isFinite) ||
    bounds.right <= bounds.left ||
    bounds.bottom <= bounds.top
  ) {
    return null;
  }
  const safePadding = Number.isFinite(padding)
    ? Math.max(0, Math.min(64, padding))
    : 0;
  return {
    left: bounds.left - safePadding,
    top: bounds.top - safePadding,
    right: bounds.right + safePadding,
    bottom: bounds.bottom + safePadding,
  };
}

export function sourceBadgeHomeBounds(
  renderedBounds: SourceBadgeBounds,
  configuredSide: unknown,
  viewportWidth: number,
  horizontalInset = 12,
): SourceBadgeBounds | null {
  const width = renderedBounds.right - renderedBounds.left;
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(renderedBounds.top) ||
    !Number.isFinite(renderedBounds.bottom) ||
    renderedBounds.bottom <= renderedBounds.top ||
    !Number.isFinite(viewportWidth) ||
    viewportWidth <= 0
  ) {
    return null;
  }
  const safeInset = Number.isFinite(horizontalInset)
    ? Math.max(0, Math.min(64, horizontalInset))
    : 0;
  const left =
    normalizeSourceBadgeSide(configuredSide) === "right"
      ? viewportWidth - safeInset - width
      : safeInset;
  return {
    left,
    top: renderedBounds.top,
    right: left + width,
    bottom: renderedBounds.bottom,
  };
}

export function isPointInsideSourceBadgeHoverZone(
  zone: SourceBadgeHoverZone | null,
  clientX: number,
  clientY: number,
): boolean {
  return Boolean(
    zone &&
      Number.isFinite(clientX) &&
      Number.isFinite(clientY) &&
      clientX >= zone.left &&
      clientX <= zone.right &&
      clientY >= zone.top &&
      clientY <= zone.bottom,
  );
}

function safeSoundCloudPageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "soundcloud.com" &&
        url.hostname !== "www.soundcloud.com") ||
      url.port ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

function safeTitle(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, 300)
    : "";
}

export function sourceBadgePresentation(
  preferences: SourceBadgePreferences,
  input: SourceBadgePresentationInput,
): SourceBadgePresentation {
  const visible = preferences.enabled && input.source !== null;
  const title = safeTitle(input.trackTitle);
  const href =
    visible && input.source === "soundcloud" && preferences.linkEnabled
      ? safeSoundCloudPageUrl(input.soundCloudUrl)
      : null;
  const fadeWithFullscreenPlayer =
    visible &&
    input.fullscreenPlayerHidden &&
    preferences.hideWithFullscreenPlayer;
  const dockAtViewportEdge =
    visible &&
    input.fullscreenPlayerHidden &&
    !preferences.hideWithFullscreenPlayer;

  let ariaLabel = "Playback source";
  if (input.source === "spotify") {
    ariaLabel = "Spotify playback source";
  } else if (input.source === "soundcloud") {
    ariaLabel = href
      ? `Open ${title || "this track"} on SoundCloud`
      : "SoundCloud playback source";
  }

  return {
    visible,
    side: normalizeSourceBadgeSide(input.runtimeSide),
    labelVisible: preferences.displayMode === "icon-text",
    href,
    pointerInteractive:
      visible && (preferences.dodgeOnHover || href !== null),
    fadeWithFullscreenPlayer,
    dockAtViewportEdge,
    ariaHidden: !visible || fadeWithFullscreenPlayer,
    ariaLabel,
  };
}
