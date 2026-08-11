import { SCTrack, SCUser, SoundCloudUrn } from "../types/soundcloud";

export type ArtistAvatarPosition = "left" | "center" | "right";
export type ArtworkBackgroundMode = "blurred" | "color";

export const ARTIST_TOOLBAR_IDLE_MS = 2_500;
export const ARTIST_TOOLBAR_FADE_MS = 160;
export const CINEMA_PLAYER_IDLE_MS = 5_000;
export const CINEMA_PLAYER_FADE_MS = 280;
export const ARTWORK_PANELS_FADE_MS = 160;

export type ArtistToolbarVisibilityReason =
  | "inactive"
  | "keyboard-focus"
  | "recent-activity"
  | "idle";

export interface ArtistToolbarPresentationInput {
  artistMode: boolean;
  nowMs: number;
  lastActivityAtMs: number;
  keyboardFocusWithin: boolean;
  reducedMotion: boolean;
}

export interface ArtistToolbarPresentation {
  visible: boolean;
  inert: boolean;
  ariaHidden: boolean;
  /** `null` means that hover/focus pins the toolbar open or it is already hidden. */
  hideAfterMs: number | null;
  transitionMs: number;
  reason: ArtistToolbarVisibilityReason;
}

export interface CinemaPlayerPresentationInput {
  active: boolean;
  nowMs: number;
  lastActivityAtMs: number;
  keyboardFocusWithin: boolean;
  reducedMotion: boolean;
}

export interface CinemaPlayerPresentation {
  hidden: boolean;
  hideAfterMs: number | null;
  transitionMs: number;
  reason: "inactive" | "keyboard-focus" | "recent-activity" | "idle";
}

export interface ArtworkPanelsPresentationInput {
  active: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  reducedMotion: boolean;
}

export interface ArtworkPanelsPresentation {
  progress: number;
  visible: boolean;
  inert: boolean;
  ariaHidden: boolean;
  transitionMs: number;
}

export interface CinemaArtworkRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CinemaArtworkCoverTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}

export interface ArtistAvatarBorderPresentation {
  drawn: boolean;
  disabled: boolean;
  ariaPressed: boolean;
  ariaLabel: string;
}

export interface ArtistAvatarVisibilityPresentation {
  hidden: boolean;
  disabled: boolean;
  ariaPressed: boolean;
  label: string;
  ariaLabel: string;
}

export interface FullscreenArtistVisuals {
  bannerUrl: string;
  avatarUrl: string;
}

export function normalizeArtistAvatarPosition(
  value: unknown,
): ArtistAvatarPosition {
  return value === "left" || value === "right" || value === "center"
    ? value
    : "center";
}

export function normalizeArtworkBackgroundMode(
  value: unknown,
): ArtworkBackgroundMode {
  return value === "color" ? "color" : "blurred";
}

export function nextArtworkBackgroundMode(
  current: ArtworkBackgroundMode,
  key: string,
): ArtworkBackgroundMode {
  const modes: ArtworkBackgroundMode[] = ["blurred", "color"];
  const normalized = normalizeArtworkBackgroundMode(current);
  if (key === "Home") return modes[0];
  if (key === "End") return modes[modes.length - 1];
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return modes[(modes.indexOf(normalized) - 1 + modes.length) % modes.length];
  }
  if (key === "ArrowRight" || key === "ArrowDown") {
    return modes[(modes.indexOf(normalized) + 1) % modes.length];
  }
  return normalized;
}

export function normalizeArtistAvatarVisibility(value: unknown): boolean {
  return value !== "false";
}

export function normalizeArtistAvatarBorderVisibility(value: unknown): boolean {
  return value !== "false";
}

/**
 * Pure auto-hide policy for the artist-image toolbar. Activity anywhere in the
 * cinema surface should update `lastActivityAtMs`. Only keyboard/assistive-tech
 * focus pins the toolbar open; pointer focus follows the normal idle deadline.
 */
export function artistToolbarPresentation({
  artistMode,
  nowMs,
  lastActivityAtMs,
  keyboardFocusWithin,
  reducedMotion,
}: ArtistToolbarPresentationInput): ArtistToolbarPresentation {
  const transitionMs = reducedMotion ? 0 : ARTIST_TOOLBAR_FADE_MS;
  const result = (
    visible: boolean,
    reason: ArtistToolbarVisibilityReason,
    hideAfterMs: number | null = null,
  ): ArtistToolbarPresentation => ({
    visible,
    inert: !visible,
    ariaHidden: !visible,
    hideAfterMs,
    transitionMs,
    reason,
  });

  if (!artistMode) return result(false, "inactive");
  if (keyboardFocusWithin) return result(true, "keyboard-focus");

  // Invalid or backwards clocks fail open: accessibility is more important
  // than hiding a toolbar whose idle deadline cannot be calculated safely.
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastActivityAtMs)) {
    return result(true, "recent-activity", ARTIST_TOOLBAR_IDLE_MS);
  }
  const elapsedMs = Math.max(0, nowMs - lastActivityAtMs);
  const remainingMs = ARTIST_TOOLBAR_IDLE_MS - elapsedMs;
  return remainingMs > 0
    ? result(true, "recent-activity", Math.ceil(remainingMs))
    : result(false, "idle");
}

/**
 * The native fullscreen player stays available while the pointer is active,
 * then clips out of view after five seconds. Keyboard focus inside the player
 * pins it open so auto-hide never strands a focused Spotify control.
 */
export function cinemaPlayerPresentation({
  active,
  nowMs,
  lastActivityAtMs,
  keyboardFocusWithin,
  reducedMotion,
}: CinemaPlayerPresentationInput): CinemaPlayerPresentation {
  const transitionMs = reducedMotion ? 0 : CINEMA_PLAYER_FADE_MS;
  const result = (
    hidden: boolean,
    reason: CinemaPlayerPresentation["reason"],
    hideAfterMs: number | null = null,
  ): CinemaPlayerPresentation => ({
    hidden,
    hideAfterMs,
    transitionMs,
    reason,
  });

  if (!active) return result(false, "inactive");
  if (keyboardFocusWithin) return result(false, "keyboard-focus");
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastActivityAtMs)) {
    return result(false, "recent-activity", CINEMA_PLAYER_IDLE_MS);
  }
  const elapsedMs = Math.max(0, nowMs - lastActivityAtMs);
  const remainingMs = CINEMA_PLAYER_IDLE_MS - elapsedMs;
  return remainingMs > 0
    ? result(false, "recent-activity", Math.ceil(remainingMs))
    : result(true, "idle");
}

/**
 * Measures the vertical contribution of Spotify's auto-sized player grid
 * row. The bar itself uses negative block margins, so its visible rectangle
 * is not the same as the distance the native cinema view overlaps.
 */
export function cinemaPlayerGridOffset(
  height: number,
  marginBlockStart: number,
  marginBlockEnd: number,
  rowGap: number,
): number | null {
  if (!Number.isFinite(height) || height < 48 || height > 220) return null;
  const safeMarginStart = Number.isFinite(marginBlockStart)
    ? marginBlockStart
    : 0;
  const safeMarginEnd = Number.isFinite(marginBlockEnd)
    ? marginBlockEnd
    : 0;
  const safeRowGap =
    Number.isFinite(rowGap) && rowGap > 0 ? rowGap : 0;
  const offset =
    height + safeMarginStart + safeMarginEnd + safeRowGap;
  return Number.isFinite(offset) && offset >= 40 && offset <= 240
    ? offset
    : null;
}

/**
 * Maps Spotify's current native artwork rectangle into WaveLink's visual
 * surface. The cover keeps a stable base size and follows layout/scroll
 * changes with compositor-only translate/scale updates.
 */
export function cinemaArtworkCoverTransform(
  surface: CinemaArtworkRect,
  nativeCover: CinemaArtworkRect,
  baseWidth: number,
  baseHeight: number,
): CinemaArtworkCoverTransform | null {
  const values = [
    surface.left,
    surface.top,
    surface.width,
    surface.height,
    nativeCover.left,
    nativeCover.top,
    nativeCover.width,
    nativeCover.height,
    baseWidth,
    baseHeight,
  ];
  if (values.some((value) => !Number.isFinite(value))) return null;
  if (
    surface.width <= 0 ||
    surface.height <= 0 ||
    nativeCover.width <= 0 ||
    nativeCover.height <= 0 ||
    baseWidth <= 0 ||
    baseHeight <= 0
  ) {
    return null;
  }
  const transform = {
    x: nativeCover.left - surface.left,
    y: nativeCover.top - surface.top,
    scaleX: nativeCover.width / baseWidth,
    scaleY: nativeCover.height / baseHeight,
  };
  return Object.values(transform).every(Number.isFinite)
    ? transform
    : null;
}

/**
 * Credits, queue, and the artwork-background switch live above WaveLink's
 * owned visual but visually follow Spotify's real scroll viewport.
 */
export function artworkPanelsPresentation({
  active,
  scrollTop,
  scrollHeight,
  clientHeight,
  reducedMotion,
}: ArtworkPanelsPresentationInput): ArtworkPanelsPresentation {
  const transitionMs = reducedMotion ? 0 : ARTWORK_PANELS_FADE_MS;
  const safeClientHeight =
    Number.isFinite(clientHeight) && clientHeight > 0 ? clientHeight : 0;
  const safeScrollHeight =
    Number.isFinite(scrollHeight) && scrollHeight > 0 ? scrollHeight : 0;
  const maxScroll = Math.max(0, safeScrollHeight - safeClientHeight);
  const revealSpan = Math.max(
    1,
    Math.min(
      maxScroll,
      Math.max(72, Math.min(180, safeClientHeight * 0.18)),
    ),
  );
  const safeScrollTop =
    Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const progress =
    active && maxScroll > 0
      ? Math.min(1, Math.max(0, safeScrollTop / revealSpan))
      : 0;
  const visible = progress > 0;
  const interactive = progress >= 0.1;
  return {
    progress,
    visible,
    inert: !interactive,
    ariaHidden: !interactive,
    transitionMs,
  };
}

export function artistAvatarVisibilityPresentation(
  avatarAvailable: boolean,
  avatarVisible: boolean,
): ArtistAvatarVisibilityPresentation {
  return {
    hidden: !avatarAvailable || !avatarVisible,
    disabled: !avatarAvailable,
    ariaPressed: !avatarVisible,
    label: "Hide avatar",
    ariaLabel: "Hide artist avatar",
  };
}

export function artistAvatarBorderPresentation(
  avatarAvailable: boolean,
  avatarVisible: boolean,
  borderVisible: boolean,
): ArtistAvatarBorderPresentation {
  const avatarShown = avatarAvailable && avatarVisible;
  return {
    drawn: avatarShown && borderVisible,
    disabled: !avatarShown,
    ariaPressed: borderVisible,
    ariaLabel: borderVisible
      ? "Hide artist avatar border"
      : "Show artist avatar border",
  };
}

/** WAI-ARIA radio-group movement, including wrapping at either edge. */
export function nextArtistAvatarPosition(
  current: ArtistAvatarPosition,
  key: string,
): ArtistAvatarPosition {
  const positions: ArtistAvatarPosition[] = ["left", "center", "right"];
  const index = positions.indexOf(normalizeArtistAvatarPosition(current));
  if (key === "Home") return positions[0];
  if (key === "End") return positions[positions.length - 1];
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return positions[(index - 1 + positions.length) % positions.length];
  }
  if (key === "ArrowRight" || key === "ArrowDown") {
    return positions[(index + 1) % positions.length];
  }
  return positions[index];
}

function imageUrl(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function fullscreenArtistVisuals(
  track: SCTrack,
  profile: SCUser | null,
): FullscreenArtistVisuals {
  return {
    bannerUrl: imageUrl(
      profile?.profile_header_url ?? track.user.profile_header_url,
    ),
    avatarUrl: imageUrl(profile?.avatar_url || track.user.avatar_url),
  };
}

/**
 * The native Spotify artwork surface is still used in cinema mode, but its
 * palette belongs to Spotify's last track. A normalized duplicate of the
 * current SoundCloud cover is used as WaveLink's blurred color backdrop. If
 * SoundCloud has no usable cover, cinema mode receives the same WaveLink
 * fallback artwork as every other track surface.
 */
export function fullscreenArtworkUrl(
  track: SCTrack,
  fallbackArtwork: string,
): string {
  const artwork = imageUrl(track.artwork_url).replace(
    "-large",
    "-t500x500",
  );
  return artwork || imageUrl(fallbackArtwork);
}

/**
 * Session-only profile cache. It also deduplicates concurrent user requests
 * without making a transient network or authentication error permanent for
 * the rest of the Spotify session.
 */
export class ArtistProfileCache {
  private readonly values = new Map<SoundCloudUrn, SCUser | null>();
  private readonly pending = new Map<SoundCloudUrn, Promise<SCUser | null>>();

  get(urn: SoundCloudUrn): SCUser | null | undefined {
    return this.values.get(urn);
  }

  load(
    urn: SoundCloudUrn,
    fetchProfile: () => Promise<SCUser>,
  ): Promise<SCUser | null> {
    if (this.values.has(urn)) {
      return Promise.resolve(this.values.get(urn) ?? null);
    }
    const existing = this.pending.get(urn);
    if (existing) return existing;

    const request = fetchProfile()
      .then((profile) => {
        this.values.set(urn, profile);
        return profile;
      })
      .catch(() => null)
      .finally(() => {
        if (this.pending.get(urn) === request) this.pending.delete(urn);
      });
    this.pending.set(urn, request);
    return request;
  }

  clear(): void {
    this.values.clear();
    this.pending.clear();
  }
}
