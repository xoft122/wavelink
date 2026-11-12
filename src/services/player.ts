// player.ts
import Hls from "hls.js";
import { type SCAacRendition, SCTrack, SCUser, SoundCloudUrn } from "../types/soundcloud";
import {
  createMediaSession,
  getLikedTrackIds,
  getMe,
  getRelatedTracks,
  getTrack,
  getUser,
  invalidateLikedTrackIds,
  isFollowingUser,
  recordTrackPlayHistory,
  unlikeTrack,
} from "./api";
import {
  configureSoundCloudMediaXhr,
  soundCloudMediaProxyUrl,
} from "./directSoundcloud";
import { log, warn, error as logError } from "./debug";
import {
  showSoundCloudFollowPrompt,
  showSoundCloudLikePrompt,
} from "./followPrompt";
import { isHlsSourceBufferCodecError } from "./hlsPlayback";
import {
  installSoftwareAacMediaFacade,
  SoftwareAacDecodeError,
  SoftwareAacPlayback,
} from "./softwareAacPlayback";
import {
  LikedTrackStatusDetail,
  canonicalLikedTrackId,
  publishLikedTrackStatus,
  subscribeLikedTrackStatus,
} from "./likedTrackStatus";
import { recordLocalPlayHistory } from "./localPlayHistory";
import {
  createLinuxMediaSessionBridge,
  type LinuxMediaSessionBridge,
  type LinuxMediaSessionTimeline,
} from "./linuxMediaSession";
import {
  canonicalPlaybackResumeOwnerUrn,
  clearPlaybackResumeState,
  loadPlaybackResumeState,
  resumePositionSeconds,
  savePlaybackResumeState,
} from "./playbackResume";
import {
  ArtistAvatarPosition,
  ArtworkBackgroundMode,
  ArtistProfileCache,
  artworkPanelsPresentation,
  artistAvatarBorderPresentation,
  artistAvatarVisibilityPresentation,
  artistToolbarPresentation,
  cinemaArtworkCoverTransform,
  cinemaPlayerGridOffset,
  cinemaPlayerPresentation,
  fullscreenArtistVisuals,
  fullscreenArtworkUrl,
  nextArtistAvatarPosition,
  nextArtworkBackgroundMode,
  normalizeArtistAvatarPosition,
  normalizeArtistAvatarBorderVisibility,
  normalizeArtistAvatarVisibility,
  normalizeArtworkBackgroundMode,
} from "./fullscreenArtistMode";
import {
  ArtworkPalette,
  ArtworkPaletteCache,
  FALLBACK_ARTWORK_PALETTE,
  loadArtworkPalette,
} from "./artworkPalette";
import { calculateMarqueeMotion } from "./marquee";
import {
  isAutomaticallySkippableMediaError,
  isTrackUnavailable,
  markTrackUnavailable,
  nextAvailableTrackIndex,
  previousAvailableTrackIndex,
  soundCloudErrorCountryCode,
  trackUnavailableLabel,
  unavailableReasonForError,
} from "./trackAvailability";
import {
  soundCloudTrackArtworkUrl,
  WAVELINK_TRACK_FALLBACK_ARTWORK,
} from "./trackArtwork";
import {
  classifySpotifyHandoff,
  ImageAttributeState,
  ImageOverlaySnapshot,
  isNativeSpotifyPlayIntent,
  normalizeSpotifyArtworkUrl,
  releaseImageOverlay,
  shouldBlockStaleSpotifyContextMenu,
  shouldBlockStaleSpotifyMetadataInteraction,
  shouldCompleteStableSpotifyHandoff,
  shouldRecoverSpotifyCover,
  updateImageOverlaySnapshot,
} from "./playerHandoffModel";
import { claimPlayHistoryAttempt } from "./playHistoryStatus";
import {
  findTrackQueueIndex,
  sameTrackQueue,
} from "./queueHydration";
import {
  paginationPrefetchIndex,
  type PaginatedTrackSource,
  type PaginatedTrackSourceSnapshot,
} from "./paginatedTrackSource";
import {
  openInWaveLink,
  WaveLinkNavigationTarget,
} from "./navigation";
import {
  classifyNativePanelAction,
  createPanelLikePresentation,
  NativePanelActionKind,
  performPanelLikeAction,
  WAVELINK_HEART_ICON,
} from "./panelActions";
import { nativeTransportControlCenters } from "./nativeTransportModel";
import { renderSoundCloudRepeatSvg } from "./soundCloudIcons";
import {
  SPOTIFY_SEARCH_INTEGRATION_STORAGE_KEY,
  dispatchSpotifySearchIntegrationChanged,
  readSpotifySearchIntegrationEnabled,
} from "./spotifySearchSetting";
import {
  nextSoundCloudAvatarSource,
  soundCloudAvatarSources,
  WAVELINK_USER_AVATAR_FALLBACK,
} from "./soundCloudImages";
import {
  DEFAULT_TRACKS_PER_LOAD,
  TRACKS_PER_LOAD_STORAGE_KEY,
  dispatchTracksPerLoadChanged,
  normalizeTracksPerLoad,
  readTracksPerLoad,
} from "./tracksPerLoadSetting";
import {
  DEFAULT_SOURCE_BADGE_PREFERENCES,
  SourceBadgeDisplayMode,
  SourceBadgeHoverZone,
  SourceBadgePreferences,
  SourceBadgeSide,
  SourceBadgeSource,
  createSourceBadgeHoverZone,
  isPointInsideSourceBadgeHoverZone,
  normalizeSourceBadgePreferences,
  sourceBadgeFullscreenPlayerHidden,
  sourceBadgeHomeBounds,
  sourceBadgePresentation,
  sourceBadgeSideForHomeArea,
} from "./sourceBadgeModel";

export type RepeatMode = "off" | "all" | "one";

export interface PlaybackContext {
  label: string;
  target?: WaveLinkNavigationTarget;
}

export interface PlayerState {
  track: SCTrack | null;
  isPlaying: boolean;
  position: number; // 0-1
  duration: number; // seconds
  volume: number;
  isMuted: boolean;
  isLoading: boolean;
  error: string | null;
  notice: string | null;
  scVolMultEnabled: boolean;
  scVolumeLevel: number;
  queue: SCTrack[];
  queueIndex: number;
  /** Exact source total when known; may be larger than the loaded queue. */
  queueTotal: number;
  queueHasMore: boolean;
  queueLoadingMore: boolean;
  queueLoadError: string | null;
  context: PlaybackContext;
  shuffle: boolean;
  repeat: RepeatMode;
  autoplayRelated: boolean;
  tracksPerLoad: number;
  spotifySearchIntegrationEnabled: boolean;
  sourceBadgePreferences: SourceBadgePreferences;
}

type Listener = (state: PlayerState) => void;

interface QueueEntry {
  token: number;
  track: SCTrack;
  context: PlaybackContext;
}

type MetadataRole = "title" | "artist";
type MetadataSurface = "bar" | "panel";

interface MetadataTarget {
  host: HTMLElement;
  role: MetadataRole;
  surface: MetadataSurface;
}

interface MetadataBinding extends MetadataTarget {
  viewport: HTMLSpanElement;
  content: HTMLSpanElement;
  observer: ResizeObserver | null;
  animation: Animation | null;
  signature: string;
  measureFrame: number | null;
  originalAriaLabel: string | null;
  originalTitle: string | null;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onFocusIn: () => void;
  onFocusOut: () => void;
}

interface HiddenNativeSnapshot {
  ariaHidden: string | null;
  inert: boolean;
}

interface NativeInteractionBinding {
  element: HTMLElement;
  href: string | null;
  tabIndex: string | null;
  ariaDisabled: string | null;
  inert: boolean;
  block: (event: Event) => void;
  blockKey: (event: Event) => void;
}

interface PanelSurfaceBinding {
  root: HTMLElement;
  contextButton: HTMLButtonElement | null;
  likeButton: HTMLButtonElement | null;
  likeSignature: string;
  creditsSection: HTMLElement | null;
  queueSection: HTMLElement | null;
  signature: string;
  contextTarget: WaveLinkNavigationTarget;
}

interface BarSurfaceBinding {
  root: HTMLElement;
  likeButton: HTMLButtonElement;
  likeSignature: string;
  originalAriaLabel: string | null;
  appliedAriaLabel: string;
}

interface OwnedCoverBinding {
  root: HTMLElement;
  host: HTMLElement;
  image: HTMLImageElement;
}

interface CinemaArtistBinding {
  root: HTMLElement;
  artworkBackground: HTMLElement;
  artworkBackdrop: HTMLImageElement;
  artworkCover: HTMLImageElement;
  artworkForeground: HTMLElement;
  artworkModeControl: HTMLElement;
  artworkModeButtons: HTMLButtonElement[];
  overlay: HTMLElement;
  overlayHost: HTMLElement | null;
  backdrop: HTMLImageElement;
  avatar: HTMLImageElement;
  toolbar: HTMLElement;
  avatarToggle: HTMLButtonElement;
  borderToggle: HTMLButtonElement;
  positionButtons: HTMLButtonElement[];
  artistModeButton: HTMLElement | null;
  artistInteractionTarget: HTMLElement | null;
  artistControlAbort: AbortController | null;
  artistAriaChecked: string | null;
  artistAriaDisabled: string | null;
  artistDisabled: string | null;
  artistTabIndex: string | null;
  artistObserver: MutationObserver | null;
  artworkButton: HTMLElement | null;
  artworkAriaChecked: string | null;
  artworkTabIndex: string | null;
  artworkOverridden: boolean;
  nativeModeButtons: Set<HTMLElement>;
  controlsLayer: HTMLElement | null;
  foregroundLayers: Set<HTMLElement>;
  playerLayer: HTMLElement | null;
  scrollViewport: HTMLElement | null;
  scrollAbort: AbortController | null;
  scrollFrame: number | null;
  scrollSettleTimer: number | null;
  scrollActive: boolean;
  scrollPresentationKey: string;
  nativeArtworkCover: HTMLImageElement | null;
  artworkCoverBaseWidth: number;
  artworkCoverBaseHeight: number;
  artworkLayoutFrame: number | null;
  toolbarActivityAbort: AbortController;
  toolbarHideTimer: number | null;
  toolbarLastActivityAtMs: number;
  toolbarKeyboardModality: boolean;
  toolbarKeyboardFocusWithin: boolean;
  toolbarArtistModeActive: boolean | null;
  playerHideTimer: number | null;
  playerLastActivityAtMs: number;
  playerKeyboardModality: boolean;
  playerModeActive: boolean | null;
  playerGridOffsetPx: number;
  artworkSignature: string;
  paletteSignature: string;
  signature: string;
}

interface FollowState {
  following: boolean;
  resolved: boolean;
  generation: number;
}

interface LikeState {
  liked: boolean;
  resolved: boolean;
  busy: boolean;
  generation: number;
}

interface NativePanelAction {
  element: HTMLElement;
  kind: NativePanelActionKind;
}

interface NativePanelActionCluster {
  container: HTMLElement;
  hiddenTargets: HTMLElement[];
  likeAnchor: HTMLElement | null;
}

type AdvanceReason = "manual" | "ended";
type TrackLoadResult = "loaded" | "stale" | "unavailable" | "failed";

interface SpotifyCoverRecoveryCandidate {
  uri: string;
  src: string;
  alt: string;
}

interface SpotifyCoverRecoveryBinding {
  host: HTMLElement;
  image: HTMLImageElement;
}

const STORAGE_KEYS = {
  shuffle: "wavelink:shuffle-enabled",
  repeat: "wavelink:repeat-mode",
  autoplayRelated: "wavelink:autoplay-related-enabled",
  cinemaAvatarPosition: "wavelink:cinema-avatar-position",
  cinemaAvatarVisible: "wavelink:cinema-avatar-visible",
  cinemaAvatarBorderVisible: "wavelink:cinema-avatar-border-visible",
  cinemaArtworkBackgroundMode:
    "wavelink:cinema-artwork-background-mode",
  sourceBadgeEnabled: "wavelink:source-badge-enabled",
  sourceBadgeSide: "wavelink:source-badge-position",
  sourceBadgeDodgeOnHover: "wavelink:source-badge-dodge-on-hover",
  sourceBadgeLinkEnabled: "wavelink:source-badge-clickable",
  sourceBadgeDisplayMode: "wavelink:source-badge-display-mode",
  sourceBadgeHideWithFullscreenPlayer:
    "wavelink:source-badge-hide-with-cinema-player",
} as const;

const DEFAULT_PLAYBACK_CONTEXT: PlaybackContext = {
  label: "WaveLink · SoundCloud",
  target: { kind: "main", tab: "home" },
};

const CINEMA_ARTWORK_SCROLL_SETTLE_MS = 140;

function trackKey(track: SCTrack): string {
  return track.urn || track.id || track.permalink_url;
}

function hashString(value: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Fisher-Yates driven by a stable queue-derived seed. The same canonical
 * queue always produces the same order, so toggling shuffle does not slowly
 * destroy the user's original ordering or re-roll on every React render.
 */
function deterministicShuffle(
  entries: readonly QueueEntry[],
  canonical: readonly QueueEntry[],
): QueueEntry[] {
  let seed = 0x811c9dc5;
  canonical.forEach((entry, index) => {
    seed = hashString(`${index}:${trackKey(entry.track)}|`, seed);
  });
  const shuffled = [...entries];
  for (let index = shuffled.length - 1; index > 0; index--) {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    const random = ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    const swapIndex = Math.floor(random * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

// ── Spotify DOM selectors ─────────────────────────────────────────────────────
const SEL_TITLE = [
  ".main-trackInfo-name:not([data-encore-id])", // outer layout container — correct ::before positioning
  '[data-encore-id="text"].main-trackInfo-name', // fallback: inner Encore text node
  ".main-trackInfo-name",
  '[data-testid="context-item-info-title"]',
  ".now-playing__name",
];
const SEL_ARTIST = [
  '[data-testid="now-playing-widget-v2-byline"]',
  ".main-trackInfo-artists:not([data-encore-id])", // outer layout container — correct ::before positioning
  '[data-encore-id="text"].main-trackInfo-artists', // fallback: inner Encore text node
  ".main-trackInfo-artists",
  '[data-testid="context-item-info-subtitles"]',
  ".now-playing__artist",
];
const SEL_BAR_WIDGET = [
  '[data-testid="now-playing-widget-v2"]',
  '[data-testid="now-playing-widget"]',
  ".main-nowPlayingWidget-nowPlaying",
];
const SEL_PLAYER_BAR = [
  '[data-testid="now-playing-bar"]',
  ".Root__now-playing-bar",
];
const SEL_PANEL_ROOT = [
  "[data-wl-cinema-root]",
  "[data-npv-root]",
  ".NowPlayingView",
  ".main-nowPlayingView-nowPlayingWidget",
  // Spotify's cinema / fullscreen now-playing surface is a separate tree,
  // not the compact right-sidebar NPV. The stable root class is shared by
  // windowed cinema mode and the real OS fullscreen variant.
  ".Root__cinema-view",
];
const CINEMA_ROOT_SELECTOR = ".Root__cinema-view, [data-wl-cinema-root]";
const SEL_PANEL_ARTIST_ABOUT = [
  'div:has(> [data-testid="npv-artist-bio-button"])',
  // Spotify's NPVArtistAboutV2 card; desktop builds can strip the test ID.
  ".wYZcnNTqrjqNPCkIwTZt",
].join(", ");
const SEL_PANEL_META_ROOT = [
  ".main-nowPlayingView-trackInfo",
  ".main-nowPlayingView-contextItemInfo",
];
const SEL_PANEL_TITLE_FALLBACK = [
  ".main-trackInfo-name:not([data-encore-id])",
  '[data-testid="context-item-info-title"]',
  ".main-trackInfo-name",
  // Spotify NPV v2 currently has no semantic class on this title. Exact-text
  // discovery below is preferred; this only covers the installed fallback.
  ".kB6nE36AZys04vlP",
];
const SEL_PANEL_ARTIST_FALLBACK = [
  ".main-trackInfo-artists:not([data-encore-id])",
  '[data-testid="context-item-info-subtitles"]',
  ".main-trackInfo-artists",
  'a[href*="/artist/"] [data-encore-id="text"]',
  'a[href*="/artist/"]',
];
const SEL_POS_TEXT = [
  '[data-testid="playback-position"]',
  ".playback-progressbar__time-elapsed",
];
const SEL_DUR_TEXT = [
  '[data-testid="playback-duration"]',
  ".playback-progressbar__time-total",
];
//delete SEL_PROGRESS array as it is no longer used
const SEL_VOLUME = [
  '[data-testid="volume-bar"] input[type="range"]',
  'input[aria-label*="volume" i]',
  'input[aria-label*="Lautstärke" i]',
  'input[aria-label*="Volumen" i]',
  '.volume-bar input[type="range"]',
];
const SEL_SKIP_FWD = [
  '[data-testid="control-button-skip-forward"]',
  'button[aria-label*="Next" i]',
];
const SEL_SKIP_BCK = [
  '[data-testid="control-button-skip-back"]',
  'button[aria-label*="Previous" i]',
];
const SEL_PLAYPAUSE = ['[data-testid="control-button-playpause"]'];
const SEL_PROGRESS_WRAP = [
  '[data-testid="playback-progressbar"]',
  ".playback-progressbar",
];
const SEL_TRANSPORT_ROW = [
  '[data-testid="player-controls"] .player-controls__buttons',
  ".main-nowPlayingBar-center .player-controls__buttons",
  ".player-controls__buttons",
];

function q<T extends Element = Element>(sels: string[]): T | null {
  for (const s of sels) {
    const el = document.querySelector<T>(s);
    if (el) return el;
  }
  return null;
}

function fmtTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60),
    sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function qWithin<T extends Element = Element>(
  root: ParentNode,
  sels: string[],
): T | null {
  for (const selector of sels) {
    const element = root.querySelector<T>(selector);
    if (element) return element;
  }
  return null;
}

function qAllUnique<T extends HTMLElement = HTMLElement>(
  selectors: string[],
): T[] {
  const result: T[] = [];
  for (const selector of selectors) {
    for (const element of Array.from(document.querySelectorAll<T>(selector))) {
      if (
        result.some(
          (existing) =>
            existing === element ||
            existing.contains(element) ||
            element.contains(existing),
        )
      ) {
        continue;
      }
      result.push(element);
    }
  }
  return result;
}

function restoreAttribute(element: Element, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function setAttributeIfChanged(
  element: Element,
  name: string,
  value: string,
): void {
  if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setStylePropertyIfChanged(
  element: HTMLElement,
  name: string,
  value: string,
): void {
  if (element.style.getPropertyValue(name) !== value) {
    element.style.setProperty(name, value);
  }
}

function normalizeMetadataText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizePlaybackContext(
  context?: PlaybackContext,
): PlaybackContext {
  const label = normalizeMetadataText(context?.label);
  return {
    label: label || DEFAULT_PLAYBACK_CONTEXT.label,
    target: context?.target ?? DEFAULT_PLAYBACK_CONTEXT.target,
  };
}

function safeVolume(value: number, fallback = 0.5): number {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(1, value))
    : Math.max(0, Math.min(1, fallback));
}

//Delete the nativeRangeSet, as it is no longer used.

// Pause-icon SVG as data-URL for CSS mask (matches Spotify's icon style).
const PAUSE_ICON_URL =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2.7 1a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7H2.7zm8 0a.7.7 0 0 0-.7.7v12.6a.7.7 0 0 0 .7.7h2.6a.7.7 0 0 0 .7-.7V1.7a.7.7 0 0 0-.7-.7h-2.6z'/%3E%3C/svg%3E\")";

class SoundCloudPlayer {
  private audio: HTMLAudioElement;
  private linuxMediaSession: LinuxMediaSessionBridge;
  private hls: Hls | null = null;
  private softwareAac: SoftwareAacPlayback | null = null;
  private readonly _softwareAacFallbackTracks = new Map<string, SCAacRendition>();
  private _softwareAacRecoveryLoadId: number | null = null;
  private softwareAacContext: AudioContext | null = null;
  private _track: SCTrack | null = null;
  private _isLoading = false;
  private _error: string | null = null;
  private _notice: string | null = null;
  private _loadId = 0;
  private _historyAttemptedLoadId = -1;
  /** Canonical order supplied by the user/source; never shuffled in place. */
  private originalQueue: QueueEntry[] = [];
  /** Effective playback order. PlayerState.queue and queueIndex refer here. */
  private queue: QueueEntry[] = [];
  private queueIndex = -1;
  private _nextQueueToken = 1;
  private _queueRevision = 0;
  private _queueSource: PaginatedTrackSource | null = null;
  private _queueSourceSnapshot: PaginatedTrackSourceSnapshot | null = null;
  private _queueSourceUnsubscribe: (() => void) | null = null;
  private _queueSourceGeneration = 0;
  private _queueSourceLoadedCount = 0;
  private _queueSourceLoadPromise: Promise<boolean> | null = null;
  private _shuffle = false;
  private _repeat: RepeatMode = "off";
  private _autoplayRelated = true;
  private _tracksPerLoad = DEFAULT_TRACKS_PER_LOAD;
  private _spotifySearchIntegrationEnabled = true;
  private _advancePromise: Promise<void> | null = null;
  private _relatedPromise: Promise<boolean> | null = null;
  private listeners: Set<Listener> = new Set();
  private progressTimer: ReturnType<typeof setInterval> | null = null;
  // Native pause events can arrive late or in batches. Suppress every echo in
  // a short window instead of relying on a one-shot boolean that can be
  // consumed by the wrong event.
  private _suppressSpotifyEventsUntil = 0;
  // Spotify can emit a delayed songchange for the already-paused background
  // item while WaveLink is taking control. Keep its URI so that stale echo
  // cannot tear down a newly started SoundCloud source.
  private _spotifyBaselineUri: string | null = null;
  private _spotifySongChangeTimer: number | null = null;
  private _resumeOwnerUrn: SoundCloudUrn | null = null;
  private _resumeInitializationOwnerUrn: SoundCloudUrn | null = null;
  private _resumeInitializationPromise: Promise<void> | null = null;
  private _resumeInitializationGeneration = 0;
  private _resumeRestoring = false;
  private _resumeUnloading = false;
  private _playRequestedWhileLoading = false;
  private _resumePendingSeek: {
    trackKey: string;
    loadId: number;
    positionMs: number;
    streamRecovery?: true;
  } | null = null;
  private _resumeLastSavedAt = 0;
  private _resumeLastSavedTrackKey = "";
  private _resumeLastSavedQueueRevision = -1;
  private _resumeLastSavedPositionBucket = -1;
  private _resumeSaveRetryAfter = 0;
  private _sourceBadge: HTMLAnchorElement | null = null;
  private _sourceBadgeSource: SourceBadgeSource = null;
  private _sourceBadgePreferences: SourceBadgePreferences = {
    ...DEFAULT_SOURCE_BADGE_PREFERENCES,
  };
  private _sourceBadgeRuntimeSide: SourceBadgeSide =
    DEFAULT_SOURCE_BADGE_PREFERENCES.side;
  private _sourceBadgeHoverReturnZone: SourceBadgeHoverZone | null = null;
  private _sourceBadgeCinemaObserver: MutationObserver | null = null;
  private _sourceBadgeObservedCinemaRoots = new Set<HTMLElement>();
  private _globalControls: HTMLElement | null = null;
  private _nativeControls: HTMLElement | null = null;
  private _nativeControlsHost: HTMLElement | null = null;
  private _nativeControlsPositionFrame: number | null = null;
  private _nativeQueuePopover: HTMLElement | null = null;
  private _nativeQueueOpen = false;
  private _nativeQueueSignature = "";
  private _nativeQueueScrollFrame: number | null = null;
  private _nativeDismissBound = false;
  private _tryHookSkipButtons: (() => void) | null = null;
  private _tryHookProgressBar: (() => void) | null = null;
  private _tryHookVolumeInput: (() => void) | null = null;
  private _tryEnsureNativeControls: (() => void) | null = null;
  // Seek guard — when user is dragging the progress bar we must not overwrite
  // the range input's value or the thumb snaps back every 250 ms.
  private _isSeeking = false;
  // Live reference to the progress-bar wrapper + a one-time flag for the
  // document-level pointer-up listener that ends a seek (see hookProgressBar).
  private _progressWrap: HTMLElement | null = null;
  private _seekDocBound = false;
  // Our own progress bar, overlaid on Spotify's (whose fill/thumb/hover-tooltip
  // are bound to Spotify's own paused track length and so can't reflect the SC
  // track). Fully driven by SC position — see ensureProgressOverlay().
  private _progressOverlay: HTMLElement | null = null;
  // Always-on interval that keeps the source badge in sync with whatever is
  // actually playing (SoundCloud vs Spotify), even when no SC track is loaded
  // and the 250 ms SC timer isn't running.
  private badgeTimer: ReturnType<typeof setInterval> | null = null;
  // Mute-state cache — avoids querySelectorAll("audio") on every 250 ms tick.
  private _spotifyMuted = false;
  private _muteCheckAt = 0;
  // Cached now-playing bar elements — re-queried only when detached.
  private _metadataBindings = new Map<HTMLElement, MetadataBinding>();
  private _coverSnapshots = new Map<HTMLImageElement, ImageOverlaySnapshot>();
  private _ownedCoverBindings = new Map<HTMLElement, OwnedCoverBinding>();
  private _failedCoverSources = new Set<string>();
  private _spotifyCoverRecoveryCandidate: SpotifyCoverRecoveryCandidate | null =
    null;
  private _spotifyCoverRecoveryBindings = new Map<
    HTMLElement,
    SpotifyCoverRecoveryBinding
  >();
  private _spotifyCoverRecoveryTimers = new Set<number>();
  private readonly _onStaleSpotifyContextMenu = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const element = target instanceof Element ? target : target.parentElement;
    if (!element) return;
    const coverSurface = !!element.closest(
      [
        ".wl-sc-cover",
        ".wl-sc-cover-host",
        ".main-nowPlayingWidget-coverArt",
        ".main-coverSlotCollapsed-container",
        '[data-testid="cover-art-container"]',
        '[data-testid="CoverSlotCollapsed__container"]',
        '.wl-sc-panel-surface [data-testid="cover-art-slot"]',
        '.wl-sc-panel-surface [data-testid="track-visual-enhancement"]',
        ".wl-sc-panel-surface .main-nowPlayingView-coverArtVisualEnhancement",
        ".wl-sc-panel-surface .main-nowPlayingView-coverArt",
        ".wl-sc-panel-surface .main-nowPlayingView-coverArtContainer",
      ].join(", "),
    );
    const cinemaSurface = !!element.closest(CINEMA_ROOT_SELECTOR);
    const playerBarMetadataSurface = !!element.closest(
      ".wl-sc-meta-host.wl-sc-meta-bar",
    );
    const panelTitleSelector =
      '.wl-sc-meta-host.wl-sc-meta-panel[data-wl-meta="title"]';
    const panelArtistSelector =
      '.wl-sc-meta-host.wl-sc-meta-panel[data-wl-meta="artist"]';
    const panelMetadataSelector = [
      panelTitleSelector,
      panelArtistSelector,
    ].join(", ");
    const panelMetadataSurface = !!element.closest(panelMetadataSelector);
    if (
      !shouldBlockStaleSpotifyContextMenu({
        wavelinkActive:
          this._track !== null &&
          document.body.classList.contains("sc-active"),
        coverSurface,
        cinemaSurface,
        playerBarMetadataSurface,
        panelMetadataSurface,
      })
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  private panelMetadataInteractionBoundary(
    panelRoot: HTMLElement,
  ): HTMLElement | null {
    const titleHost = panelRoot.querySelector<HTMLElement>(
      '.wl-sc-meta-host.wl-sc-meta-panel[data-wl-meta="title"]',
    );
    const artistHost = panelRoot.querySelector<HTMLElement>(
      '.wl-sc-meta-host.wl-sc-meta-panel[data-wl-meta="artist"]',
    );
    if (!titleHost || !artistHost) return null;

    const trackInfo = panelRoot.querySelector<HTMLElement>(
      ".main-nowPlayingView-trackInfo"
    );
    if (
      trackInfo &&
      trackInfo.contains(titleHost) &&
      trackInfo.contains(artistHost)
    ) {
      return trackInfo;
    }

    // Cross-version fallback: the lowest common ancestor of only the two
    // role-qualified hosts. Never promote into Spotify's action-bearing
    // context wrapper or the whole panel.
    let common = titleHost as HTMLElement | null;
    while (
      common &&
      common !== panelRoot &&
      !common.contains(artistHost)
    ) {
      common = common.parentElement;
    }
    if (
      !common ||
      common === panelRoot ||
      common.matches(".main-nowPlayingView-contextItemInfo")
    ) {
      return null;
    }
    return common;
  }

  private readonly _onStaleSpotifyMetadataInteraction = (
    event: MouseEvent,
  ): void => {
    const path = event.composedPath();
    const candidates: Element[] = [];
    for (const candidate of [...path, event.target]) {
      if (candidate instanceof Element && !candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
    if (candidates.length === 0) return;

    // WaveLink-owned controls (like/follow/queue actions) can share the same
    // structural row and must retain their own interaction handlers.
    const waveLinkOwnedPath = candidates.some((candidate) =>
      candidate.closest("[data-wl-owned]"),
    );

    const panelTitleSelector =
      '.wl-sc-meta-host.wl-sc-meta-panel[data-wl-meta="title"]';
    const panelArtistSelector =
      '.wl-sc-meta-host.wl-sc-meta-panel[data-wl-meta="artist"]';
    const panelMetadataSelector = [
      panelTitleSelector,
      panelArtistSelector,
    ].join(", ");
    const directMetadataSelector = [
      ".wl-sc-meta-host.wl-sc-meta-bar",
      panelMetadataSelector,
    ].join(", ");
    const directOwnedMetadataPath = candidates.some((candidate) =>
      candidate.closest(directMetadataSelector),
    );

    const candidatePanelRoots = new Set<HTMLElement>();
    for (const candidate of candidates) {
      const root = candidate.closest<HTMLElement>(".wl-sc-panel-surface");
      if (root) candidatePanelRoots.add(root);
    }
    let metadataBoundary: HTMLElement | null = null;
    let candidateInsideMetadataBoundary = false;
    for (const panelRoot of candidatePanelRoots) {
      const boundary = this.panelMetadataInteractionBoundary(panelRoot);
      const inside = Boolean(
        boundary &&
          candidates.some(
            (candidate) =>
              candidate === boundary || boundary.contains(candidate),
          ),
      );
      if (boundary && inside) {
        metadataBoundary = boundary;
        candidateInsideMetadataBoundary = true;
        break;
      }
    }
    const safePanelMetadataBoundary = Boolean(metadataBoundary);
    const metadataBoundaryContainsOwnedTitle = Boolean(
      metadataBoundary?.querySelector<HTMLElement>(panelTitleSelector),
    );
    const metadataBoundaryContainsOwnedArtist = Boolean(
      metadataBoundary?.querySelector<HTMLElement>(panelArtistSelector),
    );

    if (
      !shouldBlockStaleSpotifyMetadataInteraction({
        wavelinkActive:
          this._track !== null &&
          document.body.classList.contains("sc-active"),
        eventType: event.type,
        directOwnedMetadataPath,
        candidateInsideMetadataBoundary,
        safePanelMetadataBoundary,
        metadataBoundaryContainsOwnedTitle,
        metadataBoundaryContainsOwnedArtist,
        waveLinkOwnedPath,
      })
    ) {
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  private readonly _onCoverImageError = (event: Event): void => {
    const image = event.currentTarget;
    if (
      !(image instanceof HTMLImageElement) ||
      !this._coverSnapshots.has(image)
    ) {
      return;
    }
    const failedSource = image.getAttribute("src");
    if (
      !failedSource ||
      failedSource === WAVELINK_TRACK_FALLBACK_ARTWORK
    ) {
      return;
    }
    this._failedCoverSources.add(failedSource);
    // Re-enter the snapshot-aware path. Writing the fallback directly here
    // would make it look like a Spotify mutation during the later handoff.
    this.applyTrackInfo();
    if (this._track) this.activateLinuxMediaSession(this._track);
  };
  private _barSurfaces = new Map<HTMLElement, BarSurfaceBinding>();
  private _panelSurfaces = new Map<HTMLElement, PanelSurfaceBinding>();
  private _cinemaArtistSurfaces = new Map<HTMLElement, CinemaArtistBinding>();
  private _semanticCinemaRoots = new Set<HTMLElement>();
  private _hiddenNative = new Map<HTMLElement, HiddenNativeSnapshot>();
  private _blockedNative = new Map<HTMLElement, NativeInteractionBinding>();
  private _followStates = new Map<string, FollowState>();
  private _likeStates = new Map<SoundCloudUrn, LikeState>();
  private _pendingExternalLikeIds = new Set<SoundCloudUrn>();
  private _likeRefreshInFlight = false;
  private _unsubscribeLikedTrackStatus: (() => void) | null = null;
  private _ownUserUrn: string | null = null;
  private _ownUserRequested = false;
  private _cachedPosEl: Element | null = null;
  private _cachedDurEl: Element | null = null;
  private _cachedRangeEl: HTMLInputElement | null = null;
  // Direct references to the SC progress-overlay children (never re-query).
  private _progressFill: HTMLElement | null = null;
  private _progressThumb: HTMLElement | null = null;
  private readonly _artistProfileCache = new ArtistProfileCache();
  private _activeArtistProfile: SCUser | null = null;
  private _cinemaArtistMode = false;
  private _cinemaModeInitialized = false;
  private _cinemaAvatarVisible = true;
  private _cinemaAvatarBorderVisible = true;
  private _cinemaAvatarPosition: ArtistAvatarPosition = "center";
  private _cinemaArtworkBackgroundMode: ArtworkBackgroundMode = "blurred";
  private readonly _artworkPaletteCache = new ArtworkPaletteCache();
  private readonly _failedCinemaArtworkSources = new Set<string>();

  //Allow SC tracks to be quieter than Spotify's master volume
  //Added other properties for Spotify slider to visually switch to the SC volume when SC plays, 
  //and restore Spotify volume when SC stops
  private _scVolMultEnabled: boolean = true;
  private _scVolumeLevel: number = 0.5;
  private _savedSpotifyVolume: number | null = null;
  private _isUpdatingSpotifyRange: boolean = false;
  private readonly _onCinemaArtistModeClick = (event: Event) => {
    if (!this._track) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (this._cinemaArtistMode) {
      this.applyTrackInfo();
      return;
    }
    for (const binding of this._cinemaArtistSurfaces.values()) {
      if (!binding.artworkButton) continue;
      binding.artworkAriaChecked =
        binding.artworkButton.getAttribute("aria-checked");
      binding.artworkTabIndex = binding.artworkButton.getAttribute("tabindex");
    }
    this._cinemaArtistMode = true;
    this.applyTrackInfo();
  };

  private readonly _onCinemaNativeModeClick = () => {
    if (!this._track || !this._cinemaArtistMode) return;
    this._cinemaArtistMode = false;
    this.applyTrackInfo();
  };

  private readonly _onCinemaArtistModeKeyDown = (event: KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowUp", "Home"].includes(event.key)) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const root = target.closest<HTMLElement>(CINEMA_ROOT_SELECTOR);
    const artwork = root
      ? this._cinemaArtistSurfaces.get(root)?.artworkButton
      : null;
    if (!artwork) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    artwork.focus();
    artwork.click();
  };

  private readonly _onCinemaArtworkModeKeyDown = (event: KeyboardEvent) => {
    if (!["ArrowRight", "ArrowDown", "End"].includes(event.key)) return;
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    const root = target.closest<HTMLElement>(CINEMA_ROOT_SELECTOR);
    const artist = root
      ? this._cinemaArtistSurfaces.get(root)?.artistModeButton
      : null;
    if (!artist) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    artist.focus();
    artist.click();
  };

  private readonly _onNativeDocumentPointerDown = (event: PointerEvent) => {
    if (!this._nativeQueueOpen) return;
    const target = event.target as Node | null;
    if (
      target &&
      (this._nativeControls?.contains(target) ||
        this._nativeQueuePopover?.contains(target))
    ) {
      return;
    }
    this.closeNativeQueue();
  };

  private readonly _onNativeDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this._nativeQueueOpen) {
      event.stopPropagation();
      this.closeNativeQueue(true);
    }
  };

  private readonly _onNativeWindowResize = () => {
    this.scheduleNativeControlsPosition();
    if (this._nativeQueueOpen) this.positionNativeQueue();
    this.resetSourceBadgeHoverDodge();
  };

  private readonly _onNativeQueueScroll = (event: Event) => {
    const list = event.currentTarget;
    if (!(list instanceof HTMLElement)) return;
    if (this._nativeQueueScrollFrame !== null) return;
    this._nativeQueueScrollFrame = window.requestAnimationFrame(() => {
      this._nativeQueueScrollFrame = null;
      if (!this._nativeQueueOpen || !this.queueSourceHasMore()) return;
      const viewportTop = list.scrollTop;
      const viewportBottom = viewportTop + list.clientHeight;
      let lastVisibleIndex = -1;
      for (const item of Array.from(
        list.querySelectorAll<HTMLElement>(
          ".wl-native-queue-item[data-wl-queue-index]",
        ),
      )) {
        const top = item.offsetTop;
        if (top >= viewportBottom) break;
        if (top + item.offsetHeight <= viewportTop) continue;
        const index = Number(item.dataset.wlQueueIndex);
        if (Number.isSafeInteger(index)) lastVisibleIndex = index;
      }
      this.maybePrefetchQueueForIndex(lastVisibleIndex);
    });
  };

  private spotifyMetadataArtworkUrl(): string | null {
    try {
      const metadata = (
        Spicetify.Player as unknown as {
          data?: {
            item?: { metadata?: Record<string, unknown> };
          };
        }
      ).data?.item?.metadata;
      if (!metadata) return null;
      for (const key of [
        "image_xlarge_url",
        "image_large_url",
        "image_url",
        "image_small_url",
      ]) {
        const source = normalizeSpotifyArtworkUrl(metadata[key]);
        if (source) return source;
      }
    } catch {}
    return null;
  }

  private spotifyArtworkFromSrcset(value: string | null): string | null {
    if (!value) return null;
    for (const candidate of value.split(",")) {
      const source = normalizeSpotifyArtworkUrl(
        candidate.trim().split(/\s+/, 1)[0],
      );
      if (source) return source;
    }
    return null;
  }

  private captureSpotifyCoverRecovery(
    uri: string,
  ): SpotifyCoverRecoveryCandidate | null {
    if (this.spotifyItemUri() !== uri) return null;
    let src = this.spotifyMetadataArtworkUrl();

    // Older Spotify builds do not always publish an image_* metadata field.
    // The snapshot still contains the untouched pre-WaveLink cover in that
    // case, so use it only after validating that it is a Spotify CDN image.
    if (!src) {
      for (const snapshot of this._coverSnapshots.values()) {
        src =
          normalizeSpotifyArtworkUrl(snapshot.native.src) ??
          this.spotifyArtworkFromSrcset(snapshot.native.srcset);
        if (src) break;
      }
    }
    if (!src) {
      for (const { host } of this.spotifyCoverRecoverySurfaces()) {
        for (const image of Array.from(
          host.querySelectorAll<HTMLImageElement>('img:not([data-wl-owned])'),
        )) {
          src =
            normalizeSpotifyArtworkUrl(image.currentSrc) ??
            normalizeSpotifyArtworkUrl(image.getAttribute("src")) ??
            this.spotifyArtworkFromSrcset(image.getAttribute("srcset"));
          if (src) break;
        }
        if (src) break;
      }
    }
    if (!src) return null;

    const native = this.getNativeMetadata();
    const artist = native.artists.join(", ");
    return {
      uri,
      src,
      alt: native.title
        ? `${native.title}${artist ? ` — ${artist}` : ""}`
        : "Spotify cover",
    };
  }

  private compactSpotifyCoverPresent(root: HTMLElement): boolean {
    return Array.from(
      root.querySelectorAll<HTMLImageElement>('img:not([data-wl-owned])'),
    ).some(
      (image) =>
        normalizeSpotifyArtworkUrl(image.currentSrc) !== null ||
        normalizeSpotifyArtworkUrl(image.getAttribute("src")) !== null ||
        this.spotifyArtworkFromSrcset(image.getAttribute("srcset")) !== null,
    );
  }

  private removeSpotifyCoverRecoveryOverlay(host?: HTMLElement): void {
    const release = (
      bindingHost: HTMLElement,
      binding: SpotifyCoverRecoveryBinding,
    ): void => {
      binding.image.remove();
      binding.host.classList.remove("wl-spotify-cover-recovery-host");
      this._spotifyCoverRecoveryBindings.delete(bindingHost);
    };
    if (host) {
      const binding = this._spotifyCoverRecoveryBindings.get(host);
      if (binding) release(host, binding);
      return;
    }
    for (const [bindingHost, binding] of Array.from(
      this._spotifyCoverRecoveryBindings,
    )) {
      release(bindingHost, binding);
    }
  }

  private cancelSpotifyCoverRecovery(): void {
    for (const timer of this._spotifyCoverRecoveryTimers) {
      window.clearTimeout(timer);
    }
    this._spotifyCoverRecoveryTimers.clear();
    this.removeSpotifyCoverRecoveryOverlay();
    this._spotifyCoverRecoveryCandidate = null;
  }

  private spotifyNotePlaceholderVisible(
    note: HTMLElement | null,
  ): note is HTMLElement {
    if (!note?.isConnected || note.hidden) return false;
    try {
      const style = window.getComputedStyle(note);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        Number(style.opacity || "1") > 0
      );
    } catch {
      return true;
    }
  }

  private spotifyCoverRecoverySurfaces(): Array<{
    host: HTMLElement;
    note: HTMLElement | null;
  }> {
    const surfaces = new Map<
      HTMLElement,
      { host: HTMLElement; note: HTMLElement | null }
    >();
    const useSurface = (
      host: HTMLElement | null,
      note: HTMLElement | null,
    ): void => {
      if (!host) return;
      const previous = surfaces.get(host);
      surfaces.set(host, {
        host,
        note: note ?? previous?.note ?? null,
      });
    };

    for (const barWidget of this.playerBarWidgets()) {
      const note =
        barWidget.querySelector<HTMLElement>(".cover-art-icon") ??
        barWidget.querySelector<SVGElement>(
          '[data-testid="cover-art-button"] svg',
        )?.parentElement ?? null;
      const nativeCover = qWithin<HTMLImageElement>(barWidget, [
        '[data-testid="cover-art-container"] img:not([data-wl-owned])',
        '[data-testid="CoverSlotCollapsed__container"] img:not([data-wl-owned])',
        '[data-testid="cover-art-button"] img:not([data-wl-owned])',
        'img.cover-art-image:not([data-wl-owned])',
      ]);
      const host =
        note?.closest<HTMLElement>(".cover-art") ??
        nativeCover?.closest<HTMLElement>(".cover-art") ??
        qWithin<HTMLElement>(barWidget, [
          '[data-testid="cover-art-button"]',
          '[data-testid="cover-art-container"]',
          '[data-testid="CoverSlotCollapsed__container"]',
        ]) ??
        note?.parentElement ??
        qWithin<HTMLElement>(barWidget, [
          ".main-nowPlayingWidget-coverArt",
          ".main-coverSlotCollapsed-container",
        ]) ??
        null;
      useSurface(host, note);
    }

    for (const panelRoot of this.panelRoots()) {
      if (panelRoot.closest(CINEMA_ROOT_SELECTOR)) continue;
      const note =
        panelRoot.querySelector<HTMLElement>(".cover-art-icon");
      const nativeCover = qWithin<HTMLImageElement>(panelRoot, [
        '[data-testid="cover-art-slot"] img:not([data-wl-owned])',
        'img.cover-art-image:not([data-wl-owned])',
      ]);
      // Keep this list aligned with collectCoverTargets(). A root-wide image
      // search can select Credits/About artwork instead of the semantic NPV
      // cover and would suppress recovery for the visible note placeholder.
      const host =
        note?.closest<HTMLElement>(".cover-art") ??
        nativeCover?.closest<HTMLElement>(".cover-art") ??
        note?.parentElement ??
        qWithin<HTMLElement>(panelRoot, [
          '[data-testid="cover-art-slot"]',
          '[data-testid="track-visual-enhancement"]',
          ".main-nowPlayingView-coverArtVisualEnhancement",
          ".main-nowPlayingView-coverArt",
          ".main-nowPlayingView-coverArtContainer",
        ]) ??
        null;
      useSurface(host, note);
    }
    return Array.from(surfaces.values());
  }

  private ensureSpotifyCoverRecoveryOverlay(
    host: HTMLElement,
    candidate: SpotifyCoverRecoveryCandidate,
  ): void {
    const existing = this._spotifyCoverRecoveryBindings.get(host);
    if (existing?.image.isConnected && host.contains(existing.image)) return;
    if (existing) this.removeSpotifyCoverRecoveryOverlay(host);

    const image = document.createElement("img");
    // Spotify's missing-cover component keeps the square `.cover-art` slot
    // mounted even after its native image enters React's same-URI error state.
    // Reuse the native image classes inside that exact slot so dimensions,
    // crop, radius and transitions match a normal Spotify track change.
    image.className =
      "main-image-image cover-art-image wl-spotify-cover-recovery";
    image.setAttribute("data-wl-owned", "spotify-cover-recovery");
    image.setAttribute("data-image-status", "loading");
    image.alt = candidate.alt;
    image.decoding = "async";
    image.loading = "eager";
    image.draggable = false;
    image.addEventListener(
      "load",
      () => {
        image.setAttribute("data-image-status", "loaded");
        image.classList.add("main-image-loaded");
      },
      { once: true },
    );
    image.addEventListener(
      "error",
      () => {
        if (this._spotifyCoverRecoveryBindings.get(host)?.image === image) {
          this.cancelSpotifyCoverRecovery();
        }
      },
      { once: true },
    );
    host.classList.add("wl-spotify-cover-recovery-host");
    host.appendChild(image);
    this._spotifyCoverRecoveryBindings.set(host, { host, image });
    image.src = candidate.src;
  }

  private reconcileSpotifyCoverRecovery(
    expectedUri: string,
  ): void {
    const candidate = this._spotifyCoverRecoveryCandidate;
    if (!candidate || candidate.uri !== expectedUri) return;

    const currentUri = this.spotifyItemUri();
    if (this._track || currentUri !== expectedUri) {
      this.cancelSpotifyCoverRecovery();
      return;
    }

    const activeHosts = new Set<HTMLElement>();
    for (const { host, note } of this.spotifyCoverRecoverySurfaces()) {
      activeHosts.add(host);
      const visibleNote = this.spotifyNotePlaceholderVisible(note);
      // Spotify keeps `.cover-art-icon` mounted underneath a valid image, so
      // its visibility cannot be used to decide whether the native cover won.
      // A validated, non-WaveLink Spotify image in this exact square is the
      // authoritative signal that normal React rendering has recovered.
      const hasNativeCover = this.compactSpotifyCoverPresent(host);
      if (
        !shouldRecoverSpotifyCover(
          expectedUri,
          currentUri,
          this._track !== null,
          hasNativeCover,
        )
      ) {
        this.removeSpotifyCoverRecoveryOverlay(host);
        continue;
      }
      // If React momentarily removes both the placeholder and its replacement,
      // retain an existing overlay to avoid a flash. A real validated Spotify
      // image above is the authoritative signal that the repair can go away.
      if (visibleNote) {
        this.ensureSpotifyCoverRecoveryOverlay(host, candidate);
      }
    }
    for (const host of Array.from(this._spotifyCoverRecoveryBindings.keys())) {
      if (!activeHosts.has(host) || !host.isConnected) {
        this.removeSpotifyCoverRecoveryOverlay(host);
      }
    }
  }

  private scheduleSpotifyCoverRecovery(expectedUri: string): void {
    if (this._spotifyCoverRecoveryCandidate?.uri !== expectedUri) return;
    for (const delay of [0, 50, 150, 350, 800, 1_600]) {
      const timer = window.setTimeout(() => {
        this._spotifyCoverRecoveryTimers.delete(timer);
        this.reconcileSpotifyCoverRecovery(expectedUri);
      }, delay);
      this._spotifyCoverRecoveryTimers.add(timer);
    }
  }

  /**
   * Spotify does not emit songchange when the user explicitly replays the
   * same native track that was paused behind WaveLink. Release ownership in
   * document capture phase so Spotify's own click handler can complete on the
   * first click instead of being cancelled by our pause loop.
   */
  private readonly _onNativeSpotifyPlaybackClick = (event: MouseEvent) => {
    if (!this._track || event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;

    const control = target.closest<HTMLElement>(
      'button, [role="button"], [role="menuitem"]',
    );
    const trackRow = target.closest<HTMLElement>(
      '[role="row"], [data-testid="tracklist-row"], .main-trackList-trackListRow',
    );
    const candidate = control ?? target;
    const excluded = Boolean(
      target.closest(
        [
          ".wl-app",
          "[data-wl-owned]",
          "#wavelink-native-controls",
          "#wavelink-native-queue",
          "#wavelink-source-badge",
        ].join(", "),
      ),
    );
    const transportControl = Boolean(
      target.closest(SEL_PLAYPAUSE.join(", ")),
    );
    const interactiveTarget = Boolean(
      target.closest(
        'button, [role="button"], [role="menuitem"], a[href], [role="link"]',
      ),
    );

    if (
      !isNativeSpotifyPlayIntent({
        ariaLabel: candidate.getAttribute("aria-label"),
        title: candidate.getAttribute("title"),
        testId: candidate.getAttribute("data-testid"),
        className: candidate.getAttribute("class"),
        clickCount: event.detail,
        insideTrackRow: Boolean(trackRow),
        interactiveTarget,
        excluded,
        transportControl,
      })
    ) {
      return;
    }

    log(
      "player",
      "Native Spotify Play intent captured — releasing WaveLink before click",
    );
    const releasedSpotifyUri = this.spotifyItemUri();
    const releasedSpotifyCover = releasedSpotifyUri && releasedSpotifyUri === this._spotifyBaselineUri
      ? this.captureSpotifyCoverRecovery(releasedSpotifyUri)
      : null;
    this.stop();
    // Capture runs before Spotify's own target click handler. Rewind the
    // released native item while it is still paused so that the explicit Play
    // intent starts at 0:00 instead of resuming the position saved behind
    // WaveLink. Normal Spotify transport resume never enters this handler.
    // stop() emits synchronously, so do not touch Spotify when a listener has
    // already started a newer WaveLink load or replaced the native item.
    if (
      this._track ||
      !releasedSpotifyUri ||
      this.spotifyItemUri() !== releasedSpotifyUri
    ) {
      return;
    }
    try {
      Spicetify.Player.seek(0);
    } catch (cause) {
      warn("player", "Could not rewind Spotify after WaveLink handoff:", cause);
    }
    this._spotifyCoverRecoveryCandidate = releasedSpotifyCover;
    this.scheduleSpotifyCoverRecovery(releasedSpotifyUri);
  };

  private readonly _onFollowingStatusRefresh = () => {
    if (document.visibilityState === "hidden") return;
    const user = this._track?.user;
    if (!user) return;
    const key = user.urn || user.id;
    if (key === this._ownUserUrn) return;
    const state = this.followStateFor(user);
    this.resolveFollowState(user, state, true);
  };

  private readonly _onLikedTrackStatus = ({
    trackId,
    liked,
  }: LikedTrackStatusDetail) => {
    invalidateLikedTrackIds();
    let state = this._likeStates.get(trackId);
    if (!state) {
      state = {
        liked,
        resolved: true,
        busy: false,
        generation: 0,
      };
      this._likeStates.set(trackId, state);
    } else {
      state.generation += 1;
      state.liked = liked;
      state.resolved = true;
    }
    const current = this._track;
    if (current && this.likeKey(current) === trackId) {
      current.user_favorite = liked;
      this.applyTrackInfo();
    }
  };

  private readonly _onLikeStatusRefresh = () => {
    if (document.visibilityState === "hidden") return;
    this.refreshPendingLikesAfterReturn();
  };

  private readonly _onResumePageHide = () => {
    this._resumeUnloading = true;
    this.persistPlaybackResume(true);
  };

  private readonly _onResumeBeforeUnload = () => {
    this._resumeUnloading = true;
    this.persistPlaybackResume(true);
  };

  private readonly _onResumePageShow = () => {
    // Covers the rare back-forward-cache path where pagehide did not destroy
    // this renderer after all.
    this._resumeUnloading = false;
  };

  private readonly _onResumeVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      this.persistPlaybackResume(true);
    }
  };

  private readonly _onSettingsChanged = () => {
    for (const state of this._likeStates.values()) state.generation += 1;
    this._likeStates.clear();
    this._pendingExternalLikeIds.clear();
    this._likeRefreshInFlight = false;
    this._artistProfileCache.clear();
    this._activeArtistProfile = null;
    invalidateLikedTrackIds();
    if (this._track) {
      this.prepareArtistProfile(this._track, this._loadId);
      this.applyTrackInfo();
    }
  };

  private sourceBadgeConfiguredHomeBounds(): SourceBadgeHoverZone | null {
    const badge = this._sourceBadge;
    if (
      !badge ||
      badge.hidden ||
      !this._sourceBadgePreferences.dodgeOnHover ||
      badge.classList.contains("is-fullscreen-hidden")
    ) {
      return null;
    }
    return sourceBadgeHomeBounds(
      badge.getBoundingClientRect(),
      this._sourceBadgePreferences.side,
      window.innerWidth,
    );
  }

  private readonly _onSourceBadgeDocumentPointerMove = (
    event: PointerEvent,
  ) => {
    if (event.pointerType === "touch") return;

    if (this._sourceBadgeHoverReturnZone) {
      if (
        isPointInsideSourceBadgeHoverZone(
          this._sourceBadgeHoverReturnZone,
          event.clientX,
          event.clientY,
        )
      ) {
        return;
      }
      this.resetSourceBadgeHoverDodge();
      return;
    }

    const homeBounds = this.sourceBadgeConfiguredHomeBounds();
    if (
      !homeBounds ||
      !isPointInsideSourceBadgeHoverZone(
        homeBounds,
        event.clientX,
        event.clientY,
      )
    ) {
      return;
    }
    const returnZone = createSourceBadgeHoverZone(homeBounds);
    if (!returnZone) return;
    // Pointer movement is compared against a virtual home rectangle derived
    // from the configured side, never against the horizontally moving badge.
    // Its own return animation therefore cannot retrigger the dodge.
    this._sourceBadgeHoverReturnZone = returnZone;
    this._sourceBadgeRuntimeSide = sourceBadgeSideForHomeArea(
      this._sourceBadgePreferences.side,
      true,
      true,
    );
    this.applySourceBadgePresentation();
  };

  private readonly _onSourceBadgeWindowBlur = () => {
    this.resetSourceBadgeHoverDodge();
  };

  private mutationNodeContainsCinemaRoot(node: Node): boolean {
    if (!(node instanceof Element)) return false;
    return (
      node.matches(CINEMA_ROOT_SELECTOR) ||
      node.querySelector(CINEMA_ROOT_SELECTOR) !== null ||
      node.matches('[role="radiogroup"]')
    );
  }

  private readonly _onSourceBadgeCinemaMutations = (
    records: MutationRecord[],
  ) => {
    let rootsChanged = false;
    let collapseStateChanged = false;
    for (const record of records) {
      if (
        record.type === "attributes" &&
        record.target instanceof HTMLElement &&
        this._sourceBadgeObservedCinemaRoots.has(record.target)
      ) {
        collapseStateChanged = true;
        if (!record.target.matches(CINEMA_ROOT_SELECTOR)) {
          rootsChanged = true;
        }
        continue;
      }
      if (
        record.type === "childList" &&
        [
          ...Array.from(record.addedNodes),
          ...Array.from(record.removedNodes),
        ].some((node) => this.mutationNodeContainsCinemaRoot(node))
      ) {
        rootsChanged = true;
      }
    }
    if (!rootsChanged && !collapseStateChanged) return;
    if (rootsChanged) this.observeSourceBadgeCinemaRoots();
    this.resetSourceBadgeHoverDodge(false);
    this.applySourceBadgePresentation();
  };

  private observeSourceBadgeCinemaRoots(): void {
    const observer = this._sourceBadgeCinemaObserver;
    if (!observer) return;
    observer.disconnect();
    this._sourceBadgeObservedCinemaRoots = new Set(this.cinemaRoots());
    observer.observe(document.body, { childList: true, subtree: true });
    for (const root of this._sourceBadgeObservedCinemaRoots) {
      observer.observe(root, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }
  }

  private startSourceBadgeCinemaObserver(): void {
    if (this._sourceBadgeCinemaObserver) return;
    this._sourceBadgeCinemaObserver = new MutationObserver(
      this._onSourceBadgeCinemaMutations,
    );
    this.observeSourceBadgeCinemaRoots();
  }

  private stopSourceBadgeCinemaObserver(): void {
    this._sourceBadgeCinemaObserver?.disconnect();
    this._sourceBadgeCinemaObserver = null;
    this._sourceBadgeObservedCinemaRoots.clear();
  }

  private resetSourceBadgeHoverDodge(
    applyPresentation = true,
  ): void {
    const changed =
      this._sourceBadgeHoverReturnZone !== null ||
      this._sourceBadgeRuntimeSide !== this._sourceBadgePreferences.side;
    this._sourceBadgeHoverReturnZone = null;
    this._sourceBadgeRuntimeSide = sourceBadgeSideForHomeArea(
      this._sourceBadgePreferences.side,
      this._sourceBadgePreferences.dodgeOnHover,
      false,
    );
    if (changed && applyPresentation) {
      this.applySourceBadgePresentation();
    }
  }

  constructor() {
    this.audio = document.createElement("audio");
    this.audio.id = "wavelink-audio";
    this.audio.preload = "metadata";
    document.body.appendChild(this.audio);
    installSoftwareAacMediaFacade(this.audio, () => this.softwareAac);
    this.linuxMediaSession = createLinuxMediaSessionBridge({
      play: () => this.play(),
      pause: () => this.pause(),
      stop: () => this.stop(),
      next: () => this.next(),
      previous: () => this.prev(),
      seekTo: (seconds) => this.seekToSeconds(seconds),
      timeline: () => this.linuxMediaSessionTimeline(),
    });
    document.addEventListener(
      "click",
      this._onNativeSpotifyPlaybackClick,
      true,
    );
    document.addEventListener(
      "contextmenu",
      this._onStaleSpotifyContextMenu,
      true,
    );
    document.addEventListener(
      "click",
      this._onStaleSpotifyMetadataInteraction,
      true,
    );
    document.addEventListener(
      "auxclick",
      this._onStaleSpotifyMetadataInteraction,
      true,
    );
    document.addEventListener(
      "contextmenu",
      this._onStaleSpotifyMetadataInteraction,
      true,
    );
    document.addEventListener(
      "pointermove",
      this._onSourceBadgeDocumentPointerMove,
      { passive: true },
    );
    document.addEventListener(
      "pointerdown",
      this._onSoftwareAacUnlockIntent,
      true,
    );
    document.addEventListener(
      "keydown",
      this._onSoftwareAacUnlockIntent,
      true,
    );
    this.startSourceBadgeCinemaObserver();
    window.addEventListener("blur", this._onSourceBadgeWindowBlur);
    window.addEventListener("focus", this._onFollowingStatusRefresh);
    document.addEventListener(
      "visibilitychange",
      this._onFollowingStatusRefresh,
    );
    this._unsubscribeLikedTrackStatus = subscribeLikedTrackStatus(
      this._onLikedTrackStatus,
    );
    window.addEventListener("focus", this._onLikeStatusRefresh);
    document.addEventListener("visibilitychange", this._onLikeStatusRefresh);
    window.addEventListener("pagehide", this._onResumePageHide);
    window.addEventListener("pageshow", this._onResumePageShow);
    window.addEventListener("beforeunload", this._onResumeBeforeUnload);
    document.addEventListener(
      "visibilitychange",
      this._onResumeVisibilityChange,
    );
    window.addEventListener("wavelink:settings", this._onSettingsChanged);
    log("player", "initialized, audio element created");
    this.bindAudioEvents();
    this.injectStyles();
    this.ensureGlobalControls();
    this.waitForSpicetify();
  }

  private linuxMediaSessionTimeline(): LinuxMediaSessionTimeline {
    const mediaDuration = Number(this.audio.duration);
    const trackDuration = Number(this._track?.duration) / 1_000;
    const duration = Number.isFinite(mediaDuration) && mediaDuration > 0
      ? mediaDuration
      : Number.isFinite(trackDuration) && trackDuration > 0
        ? trackDuration
        : 0;
    const playbackRate = Number(this.audio.playbackRate);
    return {
      duration,
      position: Number(this.audio.currentTime),
      playbackRate:
        Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
      isPlaying: !this.audio.paused && !this.audio.ended,
    };
  }

  private activateLinuxMediaSession(track: SCTrack): void {
    const preferredArtwork = soundCloudTrackArtworkUrl(
      track.artwork_url,
      "t500x500",
    );
    const artworkUrl = this._failedCoverSources.has(preferredArtwork)
      ? WAVELINK_TRACK_FALLBACK_ARTWORK
      : preferredArtwork;
    const contextLabel = normalizeMetadataText(this.currentEntry()?.context.label);
    const album = contextLabel && contextLabel !== DEFAULT_PLAYBACK_CONTEXT.label
      ? `WaveLink · ${contextLabel}`
      : DEFAULT_PLAYBACK_CONTEXT.label;
    this.linuxMediaSession.activate({
      key: trackKey(track),
      title: track.title,
      artist: track.user.username,
      album,
      artworkUrl,
    });
  }

  private seekToSeconds(seconds: number): void {
    const timeline = this.linuxMediaSessionTimeline();
    if (!(timeline.duration > 0) || !Number.isFinite(seconds)) return;
    const target = Math.max(0, Math.min(timeline.duration, seconds));
    this._resumePendingSeek = null;
    this.audio.currentTime = target;
    this.persistPlaybackResume(true);
    this.linuxMediaSession.syncPosition(true);
  }

  private waitForSpicetify(): void {
    if (
      typeof Spicetify === "undefined" ||
      !Spicetify.Player ||
      !Spicetify.Platform
    ) {
      setTimeout(() => this.waitForSpicetify(), 100);
      return;
    }
    log("player", "Spicetify ready, hooking transport");
    // load saved SC volume settings from LocalStorage
    try {
      this._scVolMultEnabled = Spicetify.LocalStorage.get("wavelink:volume-profile-enabled") !== "false";
      this._shuffle =
        Spicetify.LocalStorage.get(STORAGE_KEYS.shuffle) === "true";
      const savedRepeat = Spicetify.LocalStorage.get(STORAGE_KEYS.repeat);
      this._repeat =
        savedRepeat === "all" || savedRepeat === "one" ? savedRepeat : "off";
      this._autoplayRelated =
        Spicetify.LocalStorage.get(STORAGE_KEYS.autoplayRelated) !== "false";
      this._tracksPerLoad = readTracksPerLoad();
      this._spotifySearchIntegrationEnabled =
        readSpotifySearchIntegrationEnabled();
      this._cinemaAvatarPosition = normalizeArtistAvatarPosition(
        Spicetify.LocalStorage.get(STORAGE_KEYS.cinemaAvatarPosition),
      );
      this._cinemaAvatarVisible = normalizeArtistAvatarVisibility(
        Spicetify.LocalStorage.get(STORAGE_KEYS.cinemaAvatarVisible),
      );
      this._cinemaAvatarBorderVisible =
        normalizeArtistAvatarBorderVisibility(
          Spicetify.LocalStorage.get(
            STORAGE_KEYS.cinemaAvatarBorderVisible,
          ),
        );
      this._cinemaArtworkBackgroundMode =
        normalizeArtworkBackgroundMode(
          Spicetify.LocalStorage.get(
            STORAGE_KEYS.cinemaArtworkBackgroundMode,
          ),
        );
      this._sourceBadgePreferences = normalizeSourceBadgePreferences({
        enabled: Spicetify.LocalStorage.get(STORAGE_KEYS.sourceBadgeEnabled),
        side: Spicetify.LocalStorage.get(STORAGE_KEYS.sourceBadgeSide),
        dodgeOnHover: Spicetify.LocalStorage.get(
          STORAGE_KEYS.sourceBadgeDodgeOnHover,
        ),
        linkEnabled: Spicetify.LocalStorage.get(
          STORAGE_KEYS.sourceBadgeLinkEnabled,
        ),
        displayMode: Spicetify.LocalStorage.get(
          STORAGE_KEYS.sourceBadgeDisplayMode,
        ),
        hideWithFullscreenPlayer: Spicetify.LocalStorage.get(
          STORAGE_KEYS.sourceBadgeHideWithFullscreenPlayer,
        ),
      });
      this._sourceBadgeRuntimeSide = this._sourceBadgePreferences.side;
      const savedVol = Spicetify.LocalStorage.get("wavelink:volume-level");
      if (savedVol !== null) {
        const parsedVolume = Number(savedVol);
        if (Number.isFinite(parsedVolume)) {
          this._scVolumeLevel = safeVolume(parsedVolume);
        } else {
          this._scVolumeLevel = 0.5;
          Spicetify.LocalStorage.set("wavelink:volume-level", "0.5");
        }
      }
      log(
        "player",
        "Loaded player settings: volumeProfile=%s, level=%.2f, native=always, shuffle=%s, repeat=%s, autoplayRelated=%s, tracksPerLoad=%d, spotifySearch=%s",
        this._scVolMultEnabled,
        this._scVolumeLevel,
        this._shuffle,
        this._repeat,
        this._autoplayRelated,
        this._tracksPerLoad,
        this._spotifySearchIntegrationEnabled,
      );
    } catch {}
    this.hookSpotifyPlayer();
    this.hookSkipButtons();
    this.hookProgressBar();
    this._tryEnsureNativeControls = () => this.ensureNativeControls();
    this._tryEnsureNativeControls();
    // Keep the source badge live even when Spotify (not SC) is the active
    // source — Spotify's own play/songchange don't always reach our handlers.
    if (this.badgeTimer === null) {
      this.badgeTimer = setInterval(() => {
        this.refreshSourceBadge();
        this.updateGlobalControls();
        const recovery = this._spotifyCoverRecoveryCandidate;
        if (recovery) {
          this.reconcileSpotifyCoverRecovery(recovery.uri);
        }
      }, 2000);
    }
    this.refreshSourceBadge();
    this.emit();
  }

  // ── Audio events ──────────────────────────────────────────────────────────

  private bindAudioEvents(): void {
    this.audio.addEventListener("play", () => {
      this._notice = null;
      log("player", "audio play — track: %s", this._track?.title ?? "(none)");
      document.body.classList.add("sc-playing");
      this.startTimer();
      this.linuxMediaSession.syncPlayback();
      this.emit();
      this.refreshSourceBadge();
    });
    this.audio.addEventListener("pause", () => {
      log("player", "audio pause");
      document.body.classList.remove("sc-playing");
      // Do NOT stop the timer here — the mute loop must keep running while
      // _track is set so Spotify's audio stays silent even when SC is paused.
      // stopTimer() is called only when _track is cleared (songchange / destroy).
      this.linuxMediaSession.syncPlayback();
      this.emit();
      if (!this._resumeUnloading) this.persistPlaybackResume(true);
      this.refreshSourceBadge();
    });
    this.audio.addEventListener("ended", () => {
      log(
        "player",
        "audio ended, advancing queue (%d/%d)",
        this.queueIndex + 1,
        this.queue.length,
      );
      this.linuxMediaSession.syncPlayback();
      void this.requestAdvance("ended");
      this.refreshSourceBadge();
    });
    this.audio.addEventListener("loadedmetadata", () => {
      this.applyPendingPlaybackResumeSeek();
      this.linuxMediaSession.syncPosition(true);
      log("player", "loadedmetadata — duration: %.1fs", this.audio.duration);
      this.emit();
      if (!this._resumeUnloading) this.persistPlaybackResume(true);
    });
    // HLS can report an unknown/infinite duration at loadedmetadata. Retry the
    // guarded seek when its timeline becomes finite, before queued Play runs.
    this.audio.addEventListener("durationchange", () => {
      this.applyPendingPlaybackResumeSeek();
      this.linuxMediaSession.syncPosition(true);
    });
    this.audio.addEventListener("canplay", () => {
      this.applyPendingPlaybackResumeSeek();
      this.linuxMediaSession.syncPosition(true);
    });
    this.audio.addEventListener("timeupdate", () => {
      this.linuxMediaSession.syncPosition();
    });
    this.audio.addEventListener("seeked", () => {
      this.linuxMediaSession.syncPosition(true);
    });
    this.audio.addEventListener("ratechange", () => {
      this.linuxMediaSession.syncPosition(true);
    });
    this.audio.addEventListener("volumechange", () => {
      this.softwareAac?.syncGain();
      this.emit();
    });
    this.audio.addEventListener("error", () => {
      // Source replacement intentionally aborts the previous media load. Ignore
      // that transitional error; hls.js/startAudio own errors for the source
      // currently being attached.
      if (!this._track || this._isLoading || !this.audio.currentSrc) return;
      const detail = this.audio.error?.message ?? "unknown";
      logError("player", "audio error:", detail);
      this.failPlayback("Stream error — track may be unavailable");
    });
  }

  // ── Spotify muting ────────────────────────────────────────────────────────
  //
  // We mute every <audio> that isn't ours as a safety measure to prevent any
  // Spotify audio from leaking through. Spotify itself stays paused (so its
  // track position doesn't advance), and its button state is handled by CSS.

  private muteSpotifyAudio(muted: boolean): void {
    // Spicetify.Player.pause() is the supported isolation mechanism. Never
    // mutate unrelated <audio> elements: Spotify and other extensions may own
    // them, and changing their mute/volume state is not safely reversible.
    this._spotifyMuted = muted;
    this._muteCheckAt = Date.now();
  }

  // Keep Spotify silent and paused while an SC track is loaded. Pausing stops
  // Spotify's position from advancing (so its progress bar stays put for us to
  // overwrite) and guarantees no audio bleed. We mark the echo to be ignored.
  private forceSpotifyPaused(): void {
    if (!this._track) return;
    try {
      if (typeof Spicetify !== "undefined" && Spicetify.Player?.isPlaying?.()) {
        this._suppressSpotifyEventsUntil = Date.now() + 1_000;
        Spicetify.Player.pause();
      }
    } catch {}
    this.muteSpotifyAudio(true);
  }

  // Toggle ONLY our own audio element. Spotify's transport is never touched.
  private toggleSc(): void {
    if (!this._track || this._error) return;
    if (this._isLoading || this._resumePendingSeek) {
      this._playRequestedWhileLoading = true;
      return;
    }
    if (this.audio.paused) {
      this.muteSpotifyAudio(true);
      void this.play();
    } else {
      this.audio.pause();
    }
  }

  // ── Spotify integration ───────────────────────────────────────────────────

  private spotifyItemUri(): string | null {
    try {
      const uri = Spicetify.Player.data?.item?.uri;
      return typeof uri === "string" && uri ? uri : null;
    } catch {
      return null;
    }
  }

  private spotifyPlaying(): boolean {
    try {
      return !!Spicetify.Player.isPlaying();
    } catch {
      return false;
    }
  }

  /**
   * Atomically release WaveLink when Spotify starts a different native item.
   * If WaveLink's pause loop won the race, replay the same item so the user's
   * first click is never consumed.
   */
  private handoffToSpotify(
    observedUri: string,
    resumeRequested: boolean,
  ): boolean {
    if (!this._track || this.spotifyItemUri() !== observedUri) return false;
    const title = this._track.title;
    const shouldResume = resumeRequested || this.spotifyPlaying();
    log(
      "player",
      "Spotify takeover '%s' — releasing SC track '%s'",
      observedUri,
      title,
    );
    this.stop();
    // stop() emits synchronously. A listener is allowed to start another SC
    // load, and that newer load must never be interrupted by our replay.
    if (
      this._track ||
      !shouldResume ||
      this.spotifyItemUri() !== observedUri
    ) {
      return true;
    }
    try {
      if (!Spicetify.Player.isPlaying()) Spicetify.Player.play();
    } catch (cause) {
      warn("player", "Could not resume Spotify after WaveLink handoff:", cause);
    }
    this.refreshSourceBadge();
    return true;
  }

  private hookSpotifyPlayer(): void {
    try {
      // ── Play / Pause ──────────────────────────────────────────────────────
      //
      // The on-screen play/pause button is intercepted directly in capture
      // phase (see hookTransportButtons) so Spotify never toggles its own
      // transport from a click. This onplaypause handler is only a *fallback*
      // for external toggles we cannot intercept (media keys, headset buttons).
      //
      // For those: Spotify just flipped its own state. We force it back to the
      // paused+muted baseline and mirror the user's intent onto SC audio. The
      // The suppression window swallows echoes from our own pause() calls.
      Spicetify.Player.addEventListener("onplaypause", () => {
        try {
          const currentUri = this.spotifyItemUri();
          const spotifyPlaying = this.spotifyPlaying();
          const handoff = classifySpotifyHandoff(
            this._spotifyBaselineUri,
            currentUri,
            spotifyPlaying,
          );
          // URI ownership is stronger than the pause-echo window. Otherwise a
          // real first click can be mistaken for our own delayed pause event.
          if (handoff === "yield-now" && currentUri) {
            this.handoffToSpotify(currentUri, true);
            return;
          }
          if (
            !spotifyPlaying &&
            Date.now() < this._suppressSpotifyEventsUntil
          ) {
            this._suppressSpotifyEventsUntil = 0;
            log("player", "onplaypause — ignored (WaveLink pause echo)");
            return;
          }
          log(
            "player",
            "onplaypause — SC active=%s, loading=%s",
            !!this._track,
            this._isLoading,
          );
          if (
            this._track &&
            !this._isLoading &&
            !this._error
          ) {
            // A real external media-key toggle makes Spotify transition from
            // our paused baseline to playing. Native pause echoes must never
            // blindly toggle the SoundCloud element back off.
            if (!spotifyPlaying) return;
            this.forceSpotifyPaused();
            this.toggleSc();
          }
        } catch {}
        // Reflect the new state on the badge — covers Spotify-only playback,
        // where there's no SC track and the block above is skipped.
        this.refreshSourceBadge();
      });

      //removed onvolumechange...

      // Direct input listener on the volume slider — fires on every drag step
      // so SC audio tracks the slider in real-time without waiting for the
      // 250ms timer or a Spicetify event.
      const hookVolumeInput = () => {
        const syncFromSpotifyVolume = () => {
          if (!this._track || this._error) return;
          let value = this.readSpotifyVolume();
          if (value === null) {
            try { value = Spicetify.Player.getVolume(); } catch { value = null; }
          }
          if (value === null) return;
          const volume = Math.max(0, Math.min(1, value));
          this.audio.muted = volume <= 0.001;
          if (volume > 0) this.audio.volume = volume;
          this.emit();
        };

        // Mirror the mute button after Spotify has updated its own state.
        const muteBtn = document.querySelector<HTMLButtonElement>('[data-testid="volume-bar-toggle-mute-button"]');
        if (muteBtn && !(muteBtn as HTMLButtonElement & { _waveLinkMute?: boolean })._waveLinkMute) {
          (muteBtn as HTMLButtonElement & { _waveLinkMute?: boolean })._waveLinkMute = true;
          muteBtn.addEventListener("click", () => {
            setTimeout(syncFromSpotifyVolume, 50);
          });
        }
        const volumeInput = q<HTMLInputElement>(SEL_VOLUME);
        if (
          volumeInput &&
          !(volumeInput as HTMLInputElement & { _waveLinkVolume?: boolean })._waveLinkVolume
        ) {
          (volumeInput as HTMLInputElement & { _waveLinkVolume?: boolean })._waveLinkVolume = true;
          volumeInput.addEventListener("input", syncFromSpotifyVolume);
          volumeInput.addEventListener("change", syncFromSpotifyVolume);
        }
      };
      this._tryHookVolumeInput = hookVolumeInput;
      hookVolumeInput();
      [500, 1500, 4000].forEach((ms) => setTimeout(hookVolumeInput, ms));

      //Why: Spotify sometimes emits skipNext or forward events while the SC track is playing. 
      // This triggers doNext, which immediately calls next(), stopping the track prematurely. 
      // Already intersept physical skip buttons via hookSkipButtons, so 
      // these event listeners are redundant and cause race conditions.

      // ── Song change — Spotify navigated away ──────────────────────────────
      Spicetify.Player.addEventListener("songchange", () => {
        try {
          const recovery = this._spotifyCoverRecoveryCandidate;
          if (recovery) this.reconcileSpotifyCoverRecovery(recovery.uri);
          if (!this._track) {
            // React may commit the next native item after our handoff. Sweep
            // any remaining bindings without restoring over its fresh props.
            this.restoreNativeBar();
            return;
          }
          const currentUri = this.spotifyItemUri();
          if (!currentUri) {
            log("player", "songchange ignored: Spotify item is not ready");
            return;
          }
          if (this._spotifyBaselineUri === null) {
            if (this.spotifyPlaying()) {
              this.handoffToSpotify(currentUri, true);
              return;
            }
            this._spotifyBaselineUri = currentUri;
            log("player", "songchange established Spotify baseline");
            return;
          }
          if (currentUri === this._spotifyBaselineUri) {
            log("player", "songchange ignored: Spotify item did not change");
            return;
          }
          const observedUri = currentUri;
          const expectedLoadId = this._loadId;
          const spotifyWasPlaying = this.spotifyPlaying();
          if (
            classifySpotifyHandoff(
              this._spotifyBaselineUri,
              observedUri,
              spotifyWasPlaying,
            ) === "yield-now"
          ) {
            this.handoffToSpotify(observedUri, true);
            return;
          }
          if (this._spotifySongChangeTimer !== null) {
            window.clearTimeout(this._spotifySongChangeTimer);
          }
          // Spotify briefly reports transient item changes while its player
          // bar is being rewritten. A paused URI is therefore validated before
          // release, while a playing URI above yields immediately.
          this._spotifySongChangeTimer = window.setTimeout(() => {
            this._spotifySongChangeTimer = null;
            const resumeRequested =
              spotifyWasPlaying || this.spotifyPlaying();
            if (
              !this._track ||
              !shouldCompleteStableSpotifyHandoff(
                expectedLoadId,
                this._loadId,
                observedUri,
                this.spotifyItemUri(),
                resumeRequested,
              )
            ) {
              return;
            }
            this.handoffToSpotify(observedUri, true);
          }, 350);
        } catch {}
      });
    } catch {
      // Spicetify.Player unavailable (running outside Spicetify).
    }
  }

  // ── Skip-button intercept ─────────────────────────────────────────────────

  private hookSkipButtons(): void {
    const hookBtn = (sels: string[], handler: () => void): boolean => {
      for (const sel of sels) {
        const btn = document.querySelector<HTMLButtonElement>(sel);
        if (!btn || (btn as HTMLButtonElement & { _waveLink?: boolean })._waveLink)
          continue;
        (btn as HTMLButtonElement & { _waveLink?: boolean })._waveLink = true;
        btn.addEventListener(
          "click",
          (e) => {
            if (!this._track || this._error)
              return; // SoundCloud unavailable: let Spotify handle it.

            // Always consume transport input while WaveLink owns playback.
            // Queue-end behavior (repeat/autoplay/stop) is resolved below;
            // allowing the event through would resume Spotify underneath SC.
            e.stopImmediatePropagation();
            e.preventDefault();
            handler();
          },
          true,
        );
        return true;
      }
      return false;
    };
    const tryHook = () => {
      // Intercept the main play/pause button so a click controls SC audio
      // directly and Spotify never toggles its own transport (which would
      // resume Spotify's audio and invert the button's visual state).
      const pp = hookBtn(SEL_PLAYPAUSE, () => this.toggleSc());
      const fwd = hookBtn(SEL_SKIP_FWD, () => void this.next());
      const bck = hookBtn(SEL_SKIP_BCK, () => void this.prev());
      if (pp || fwd || bck)
        log("player", "transport buttons hooked (playpause/next/prev)");
    };
    this._tryHookSkipButtons = tryHook;
    tryHook();
    [500, 1500, 4000, 10000].forEach((ms) => setTimeout(tryHook, ms));
  }

  // WaveLink-owned shuffle/repeat/queue controls live in Spotify's transport
  // row, but never click or mutate Spotify's own controls. Spotify frequently
  // replaces this row, so this method is idempotent and retried by the timer.
  private ensureNativeControls(): void {
    if (this._nativeControls && document.contains(this._nativeControls)) {
      this.updateNativeControls();
      return;
    }
    this._nativeControlsHost?.classList.remove(
      "wavelink-native-controls-host",
    );
    this._nativeControlsHost = null;
    this._nativeControls = null;

    let host = q<HTMLElement>(SEL_TRANSPORT_ROW);
    if (!host) {
      const playPause = q<HTMLButtonElement>(SEL_PLAYPAUSE);
      host = playPause?.parentElement ?? null;
    }
    if (!host) return;

    const controls = document.createElement("div");
    controls.id = "wavelink-native-controls";
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "WaveLink SoundCloud controls");
    controls.innerHTML = `
      <button type="button" class="wl-native-control" data-wl-action="shuffle" aria-label="WaveLink shuffle" aria-pressed="false">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 4h2.15c1.55 0 2.45.62 3.28 2.04l1.93 3.3c.6 1.02 1.13 1.41 2.35 1.41h1.62"/><path d="m11.1 8.5 2.75 2.25L11.1 13"/><path d="M1.5 11.75h2.08c1.3 0 2.02-.48 2.72-1.68L8.67 6c.55-.94 1.16-1.25 2.4-1.25h1.76"/><path d="M11.1 2.5 13.85 4.75 11.1 7"/></svg>
      </button>
      <button type="button" class="wl-native-control wl-native-repeat" data-wl-action="repeat" aria-label="WaveLink repeat: off" aria-pressed="false" data-mode="off">
        ${renderSoundCloudRepeatSvg(false, "wl-native-repeat-icon wl-native-repeat-icon--all")}
        ${renderSoundCloudRepeatSvg(true, "wl-native-repeat-icon wl-native-repeat-icon--one")}
      </button>
      <button type="button" class="wl-native-control wl-native-queue" data-wl-action="queue" aria-label="Open WaveLink SoundCloud queue" aria-haspopup="dialog" aria-expanded="false">
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M1.5 3h8M1.5 7h8M1.5 11h5"/><path class="wl-native-queue-play" d="m10 8.5 4 2.5-4 2.5Z"/></svg>
        <span class="wl-native-queue-count" aria-hidden="true"></span>
      </button>`;

    const bind = (action: string, handler: () => void) => {
      controls
        .querySelector<HTMLButtonElement>(`[data-wl-action="${action}"]`)
        ?.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          handler();
        });
    };
    bind("shuffle", () => this.setShuffle(!this._shuffle));
    bind("repeat", () => {
      const next: RepeatMode =
        this._repeat === "off"
          ? "all"
          : this._repeat === "all"
            ? "one"
            : "off";
      this.setRepeat(next);
    });
    bind("queue", () => this.toggleNativeQueue());
    // Do not let pointer gestures bubble into Spotify's transport container.
    controls.addEventListener("pointerdown", (event) => event.stopPropagation());
    controls.addEventListener("mousedown", (event) => event.stopPropagation());

    host.classList.add("wavelink-native-controls-host");
    host.appendChild(controls);
    this._nativeControlsHost = host;
    this._nativeControls = controls;
    this.ensureNativeQueuePopover();
    this.bindNativeDismissHandlers();
    this.updateNativeControls();
    this.scheduleNativeControlsPosition();
  }

  private scheduleNativeControlsPosition(): void {
    if (this._nativeControlsPositionFrame !== null) return;
    this._nativeControlsPositionFrame = window.requestAnimationFrame(() => {
      this._nativeControlsPositionFrame = null;
      this.positionNativeControls();
    });
  }

  private positionNativeControls(): void {
    const controls = this._nativeControls;
    const host = this._nativeControlsHost;
    if (
      !controls ||
      !host ||
      !document.contains(controls) ||
      !document.contains(host)
    ) {
      return;
    }

    const previous =
      qWithin<HTMLButtonElement>(host, SEL_SKIP_BCK) ??
      q<HTMLButtonElement>(SEL_SKIP_BCK);
    const playPause =
      qWithin<HTMLButtonElement>(host, SEL_PLAYPAUSE) ??
      q<HTMLButtonElement>(SEL_PLAYPAUSE);
    const next =
      qWithin<HTMLButtonElement>(host, SEL_SKIP_FWD) ??
      q<HTMLButtonElement>(SEL_SKIP_FWD);
    const shuffle = controls.querySelector<HTMLButtonElement>(
      '[data-wl-action="shuffle"]',
    );
    const repeat = controls.querySelector<HTMLButtonElement>(
      '[data-wl-action="repeat"]',
    );
    const queue = controls.querySelector<HTMLButtonElement>(
      '[data-wl-action="queue"]',
    );
    if (!previous || !playPause || !next || !shuffle || !repeat || !queue) {
      delete controls.dataset.positioned;
      return;
    }

    const hostRect = host.getBoundingClientRect();
    const previousRect = previous.getBoundingClientRect();
    const playPauseRect = playPause.getBoundingClientRect();
    const nextRect = next.getBoundingClientRect();
    if (
      hostRect.width <= 0 ||
      previousRect.width <= 0 ||
      playPauseRect.width <= 0 ||
      nextRect.width <= 0
    ) {
      delete controls.dataset.positioned;
      return;
    }

    const controlSize = shuffle.getBoundingClientRect().width || 32;
    const centers = nativeTransportControlCenters(
      hostRect.left,
      previousRect,
      playPauseRect,
      nextRect,
      controlSize,
    );
    shuffle.style.left = `${centers.shuffle}px`;
    repeat.style.left = `${centers.repeat}px`;
    queue.style.left = `${centers.queue}px`;
    controls.dataset.positioned = "true";
  }

  private ensureNativeQueuePopover(): HTMLElement {
    if (
      this._nativeQueuePopover &&
      document.contains(this._nativeQueuePopover)
    ) {
      return this._nativeQueuePopover;
    }

    const popover = document.createElement("section");
    popover.id = "wavelink-native-queue";
    popover.hidden = true;
    popover.setAttribute("role", "dialog");
    popover.setAttribute("aria-label", "SoundCloud queue");
    popover.innerHTML = `
      <header class="wl-native-queue-header">
        <div>
          <strong>SoundCloud queue</strong>
          <span class="wl-native-queue-summary" aria-live="polite"></span>
        </div>
        <div class="wl-native-queue-header-actions">
          <button type="button" data-wl-queue-action="clear">Clear upcoming</button>
          <button type="button" class="wl-native-queue-close" data-wl-queue-action="close" aria-label="Close SoundCloud queue">&times;</button>
        </div>
      </header>
      <div class="wl-native-queue-list" role="list"></div>`;
    popover.addEventListener("pointerdown", (event) => event.stopPropagation());
    popover.addEventListener("mousedown", (event) => event.stopPropagation());
    popover.addEventListener("click", (event) => event.stopPropagation());
    popover
      .querySelector<HTMLButtonElement>('[data-wl-queue-action="close"]')
      ?.addEventListener("click", () => this.closeNativeQueue(true));
    popover
      .querySelector<HTMLButtonElement>('[data-wl-queue-action="clear"]')
      ?.addEventListener("click", () => this.clearQueue(true));
    popover
      .querySelector<HTMLElement>(".wl-native-queue-list")
      ?.addEventListener("scroll", this._onNativeQueueScroll, {
        passive: true,
      });

    document.body.appendChild(popover);
    this._nativeQueuePopover = popover;
    this._nativeQueueSignature = "";
    return popover;
  }

  private bindNativeDismissHandlers(): void {
    if (this._nativeDismissBound) return;
    this._nativeDismissBound = true;
    document.addEventListener(
      "pointerdown",
      this._onNativeDocumentPointerDown,
      true,
    );
    document.addEventListener("keydown", this._onNativeDocumentKeyDown, true);
    window.addEventListener("resize", this._onNativeWindowResize);
  }

  private toggleNativeQueue(): void {
    if (!this._track) return;
    if (this._nativeQueueOpen) {
      this.closeNativeQueue();
      return;
    }

    const popover = this.ensureNativeQueuePopover();
    this._nativeQueueOpen = true;
    popover.hidden = false;
    this.renderNativeQueue(true);
    this.updateNativeControls();
    this.positionNativeQueue();
    requestAnimationFrame(() => this.positionNativeQueue());
  }

  private closeNativeQueue(focusTrigger = false): void {
    this._nativeQueueOpen = false;
    if (this._nativeQueuePopover) this._nativeQueuePopover.hidden = true;
    const trigger = this._nativeControls?.querySelector<HTMLButtonElement>(
      '[data-wl-action="queue"]',
    );
    trigger?.setAttribute("aria-expanded", "false");
    trigger?.classList.remove("is-open");
    if (focusTrigger && trigger?.isConnected) trigger.focus();
  }

  private positionNativeQueue(): void {
    if (!this._nativeQueueOpen || !this._nativeQueuePopover) return;
    const trigger = this._nativeControls?.querySelector<HTMLButtonElement>(
      '[data-wl-action="queue"]',
    );
    if (!trigger || !trigger.isConnected) return;

    const rect = trigger.getBoundingClientRect();
    const width = Math.max(260, Math.min(380, window.innerWidth - 24));
    const left = Math.max(
      12,
      Math.min(rect.right - width, window.innerWidth - width - 12),
    );
    const bottom = Math.max(88, window.innerHeight - rect.top + 10);
    this._nativeQueuePopover.style.width = `${width}px`;
    this._nativeQueuePopover.style.left = `${left}px`;
    this._nativeQueuePopover.style.bottom = `${bottom}px`;
  }

  private updateNativeControls(): void {
    if (!this._nativeControls || !document.contains(this._nativeControls)) {
      this.ensureNativeControls();
      return;
    }

    const active = Boolean(this._track);
    const wasActive = this._nativeControls.getAttribute("aria-hidden") === "false";
    this._nativeControls.setAttribute("aria-hidden", String(!active));
    if (active !== wasActive) delete this._nativeControls.dataset.positioned;
    if (active) this.scheduleNativeControlsPosition();
    const shuffle = this._nativeControls.querySelector<HTMLButtonElement>(
      '[data-wl-action="shuffle"]',
    );
    shuffle?.classList.toggle("is-active", this._shuffle);
    shuffle?.setAttribute("aria-pressed", String(this._shuffle));
    shuffle?.setAttribute(
      "title",
      this._shuffle
        ? "Disable SoundCloud shuffle"
        : "Enable SoundCloud shuffle",
    );

    const repeat = this._nativeControls.querySelector<HTMLButtonElement>(
      '[data-wl-action="repeat"]',
    );
    const repeatLabel =
      this._repeat === "one"
        ? "Repeat current SoundCloud track"
        : this._repeat === "all"
          ? "Repeat SoundCloud queue"
          : "SoundCloud repeat off";
    repeat?.classList.toggle("is-active", this._repeat !== "off");
    repeat?.setAttribute("data-mode", this._repeat);
    repeat?.setAttribute("aria-pressed", String(this._repeat !== "off"));
    repeat?.setAttribute("aria-label", `WaveLink repeat: ${this._repeat}`);
    repeat?.setAttribute("title", repeatLabel);

    const queue = this._nativeControls.querySelector<HTMLButtonElement>(
      '[data-wl-action="queue"]',
    );
    queue?.classList.toggle("is-open", this._nativeQueueOpen);
    queue?.setAttribute("aria-expanded", String(this._nativeQueueOpen));
    const queueTotal = this.queueDisplayTotal();
    queue?.setAttribute(
      "title",
      `${queueTotal} track${
        queueTotal === 1 ? "" : "s"
      } in SoundCloud queue`,
    );
    const count = queue?.querySelector<HTMLElement>(".wl-native-queue-count");
    if (count) {
      count.textContent = queueTotal > 0 ? String(queueTotal) : "";
    }

    if (!active && this._nativeQueueOpen) this.closeNativeQueue();
    if (this._nativeQueueOpen) {
      this.renderNativeQueue();
      this.positionNativeQueue();
    }
  }

  private renderNativeQueue(force = false): void {
    const popover = this.ensureNativeQueuePopover();
    const sourceRevision = this._queueSourceSnapshot?.revision ?? -1;
    const signature = `${this._queueRevision}:${this.queueIndex}:${sourceRevision}`;
    if (!force && signature === this._nativeQueueSignature) return;
    this._nativeQueueSignature = signature;

    const list = popover.querySelector<HTMLElement>(".wl-native-queue-list");
    const summary = popover.querySelector<HTMLElement>(
      ".wl-native-queue-summary",
    );
    const clear = popover.querySelector<HTMLButtonElement>(
      '[data-wl-queue-action="clear"]',
    );
    const queueTotal = this.queueDisplayTotal();
    const upcoming = Math.max(0, queueTotal - this.queueIndex - 1);
    if (summary) {
      summary.textContent = `${queueTotal} track${
        queueTotal === 1 ? "" : "s"
      } · ${upcoming} up next`;
    }
    if (clear) clear.disabled = upcoming === 0;
    if (!list) return;
    const previousScrollTop = list.scrollTop;
    list.replaceChildren();

    if (this.queue.length === 0) {
      const empty = document.createElement("p");
      empty.className = "wl-native-queue-empty";
      empty.textContent = "Your SoundCloud queue is empty.";
      list.appendChild(empty);
      return;
    }

    this.queue.forEach((entry, index) => {
      const track = entry.track;
      const unavailable = isTrackUnavailable(track);
      const item = document.createElement("div");
      item.className = "wl-native-queue-item";
      item.dataset.wlQueueIndex = String(index);
      item.setAttribute("role", "listitem");
      item.classList.toggle("is-current", index === this.queueIndex);
      item.classList.toggle("is-unavailable", unavailable);

      const play = document.createElement("button");
      play.type = "button";
      play.className = "wl-native-queue-track";
      play.disabled = unavailable;
      play.setAttribute(
        "aria-label",
        unavailable
          ? `${track.title} by ${track.user.username}. ${trackUnavailableLabel(track)}`
          : `Play ${track.title} by ${track.user.username}`,
      );
      if (index === this.queueIndex) play.setAttribute("aria-current", "true");

      const artUrl = track.artwork_url?.replace("-large", "-t200x200") ?? "";
      if (artUrl) {
        const art = document.createElement("img");
        art.className = "wl-native-queue-art";
        art.alt = "";
        art.loading = "lazy";
        art.src = artUrl;
        play.appendChild(art);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className =
          "wl-native-queue-art wl-native-queue-art--empty";
        placeholder.setAttribute("aria-hidden", "true");
        play.appendChild(placeholder);
      }

      const meta = document.createElement("span");
      meta.className = "wl-native-queue-meta";
      const title = document.createElement("span");
      title.className = "wl-native-queue-title";
      title.textContent = track.title;
      const artist = document.createElement("span");
      artist.className = "wl-native-queue-artist";
      artist.textContent = unavailable
        ? trackUnavailableLabel(track)
        : track.user.username;
      meta.append(title, artist);
      play.appendChild(meta);

      const status = document.createElement("span");
      status.className = "wl-native-queue-status";
      status.textContent =
        unavailable
          ? "Unavailable"
          : index === this.queueIndex
          ? "Now playing"
          : index === this.queueIndex + 1
            ? "Next"
            : String(index + 1);
      play.appendChild(status);
      if (!unavailable) {
        play.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          void this.playQueueIndex(index);
        });
      }

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "wl-native-queue-remove";
      remove.textContent = "×";
      remove.hidden = index <= this.queueIndex;
      remove.setAttribute("aria-label", `Remove ${track.title} from queue`);
      remove.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.removeFromQueue(index);
      });

      item.append(play, remove);
      list.appendChild(item);
    });

    const sourceSnapshot = this._queueSourceSnapshot;
    if (sourceSnapshot?.loading) {
      const loading = document.createElement("p");
      loading.className = "wl-native-queue-page-status";
      loading.setAttribute("role", "status");
      loading.textContent = "Loading more SoundCloud tracksвЂ¦";
      list.appendChild(loading);
    } else if (sourceSnapshot?.error && sourceSnapshot.nextHref) {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className =
        "wl-native-queue-page-status wl-native-queue-page-retry";
      retry.textContent = `${sourceSnapshot.error} Retry`;
      retry.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.requestQueueSourcePage();
      });
      list.appendChild(retry);
    } else if (sourceSnapshot?.nextHref) {
      const more = document.createElement("p");
      more.className = "wl-native-queue-page-status";
      more.textContent = "More tracks load automatically.";
      list.appendChild(more);
    }

    // Appending a page must not throw the queue viewer back to the top.
    list.scrollTop = previousScrollTop;
  }

  // ── Progress bar seek intercept ───────────────────────────────────────────
  //
  // syncSpotifyProgress() writes the range input's value every 250 ms via the
  // native setter.  Without a guard, a user drag would snap back immediately.
  // We hook mousedown/touchstart to set _isSeeking=true (pausing our writes),
  // and mouseup/touchend to apply the seek and release the guard.

  private hookProgressBar(): void {
    // Bind the seek-release listener ONCE on document. Previously the release
    // was handled by a `click` on the bar, but Spotify often swallows it (or the
    // pointer leaves the bar mid-drag), leaving _isSeeking stuck true forever —
    // which permanently skips our fill writes so the bar freezes on Spotify's
    // position. A document-level pointer-up always fires, so the guard clears.
    if (!this._seekDocBound) {
      this._seekDocBound = true;
      const finishSeek = (clientX: number) => {
        if (!this._isSeeking) return;
        this._isSeeking = false;
        const wrap = this._progressWrap;
        if (!this._track || !wrap) return;
        const rect = wrap.getBoundingClientRect();
        if (rect.width <= 0) return;
        const r = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        this.seek(r);
        this.syncSpotifyProgress();
      };
      document.addEventListener("mouseup", (e) => finishSeek(e.clientX), true);
      document.addEventListener(
        "touchend",
        (e) => {
          const t = e.changedTouches[0];
          if (t) finishSeek(t.clientX);
          else this._isSeeking = false;
        },
        true,
      );
    }

    // (Re)build our overlay bar inside Spotify's wrapper. Re-runs on the 250 ms
    // timer so it re-attaches whenever Spotify re-renders and drops it.
    const tryHook = () => this.ensureProgressOverlay();

    this._tryHookProgressBar = tryHook;
    tryHook();
    [500, 1500, 4000].forEach((ms) => setTimeout(tryHook, ms));
  }

  // Build (once) the SC-driven progress bar that overlays Spotify's hidden one.
  // Handles its own hover tooltip + seek so every value reflects the SC track,
  // not Spotify's paused track. Re-created automatically if Spotify wipes it.
  private ensureProgressOverlay(): void {
    let wrap = this._progressWrap;
    if (!wrap || !document.contains(wrap)) {
      wrap = q<HTMLElement>(SEL_PROGRESS_WRAP);
      if (!wrap) return;
      this._progressWrap = wrap;
    }

    let ov = this._progressOverlay;
    if (ov && !document.contains(ov)) {
      ov = null;
      this._progressFill = null;
      this._progressThumb = null;
    }
    if (ov && ov.parentElement !== wrap) {
      ov.remove();
      ov = null;
      this._progressFill = null;
      this._progressThumb = null;
    }
    if (ov) return; // already in place

    log(
      "player",
      "progress overlay %s",
      this._progressOverlay ? "recreated (Spotify re-rendered)" : "created",
    );
    ov = document.createElement("div");
    ov.id = "sc-progress";
    ov.innerHTML =
      `<div class="sc-progress__track">` +
      `<div class="sc-progress__fill"></div>` +
      `<div class="sc-progress__thumb"></div>` +
      `</div>` +
      `<div class="sc-progress__tip"></div>`;
    const fill = ov.querySelector(".sc-progress__fill") as HTMLElement;
    const thumb = ov.querySelector(".sc-progress__thumb") as HTMLElement;
    const track = ov.querySelector(".sc-progress__track") as HTMLElement;
    const tip = ov.querySelector(".sc-progress__tip") as HTMLElement;

    const ratioFromX = (clientX: number): number => {
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return 0;
      return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    };
    const scDuration = (): number => {
      const d = this.audio.duration;
      if (isFinite(d) && d > 0) return d;
      return this._track ? this._track.duration / 1000 : 0;
    };

    const overlay = ov;
    overlay.addEventListener("mousemove", (e) => {
      if (!this._track) return;
      e.stopPropagation(); // suppress Spotify's own (wrong) hover tooltip
      const ratio = ratioFromX(e.clientX);
      tip.textContent = fmtTime(ratio * scDuration());
      tip.style.left = `${ratio * 100}%`;
      overlay.classList.add("sc-progress--hover");
      if (this._isSeeking) this.updateProgressOverlay(ratio);
    });
    overlay.addEventListener("mouseleave", () => {
      overlay.classList.remove("sc-progress--hover");
    });
    overlay.addEventListener("mousedown", (e) => {
      if (!this._track) return;
      e.stopPropagation();
      this._isSeeking = true; // document mouseup (above) applies the seek
      this.updateProgressOverlay(ratioFromX(e.clientX));
    });

    wrap.appendChild(overlay);
    this._progressOverlay = overlay;
    this._progressFill = fill;
    this._progressThumb = thumb;
  }

  // Paint the overlay fill + thumb to a 0..1 fraction of the SC track.
  private updateProgressOverlay(fraction: number): void {
    if (!this._progressOverlay) return;
    const pct = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    if (this._progressFill) this._progressFill.style.width = pct;
    if (this._progressThumb) this._progressThumb.style.left = pct;
  }

  // ── CSS injection ────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById("wavelink-player-styles")) return;
    const s = document.createElement("style");
    s.id = "wavelink-player-styles";
    s.textContent = `
      /*
       * Spotify-owned controls that cannot operate on SoundCloud are hidden.
       * Shuffle/repeat/queue are replaced by WaveLink-owned controls below.
       * Lyrics / connect / mini-player / fullscreen remain Spotify-only features.
       * Like button: would add the paused Spotify track to Spotify favourites.
       */
      body.sc-active [data-testid="control-button-shuffle"],
      body.sc-active button[aria-label*="Shuffle" i]:not(.wl-native-control),
      body.sc-active [data-testid="control-button-repeat"],
      body.sc-active [data-testid="lyrics-button"],
      body.sc-active [data-testid="control-button-queue"],
      body.sc-active [data-testid="devices-button"],
      body.sc-active [aria-describedby="connect-message-nudge"],
      body.sc-active button[aria-label*="Gerät verbinden" i],
      body.sc-active button[aria-label*="Connect to a device" i],
      body.sc-active button[aria-label*="Dispositivo" i],
      body.sc-active button[aria-label*="Appareil" i],
      body.sc-active [data-testid="pip-toggle-button"],
      body.sc-active .main-nowPlayingWidget-actionButtonWrapper,
      body.sc-active .main-trackList-enhanced { display: none !important; }

      /*
       * WaveLink controls overlay Spotify's center transport row. Keeping the
       * overlay out of flex sizing preserves Spotify's exact Previous/Play/Next
       * positions at every window width.
       */
      body.sc-active .wavelink-native-controls-host {
        position: relative;
        overflow: visible;
      }
      #wavelink-native-controls {
        display: none;
        position: absolute;
        inset: 0;
        height: 100%;
        overflow: visible;
        pointer-events: none;
      }
      body.sc-active #wavelink-native-controls[data-positioned="true"] {
        display: block;
      }
      #wavelink-native-controls .wl-native-control {
        position: absolute;
        top: 50%;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        min-width: 32px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--text-subdued, #b3b3b3);
        cursor: pointer;
        line-height: 1;
        pointer-events: auto;
        transform: translate(-50%, -50%);
      }
      #wavelink-native-controls .wl-native-control:hover,
      #wavelink-native-controls .wl-native-control:focus-visible {
        color: var(--text-base, #fff);
        outline: none;
      }
      #wavelink-native-controls .wl-native-control:focus-visible {
        box-shadow: 0 0 0 2px #fff;
      }
      #wavelink-native-controls .wl-native-control.is-active,
      #wavelink-native-controls .wl-native-control.is-open {
        color: #ff5500;
      }
      #wavelink-native-controls .wl-native-control.is-active::after,
      #wavelink-native-controls .wl-native-control.is-open::after {
        content: '';
        position: absolute;
        left: 50%;
        bottom: 1px;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentColor;
        transform: translateX(-50%);
      }
      #wavelink-native-controls svg {
        width: 16px;
        height: 16px;
        fill: none;
        stroke: currentColor;
        stroke-width: 1.35;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }
      #wavelink-native-controls .wl-native-queue-play {
        fill: currentColor;
        stroke: none;
      }
      #wavelink-native-controls .wl-native-repeat-icon {
        fill: currentColor;
        stroke: none;
      }
      #wavelink-native-controls .wl-native-repeat-icon--one {
        display: none;
      }
      #wavelink-native-controls .wl-native-repeat[data-mode="one"] .wl-native-repeat-icon--all {
        display: none;
      }
      #wavelink-native-controls .wl-native-repeat[data-mode="one"] .wl-native-repeat-icon--one {
        display: block;
      }
      #wavelink-native-controls .wl-native-queue-count {
        position: absolute;
        top: -1px;
        right: -2px;
        min-width: 13px;
        height: 13px;
        padding: 0 3px;
        border: 2px solid var(--background-base, #121212);
        border-radius: 8px;
        background: #ff5500;
        color: #fff;
        font-size: 8px;
        font-weight: 800;
        line-height: 11px;
        text-align: center;
        pointer-events: none;
      }
      #wavelink-native-controls .wl-native-queue-count:empty { display: none; }

      /* Body-level popover avoids clipping by Spotify's player-bar containers. */
      #wavelink-native-queue {
        position: fixed;
        z-index: 10020;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        max-height: min(62vh, 540px);
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.12);
        border-radius: 12px;
        background: rgba(24,24,24,.985);
        box-shadow: 0 18px 48px rgba(0,0,0,.62);
        color: var(--text-base, #fff);
        font-family: var(--font-family, system-ui, sans-serif);
        backdrop-filter: blur(18px);
      }
      #wavelink-native-queue[hidden],
      body:not(.sc-active) #wavelink-native-queue { display: none !important; }
      #wavelink-native-queue .wl-native-queue-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 14px 14px 11px;
        border-bottom: 1px solid rgba(255,255,255,.09);
      }
      #wavelink-native-queue .wl-native-queue-header > div:first-child {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      #wavelink-native-queue .wl-native-queue-header strong {
        font-size: 15px;
        line-height: 1.25;
      }
      #wavelink-native-queue .wl-native-queue-summary {
        color: var(--text-subdued, #b3b3b3);
        font-size: 11px;
      }
      #wavelink-native-queue .wl-native-queue-header-actions {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      #wavelink-native-queue button {
        box-sizing: border-box;
        border: 0;
        font: inherit;
        cursor: pointer;
      }
      #wavelink-native-queue [data-wl-queue-action="clear"] {
        padding: 6px 8px;
        border-radius: 999px;
        background: transparent;
        color: var(--text-subdued, #b3b3b3);
        font-size: 11px;
        font-weight: 700;
      }
      #wavelink-native-queue [data-wl-queue-action="clear"]:hover:not(:disabled) {
        background: rgba(255,255,255,.1);
        color: #fff;
      }
      #wavelink-native-queue [data-wl-queue-action="clear"]:disabled {
        opacity: .38;
        cursor: default;
      }
      #wavelink-native-queue .wl-native-queue-close {
        width: 28px;
        height: 28px;
        border-radius: 50%;
        background: transparent;
        color: var(--text-subdued, #b3b3b3);
        font-size: 20px;
        line-height: 1;
      }
      #wavelink-native-queue .wl-native-queue-close:hover {
        background: rgba(255,255,255,.1);
        color: #fff;
      }
      #wavelink-native-queue .wl-native-queue-list {
        min-height: 0;
        overflow: auto;
        padding: 6px;
        scrollbar-width: thin;
      }
      #wavelink-native-queue .wl-native-queue-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) 30px;
        align-items: center;
        gap: 2px;
        border-radius: 8px;
      }
      #wavelink-native-queue .wl-native-queue-item:hover,
      #wavelink-native-queue .wl-native-queue-item.is-current {
        background: rgba(255,255,255,.075);
      }
      #wavelink-native-queue .wl-native-queue-item.is-current {
        box-shadow: inset 3px 0 #ff5500;
      }
      #wavelink-native-queue .wl-native-queue-item.is-unavailable {
        background: transparent;
      }
      #wavelink-native-queue .wl-native-queue-item.is-unavailable .wl-native-queue-track {
        cursor: not-allowed;
        opacity: .48;
      }
      #wavelink-native-queue .wl-native-queue-item.is-unavailable .wl-native-queue-art {
        filter: grayscale(.65) brightness(.58);
      }
      #wavelink-native-queue .wl-native-queue-item.is-unavailable .wl-native-queue-artist,
      #wavelink-native-queue .wl-native-queue-item.is-unavailable .wl-native-queue-status {
        color: #ffad80;
      }
      #wavelink-native-queue .wl-native-queue-track {
        min-width: 0;
        display: grid;
        grid-template-columns: 40px minmax(0, 1fr) auto;
        align-items: center;
        gap: 10px;
        padding: 7px 6px;
        border-radius: 8px;
        background: transparent;
        color: inherit;
        text-align: left;
      }
      #wavelink-native-queue .wl-native-queue-track:focus-visible,
      #wavelink-native-queue .wl-native-queue-remove:focus-visible,
      #wavelink-native-queue .wl-native-queue-close:focus-visible,
      #wavelink-native-queue [data-wl-queue-action="clear"]:focus-visible {
        outline: 2px solid #fff;
        outline-offset: -2px;
      }
      #wavelink-native-queue .wl-native-queue-art {
        display: block;
        width: 40px;
        height: 40px;
        border-radius: 5px;
        object-fit: cover;
        background: linear-gradient(135deg, #ff8a00, #ff3d00);
      }
      #wavelink-native-queue .wl-native-queue-art--empty::after {
        content: 'SC';
        display: grid;
        height: 100%;
        place-items: center;
        color: rgba(255,255,255,.9);
        font-size: 10px;
        font-weight: 800;
      }
      #wavelink-native-queue .wl-native-queue-meta {
        min-width: 0;
        display: grid;
        gap: 2px;
      }
      #wavelink-native-queue .wl-native-queue-title,
      #wavelink-native-queue .wl-native-queue-artist {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      #wavelink-native-queue .wl-native-queue-title {
        font-size: 12px;
        font-weight: 650;
      }
      #wavelink-native-queue .is-current .wl-native-queue-title { color: #ff7a2f; }
      #wavelink-native-queue .wl-native-queue-artist,
      #wavelink-native-queue .wl-native-queue-status {
        color: var(--text-subdued, #b3b3b3);
        font-size: 10px;
      }
      #wavelink-native-queue .wl-native-queue-status {
        max-width: 64px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        text-align: right;
      }
      #wavelink-native-queue .wl-native-queue-remove {
        width: 26px;
        height: 26px;
        border-radius: 50%;
        background: transparent;
        color: var(--text-subdued, #b3b3b3);
        font-size: 18px;
        line-height: 1;
      }
      #wavelink-native-queue .wl-native-queue-remove[hidden] { display: none; }
      #wavelink-native-queue .wl-native-queue-remove:hover {
        background: rgba(255,255,255,.1);
        color: #fff;
      }
      #wavelink-native-queue .wl-native-queue-empty {
        margin: 0;
        padding: 28px 16px;
        color: var(--text-subdued, #b3b3b3);
        font-size: 12px;
        text-align: center;
      }
      #wavelink-native-queue .wl-native-queue-page-status {
        display: block;
        width: 100%;
        margin: 0;
        padding: 12px 10px;
        border-radius: 8px;
        background: transparent;
        color: var(--text-subdued, #b3b3b3);
        font-size: 11px;
        line-height: 1.4;
        text-align: center;
      }
      #wavelink-native-queue .wl-native-queue-page-retry {
        color: #ffad80;
      }
      #wavelink-native-queue .wl-native-queue-page-retry:hover {
        background: rgba(255,85,0,.12);
        color: #fff;
      }
      @media (max-width: 850px) {
        #wavelink-native-controls .wl-native-queue-count { display: none; }
      }


      /* QOL: Ensure SC progress overlay never blocks Spotify UI when SC is inactive */
      body:not(.sc-active) #sc-progress {
        display: none !important;
        pointer-events: none !important;
      }

      /*
       * Source badge — fixed so it always appears above Spotify's player bar
       * regardless of which DOM element we manage to anchor into.
       */
      #wavelink-source-badge {
        position: fixed;
        bottom: max(96px, calc(env(safe-area-inset-bottom, 0px) + 84px));
        left: 12px;
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px 3px 7px;
        border-radius: 12px;
        font-size: 10px; font-weight: 700;
        color: #fff;
        letter-spacing: 0.04em; line-height: 1.6;
        white-space: nowrap;
        z-index: 9990;
        pointer-events: none;
        text-decoration: none;
        box-shadow: 0 2px 6px rgba(0,0,0,0.5);
        font-family: var(--font-family, system-ui, sans-serif);
        box-sizing: border-box;
        opacity: 1;
        transform: translateX(0);
        will-change: left, transform, bottom, opacity;
        transition:
          left 340ms cubic-bezier(0.2, 0.8, 0.2, 1),
          transform 340ms cubic-bezier(0.2, 0.8, 0.2, 1),
          bottom var(--wl-cinema-player-fade-ms, 280ms) ease,
          opacity var(--wl-cinema-player-fade-ms, 280ms) ease;
      }
      #wavelink-source-badge[hidden] { display: none !important; }
      #wavelink-source-badge[data-side="left"] {
        left: 12px;
        transform: translateX(0);
      }
      #wavelink-source-badge[data-side="right"] {
        left: calc(100vw - 12px);
        transform: translateX(-100%);
      }
      #wavelink-source-badge svg {
        display: block;
        flex: 0 0 auto;
      }
      #wavelink-source-badge[data-display-mode="icon-only"] {
        width: 26px;
        height: 26px;
        justify-content: center;
        gap: 0;
        padding: 5px;
        border-radius: 999px;
        line-height: 1;
      }
      #wavelink-source-badge[data-display-mode="icon-only"] .wl-source-badge__label {
        display: none;
      }
      #wavelink-source-badge.is-fullscreen-hidden {
        opacity: 0;
        pointer-events: none !important;
      }
      #wavelink-source-badge.is-fullscreen-docked {
        bottom: max(12px, env(safe-area-inset-bottom, 0px));
      }
      /*
       * Native Spotify applies Root__cinema-view--controls-hidden immediately,
       * then deliberately waits 500 ms before moving the cinema surface. Keep
       * only the badge's vertical/fade transitions on that same delay; side
       * changes used by hover-dodge must remain responsive. Removing the
       * collapsed class drops this selector, so controls and badge return
       * together without an added delay.
       */
      #wavelink-source-badge.sc-badge--spotify:is(
        .is-fullscreen-hidden,
        .is-fullscreen-docked
      ) {
        transition-delay: 0ms, 0ms, 500ms, 500ms;
      }
      #wavelink-source-badge.sc-badge--soundcloud { background: #ff5500; }
      #wavelink-source-badge.sc-badge--spotify {
        --wl-cinema-player-fade-ms: 300ms;
        background: #1db954;
      }
      @media (prefers-reduced-motion: reduce) {
        #wavelink-source-badge {
          transition: none;
        }
      }

      /*
       * Play/Pause button visual sync.
       * Spotify stays paused while SC is active (button shows ▶ natively).
       * When body.sc-playing: hide the SVG and overlay a ⏸ using CSS mask.
       * background-color: #000 — the large center button has a white circle
       * background; we need a dark icon to be visible against it.
       */
      body.sc-playing [data-testid="control-button-playpause"] {
        position: relative !important;
      }
      body.sc-playing [data-testid="control-button-playpause"] svg {
        visibility: hidden !important;
      }
      body.sc-playing [data-testid="control-button-playpause"]::after {
        content: '';
        position: absolute;
        top: 0; left: 0; right: 0; bottom: 0;
        -webkit-mask: ${PAUSE_ICON_URL} no-repeat center / 16px 16px;
        mask: ${PAUSE_ICON_URL} no-repeat center / 16px 16px;
        background-color: #000;
        pointer-events: none;
      }

      /*
       * Track-info overlay: data-sc-title / data-sc-artist stamped on the
       * outer track-info container divs + CSS ::before overlay that fills them.
       * Never touches textContent → no React reconciliation conflict.
       */
      body.sc-active [data-testid="now-playing-widget"],
      body.sc-active [data-testid="now-playing-widget-v2"],
      body.sc-active .main-nowPlayingWidget-nowPlaying {
        width: 100% !important;
        min-width: 0 !important;
      }
      body.sc-active .main-nowPlayingWidget-trackInfo,
      body.sc-active [data-testid="now-playing-widget"] > :has(.wl-sc-meta-title):has(.wl-sc-meta-artist),
      body.sc-active [data-testid="now-playing-widget-v2"] > :has([data-testid="now-playing-widget-v2-byline"]) {
        flex: 1 1 0 !important;
        width: auto !important;
        min-width: 0 !important;
        max-width: none !important;
        overflow: hidden !important;
      }
      body.sc-active .main-nowPlayingWidget-trackInfo .main-trackInfo-container,
      body.sc-active .main-nowPlayingWidget-trackInfo .main-trackInfo-name,
      body.sc-active .main-nowPlayingWidget-trackInfo .main-trackInfo-artists,
      body.sc-active .main-nowPlayingWidget-trackInfo .main-trackInfo-overlay,
      body.sc-active .main-nowPlayingWidget-trackInfo .main-trackInfo-overlay * {
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        --marquee-width: 100% !important;
      }

      /*
       * Show the FULL SoundCloud title/artist. Spotify clips them to a measured
       * marquee window (--marquee-width, e.g. 101px for a short Spotify title),
       * so longer SC titles get cut off. Expand the whole marquee chain to the
       * track-info width and disable the marquee so our ::before overlay only
       * ellipsizes at the real edge. Scoped to sc-active → Spotify untouched
       * otherwise.
       */
      body.sc-active .wl-sc-meta-host {
        color: transparent !important;
        position: relative !important;
        min-width: 0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
      }
      body.sc-active .wl-sc-meta-host.wl-sc-meta-panel {
        display: block !important;
        width: 100% !important;
        margin: 0 !important;
        cursor: default !important;
      }
      body.sc-active .wl-sc-meta-bar {
        display: block !important;
        width: 100% !important;
        margin: 0 !important;
      }
      body.sc-active .wl-sc-meta-host > :not(.wl-marquee-viewport) {
        opacity: 0 !important;
      }
      /*
       * NPV title/artist hosts wrap native Spotify anchors. The SoundCloud
       * marquee is visual-only; make every replaced native child completely
       * inert to pointer hit-testing while preserving hover on the outer host
       * so the WaveLink marquee can still pause and resume.
       */
      body.sc-active .wl-sc-meta-panel > :not(.wl-marquee-viewport),
      body.sc-active .wl-sc-meta-panel > :not(.wl-marquee-viewport) * {
        pointer-events: none !important;
        cursor: default !important;
        text-decoration: none !important;
      }
      body.sc-active .wl-sc-meta-host > .wl-marquee-viewport {
        color: var(--text-base, #fff) !important;
        opacity: 1 !important;
        position: absolute !important;
        inset: 0 !important;
        z-index: 4 !important;
        display: flex !important;
        align-items: center !important;
        width: 100% !important;
        max-width: 100% !important;
        min-width: 0 !important;
        overflow: hidden !important;
        white-space: nowrap !important;
        pointer-events: none !important;
      }
      body.sc-active .wl-sc-meta-host > .wl-marquee-viewport > .wl-marquee-content {
        color: inherit !important;
        opacity: 1 !important;
        display: block !important;
        flex: 0 0 auto !important;
        width: max-content !important;
        min-width: max-content !important;
        max-width: none !important;
        overflow: visible !important;
        white-space: nowrap !important;
        font: inherit !important;
        line-height: inherit !important;
        text-overflow: clip !important;
        transform: translate3d(0, 0, 0);
      }
      body.sc-active .wl-sc-meta-artist > .wl-marquee-viewport {
        color: var(--text-subdued, rgba(255,255,255,.7)) !important;
      }
      body.sc-active .wl-sc-meta-host[data-wl-overflow="true"] > .wl-marquee-viewport > .wl-marquee-content {
        will-change: transform;
      }
      body.sc-active .wl-sc-meta-host[data-wl-overflow="static"] > .wl-marquee-viewport > .wl-marquee-content {
        width: auto !important;
        min-width: 0 !important;
        max-width: 100% !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
      }

      body.sc-active .main-nowPlayingView-nowPlayingWidget .main-nowPlayingView-coverArtVisualEnhancement {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
      }
      body.sc-active .wl-sc-cover-host {
        position: relative !important;
      }
      /*
       * React mounts fresh Spotify images before our DOM reconciliation. Mask
       * them from their first paint, including the unmarked modern cinema
       * root. Visibility preserves the geometry used by the artwork overlay.
       * Never hide WaveLink covers or images inside owned Credits/queue cards.
       */
      body.sc-active :is(
        [data-npv-root],
        .NowPlayingView,
        .main-nowPlayingView-nowPlayingWidget,
        .Root__cinema-view,
        [data-wl-cinema-root],
        .Root__top-container > :has([role="radiogroup"] [role="radio"][value="artwork"]),
        [data-testid="cover-art-button"],
        [data-testid="cover-art-container"],
        [data-testid="CoverSlotCollapsed__container"],
        .main-nowPlayingWidget-coverArt,
        .main-coverSlotCollapsed-container
      ) :is(img, video):not(.wl-sc-cover):not([data-wl-owned]):not([data-wl-owned] *) {
        visibility: hidden !important;
      }
      body.sc-active [role="radiogroup"]:has([role="radio"][value="artwork"]) [role="radio"]:is([value="lyrics"], [value="canvas"]) {
        display: none !important;
      }
      body.sc-active .wl-sc-cover-host > .wl-sc-cover-owned {
        position: absolute !important;
        inset: 0 !important;
        z-index: 5 !important;
        display: block !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        object-fit: cover !important;
        border-radius: inherit !important;
        pointer-events: none !important;
      }
      body.sc-active .wl-sc-cover-host:has(video) > .wl-sc-cover-owned {
        object-fit: contain !important;
        background: var(--spice-main, #121212);
        border-radius: var(--encore-corner-radius-larger-2, 8px) !important;
      }
      .wl-spotify-cover-recovery-host {
        position: relative !important;
      }
      .wl-spotify-cover-recovery-host > .wl-spotify-cover-recovery {
        position: absolute !important;
        inset: 0 !important;
        z-index: 6 !important;
        display: block !important;
        width: 100% !important;
        height: 100% !important;
        max-width: none !important;
        max-height: none !important;
        object-fit: cover !important;
        border-radius: inherit !important;
        pointer-events: none !important;
      }
      body.sc-active .main-nowPlayingView-nowPlayingWidget .main-nowPlayingView-canvasVisualEnhancement {
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }
      body.sc-active .wl-sc-native-hidden {
        display: none !important;
      }
      /* Hide a newly mounted Spotify bio before the next reconciliation. */
      body.sc-active :is(${SEL_PANEL_ROOT.join(", ")}) :is(${SEL_PANEL_ARTIST_ABOUT}):not([data-wl-owned], [data-wl-owned] *) {
        display: none !important;
      }
      /*
       * Spotify action controls can briefly mount without a useful aria-label,
       * so semantic discovery cannot hide them until the next DOM pass. Keep
       * these fallbacks strictly inside a WaveLink-owned NPV surface.
       */
      body.sc-active .wl-sc-panel-surface .main-watchFeed-shareButtonHidden:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="share-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="now-playing-view-share-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [aria-label="Share"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="more-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="context-menu-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="now-playing-view-more-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [aria-label="More options"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [aria-label^="More options for "]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="add-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="remove-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="add-to-library-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="remove-from-library-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="add-to-liked-songs-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="remove-from-liked-songs-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="add-to-playlist-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [data-testid="remove-from-playlist-button"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [aria-label="Add to playlist"]:not([data-wl-owned]),
      body.sc-active .wl-sc-panel-surface [aria-label="Remove from playlist"]:not([data-wl-owned]) {
        display: none !important;
      }
      body.sc-active .wl-sc-native-blocked {
        cursor: default !important;
      }
      body.sc-active .wl-npv-context {
        appearance: none;
        border: 0;
        padding: 0;
        background: transparent;
        color: var(--text-base, #fff);
        font: inherit;
        font-weight: 700;
        line-height: 1.4;
        text-align: left;
        text-decoration: none;
        cursor: pointer;
        max-width: 100%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      body.sc-active .wl-npv-context:hover,
      body.sc-active .wl-npv-context:focus-visible {
        text-decoration: underline;
        outline: none;
      }
      body.sc-active .wl-npv-like {
        appearance: none;
        position: relative;
        box-sizing: border-box;
        display: inline-flex;
        flex: 0 0 32px;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        min-width: 32px;
        margin: 0;
        padding: 0;
        border: 0;
        border-radius: 50%;
        background: transparent;
        color: var(--text-subdued, #b3b3b3);
        cursor: pointer;
        line-height: 1;
      }
      body.sc-active .wl-npv-like:hover:not(:disabled),
      body.sc-active .wl-npv-like:focus-visible {
        color: var(--text-base, #fff);
        transform: scale(1.08);
        outline: none;
      }
      body.sc-active .wl-npv-like:focus-visible {
        box-shadow: 0 0 0 2px var(--text-base, #fff);
      }
      body.sc-active .wl-npv-like.is-liked {
        color: #ff5500;
      }
      body.sc-active .wl-npv-like.is-liked:hover:not(:disabled) {
        color: #ff7733;
      }
      body.sc-active .wl-npv-like:disabled {
        cursor: wait;
        opacity: .62;
      }
      body.sc-active .wl-npv-like svg {
        display: block;
        pointer-events: none;
      }
      body.sc-active .wl-npv-section {
        box-sizing: border-box;
        width: 100%;
        margin: 0 0 16px;
        padding: 16px;
        border-radius: 8px;
        background: var(--background-elevated-base, #242424);
        color: var(--text-base, #fff);
      }
      body.sc-active .wl-npv-section__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      body.sc-active .wl-npv-section__header h2 {
        margin: 0;
        color: inherit;
        font: inherit;
        font-weight: 700;
      }
      body.sc-active .wl-npv-credit-row,
      body.sc-active .wl-npv-next-row {
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 0;
      }
      body.sc-active .wl-npv-credit-person,
      body.sc-active .wl-npv-next-art-button,
      body.sc-active .wl-npv-next-main,
      body.sc-active .wl-npv-next-artist {
        appearance: none;
        border: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      body.sc-active .wl-npv-credit-person,
      body.sc-active .wl-npv-next-main {
        display: flex;
        align-items: center;
        gap: 10px;
        flex: 1 1 auto;
        min-width: 0;
      }
      body.sc-active .wl-npv-next-art-button {
        display: block;
        flex: 0 0 auto;
        line-height: 0;
        border-radius: 4px;
      }
      body.sc-active .wl-npv-credit-person:hover strong,
      body.sc-active .wl-npv-credit-person:focus-visible strong,
      body.sc-active .wl-npv-next-art-button:hover,
      body.sc-active .wl-npv-next-art-button:focus-visible,
      body.sc-active .wl-npv-next-main:hover strong,
      body.sc-active .wl-npv-next-main:focus-visible strong,
      body.sc-active .wl-npv-next-artist:hover,
      body.sc-active .wl-npv-next-artist:focus-visible {
        text-decoration: underline;
        outline: none;
      }
      body.sc-active .wl-npv-next-art-button:hover .wl-npv-next-art,
      body.sc-active .wl-npv-next-art-button:focus-visible .wl-npv-next-art {
        filter: brightness(1.12);
      }
      body.sc-active .wl-npv-credit-avatar,
      body.sc-active .wl-npv-next-art {
        flex: 0 0 auto;
        width: 48px;
        height: 48px;
        border-radius: 4px;
        object-fit: cover;
        background: var(--background-tinted-base, #333);
      }
      body.sc-active .wl-npv-credit-avatar {
        border-radius: 50%;
      }
      body.sc-active .wl-npv-credit-copy,
      body.sc-active .wl-npv-next-copy {
        display: grid;
        gap: 3px;
        min-width: 0;
      }
      body.sc-active .wl-npv-credit-copy strong,
      body.sc-active .wl-npv-next-copy strong,
      body.sc-active .wl-npv-credit-copy small,
      body.sc-active .wl-npv-next-copy small {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      body.sc-active .wl-npv-credit-copy small,
      body.sc-active .wl-npv-next-copy small,
      body.sc-active .wl-npv-empty {
        color: var(--text-subdued, #b3b3b3);
      }
      body.sc-active .wl-npv-follow {
        appearance: none;
        flex: 0 0 auto;
        min-width: 76px;
        min-height: 32px;
        padding: 5px 14px;
        border: 1px solid var(--essential-subdued, #878787);
        border-radius: 999px;
        background: transparent;
        color: var(--text-base, #fff);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      body.sc-active .wl-npv-follow:hover:not(:disabled),
      body.sc-active .wl-npv-follow:focus-visible {
        border-color: var(--text-base, #fff);
        transform: scale(1.04);
        outline: none;
      }
      body.sc-active .wl-npv-follow:disabled {
        cursor: wait;
        opacity: .65;
      }
      body.sc-active .wl-npv-next-copy {
        flex: 1 1 auto;
      }
      body.sc-active .wl-npv-next-artist {
        color: var(--text-subdued, #b3b3b3);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      body.sc-active .wl-npv-next-badge {
        color: #ff7a18;
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .06em;
      }

      /* WaveLink-owned SoundCloud artist visual for cinema/fullscreen mode. */
      body.sc-active .Root__cinema-view [role="radiogroup"] [role="radio"][value="canvas"]:not([data-wl-owned]) {
        display: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-controls-layer {
        z-index: 40 !important;
      }
      body.sc-active .Root__cinema-view:has(.wl-sc-cinema-artist-overlay.is-controls-visible) .wl-cinema-controls-layer,
      body.sc-active .Root__cinema-view:has(.wl-sc-cinema-artist-overlay.is-controls-visible) :has([role="radiogroup"]:not(.wl-cinema-avatar-position)) {
        opacity: 1 !important;
        visibility: visible !important;
        pointer-events: auto !important;
        transition-delay: 0s !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-foreground-layer {
        z-index: 30 !important;
      }
      body.sc-active .wl-cinema-player-layer,
      body.sc-active [data-testid="now-playing-bar"],
      body.sc-active .Root__now-playing-bar {
        opacity: 1;
        clip-path: inset(0 0 0 0);
        transition:
          clip-path var(--wl-cinema-player-fade-ms, 280ms) cubic-bezier(.2,.75,.2,1),
          opacity 180ms ease;
        will-change: clip-path, opacity;
      }
      body.sc-active .wl-cinema-player-layer.wl-cinema-player-idle,
      body.sc-active.wl-cinema-player-idle .wl-cinema-player-layer,
      body.sc-active.wl-cinema-player-idle [data-testid="now-playing-bar"],
      body.sc-active.wl-cinema-player-idle .Root__now-playing-bar {
        opacity: 0 !important;
        clip-path: inset(100% 0 0 0) !important;
        pointer-events: none !important;
      }
      body.sc-active .Root__cinema-view {
        transition:
          margin-bottom var(--wl-cinema-player-fade-ms, 280ms) cubic-bezier(.2,.75,.2,1) !important;
      }
      body.sc-active:not(.wl-cinema-player-idle) .Root__cinema-view.wl-sc-cinema-artwork-mode,
      body.sc-active:not(.wl-cinema-player-idle) .Root__cinema-view.wl-sc-cinema-artist-mode {
        margin-bottom: 0 !important;
      }
      body.sc-active.wl-cinema-player-idle .Root__cinema-view {
        /*
         * Mirror Spotify's native Root__cinema-view--controls-hidden layout:
         * grow the cinema grid item across the real player contribution and
         * row gap while the transparent player remains safely underneath.
         */
        margin-bottom:
          calc(-1 * var(--wl-cinema-player-grid-offset, 80px)) !important;
        z-index:
          var(--above-everything-grid-area-z-index, 100) !important;
        transition-delay: 0s !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-visual-host {
        isolation: isolate !important;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artwork-mode {
        background: #101012 !important;
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artwork-background {
        position: absolute !important;
        inset: 0 !important;
        /*
         * Own the complete artwork visual above Spotify's stale palette.
         * WaveLink's foreground panels and Spotify's controls remain higher.
         */
        z-index: 20 !important;
        display: block;
        contain: paint;
        overflow: hidden;
        pointer-events: none !important;
        background:
          radial-gradient(circle at 50% 30%, #28282d 0%, #151518 48%, #0d0d0f 100%);
        transition: background-color 180ms ease;
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artwork-background[data-background-mode="color"] {
        background: var(--wl-cinema-color-dark, #2A2A2A);
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artwork-background[hidden] {
        display: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-backdrop {
        position: absolute;
        inset: -12%;
        z-index: 0;
        width: 124%;
        height: 124%;
        object-fit: cover;
        object-position: center;
        opacity: 1;
        filter: blur(clamp(42px, 6vw, 88px)) saturate(1.38) brightness(.52);
        transform: scale(1.08);
        transition: opacity 180ms ease;
        backface-visibility: hidden;
        user-select: none;
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artwork-background[data-background-mode="color"] .wl-cinema-artwork-backdrop {
        opacity: 0;
        visibility: hidden;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-backdrop[hidden] {
        display: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-cover {
        position: absolute;
        top: 48%;
        left: 50%;
        z-index: 2;
        box-sizing: border-box;
        height: min(65%, 640px);
        width: auto;
        max-width: calc(100% - 40px);
        aspect-ratio: 1;
        border-radius: 8px;
        object-fit: cover;
        object-position: center;
        box-shadow: 0 12px 42px rgba(0,0,0,.34);
        transform: translate(-50%, -50%);
        user-select: none;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-cover.is-native-aligned {
        top: 0;
        left: 0;
        max-width: none;
        transform-origin: 0 0;
        transform:
          translate3d(
            var(--wl-cinema-cover-x, 0px),
            var(--wl-cinema-cover-y, 0px),
            0
          )
          scale(
            var(--wl-cinema-cover-scale-x, 1),
            var(--wl-cinema-cover-scale-y, 1)
          );
        will-change: transform;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-cover[hidden] {
        display: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground {
        position: absolute !important;
        right: clamp(16px, 12vw, 192px);
        bottom: 0;
        left: clamp(16px, 12vw, 192px);
        z-index: 30 !important;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        align-items: start;
        gap: 16px;
        opacity: var(--wl-cinema-panels-opacity, 0);
        visibility: hidden;
        transform: translateY(
          calc((1 - var(--wl-cinema-panels-opacity, 0)) * 18px)
        );
        transition:
          opacity var(--wl-cinema-panels-fade-ms, 160ms) linear,
          transform var(--wl-cinema-panels-fade-ms, 160ms) ease;
        contain: layout style;
        will-change: opacity, transform;
        pointer-events: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground.is-scroll-active {
        transition: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground.is-scroll-active .wl-cinema-artwork-background-control {
        background: rgba(16,16,18,.94);
        backdrop-filter: none;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground.has-scroll-progress {
        visibility: visible;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground.is-scroll-interactive {
        pointer-events: auto !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground[hidden] {
        display: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground .wl-npv-section {
        order: 1;
        min-width: 0;
        margin-bottom: 0;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-background-control {
        order: 2;
        grid-column: 1 / -1;
        justify-self: center;
        display: inline-flex;
        align-items: center;
        padding: 4px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 999px;
        background: rgba(16,16,18,.74);
        box-shadow: 0 8px 28px rgba(0,0,0,.34);
        backdrop-filter: blur(16px) saturate(1.15);
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-background-control button {
        appearance: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 34px;
        margin: 0;
        padding: 0 13px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: rgba(255,255,255,.78);
        font: 700 11px/1 var(--font-family, system-ui, sans-serif);
        cursor: pointer;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-background-control button:hover,
      body.sc-active .Root__cinema-view .wl-cinema-artwork-background-control button:focus-visible {
        background: rgba(255,255,255,.13);
        color: #fff;
        outline: none;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-background-control button:focus-visible {
        box-shadow: inset 0 0 0 2px #fff;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artwork-background-control [aria-checked="true"] {
        background: #ff5500;
        color: #fff;
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artwork-background::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        background:
          radial-gradient(circle at 50% 34%, rgba(255,255,255,.06), transparent 48%),
          linear-gradient(to bottom, rgba(0,0,0,.14) 0%, rgba(0,0,0,.24) 56%, rgba(0,0,0,.72) 100%),
          linear-gradient(to right, rgba(0,0,0,.16), transparent 28%, transparent 72%, rgba(0,0,0,.16));
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artwork-background[data-background-mode="color"]::after {
        background:
          linear-gradient(to bottom, rgba(0,0,0,.08) 0%, rgba(0,0,0,.16) 58%, rgba(0,0,0,.58) 100%),
          linear-gradient(to right, rgba(0,0,0,.1), transparent 30%, transparent 70%, rgba(0,0,0,.1));
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toggle[aria-checked="true"] {
        color: #ff5500 !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toggle {
        position: relative !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        animation: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toggle::after {
        content: '' !important;
        position: absolute !important;
        left: 50% !important;
        bottom: -5px !important;
        width: 4px !important;
        height: 4px !important;
        border-radius: 50% !important;
        background: #ff5500 !important;
        opacity: 0 !important;
        transform: translateX(-50%) !important;
        transition: opacity 120ms ease !important;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-cinema-artist-toggle::after {
        opacity: 1 !important;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-cinema-artwork-toggle {
        color: var(--text-subdued, #b3b3b3) !important;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-cinema-artwork-toggle::after {
        opacity: 0 !important;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode {
        position: relative !important;
        isolation: isolate;
        background: #0b0b0d !important;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-cinema-scroll-viewport {
        overflow-y: hidden !important;
        overscroll-behavior-y: none !important;
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artist-overlay {
        position: absolute !important;
        inset: 0 !important;
        z-index: 20 !important;
        display: block;
        overflow: hidden;
        pointer-events: none;
        background:
          radial-gradient(circle at 50% 40%, rgba(255,85,0,.2), transparent 42%),
          linear-gradient(145deg, #26160f 0%, #111114 48%, #080809 100%);
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artist-overlay[hidden] {
        display: none !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-backdrop {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
        opacity: .92;
        filter: saturate(.92) contrast(1.03);
        transform: scale(1.002);
        user-select: none;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-overlay::after {
        content: '';
        position: absolute;
        inset: 0;
        z-index: 1;
        background:
          linear-gradient(to bottom, rgba(0,0,0,.3) 0%, transparent 28%, rgba(0,0,0,.12) 55%, rgba(0,0,0,.74) 100%),
          linear-gradient(to right, rgba(0,0,0,.2), transparent 30%, transparent 70%, rgba(0,0,0,.2));
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-avatar {
        position: absolute;
        top: 48%;
        left: 50%;
        z-index: 2;
        box-sizing: border-box;
        width: clamp(152px, 18vw, 264px);
        height: clamp(152px, 18vw, 264px);
        border: clamp(4px, .45vw, 7px) solid #ff5500;
        border-radius: 50%;
        object-fit: cover;
        object-position: center;
        background: linear-gradient(135deg, #ff8a00, #ff3d00);
        box-shadow: 0 18px 62px rgba(0,0,0,.62);
        transform: translate(-50%, -50%);
        transition: left 220ms cubic-bezier(.2,.75,.2,1), opacity 160ms ease, transform 220ms cubic-bezier(.2,.75,.2,1);
        user-select: none;
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artist-overlay.is-avatar-border-hidden .wl-cinema-artist-avatar {
        border: 0;
        box-shadow: 0 18px 62px rgba(0,0,0,.62);
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artist-overlay[data-avatar-position="left"] .wl-cinema-artist-avatar {
        left: 18%;
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artist-overlay[data-avatar-position="right"] .wl-cinema-artist-avatar {
        left: 82%;
      }
      body.sc-active .Root__cinema-view .wl-sc-cinema-artist-overlay.is-avatar-hidden .wl-cinema-artist-avatar {
        opacity: 0;
        transform: translate(-50%, -50%) scale(.82);
        visibility: hidden;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toolbar {
        position: absolute;
        top: auto;
        bottom: calc(var(--wl-cinema-info-height, 112px) + 14px);
        left: 50%;
        z-index: 4;
        display: inline-flex;
        align-items: center;
        gap: 4px;
        max-width: calc(100% - 32px);
        padding: 5px;
        border: 1px solid rgba(255,255,255,.16);
        border-radius: 999px;
        background: rgba(16,16,18,.72);
        box-shadow: 0 8px 28px rgba(0,0,0,.34);
        color: #fff;
        opacity: 0;
        transform: translate(-50%, 8px);
        transition:
          opacity var(--wl-cinema-toolbar-fade-ms, 160ms) ease,
          transform var(--wl-cinema-toolbar-fade-ms, 160ms) ease;
        backdrop-filter: blur(16px) saturate(1.15);
        pointer-events: none;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toolbar.is-visible {
        opacity: 1;
        transform: translate(-50%, 0);
        pointer-events: auto;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-cinema-artist-toolbar {
        bottom: 24px;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toolbar button {
        appearance: none;
        box-sizing: border-box;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 34px;
        height: 34px;
        margin: 0;
        padding: 0 10px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: rgba(255,255,255,.78);
        font: 700 11px/1 var(--font-family, system-ui, sans-serif);
        cursor: pointer;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toolbar button:hover:not(:disabled),
      body.sc-active .Root__cinema-view .wl-cinema-artist-toolbar button:focus-visible {
        background: rgba(255,255,255,.13);
        color: #fff;
        outline: none;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toolbar button:focus-visible {
        box-shadow: inset 0 0 0 2px #fff;
      }
      body.sc-active .Root__cinema-view .wl-cinema-avatar-toggle[aria-pressed="true"],
      body.sc-active .Root__cinema-view .wl-cinema-avatar-border-toggle[aria-pressed="true"],
      body.sc-active .Root__cinema-view .wl-cinema-avatar-position [aria-checked="true"] {
        background: #ff5500;
        color: #fff;
      }
      body.sc-active .Root__cinema-view .wl-cinema-avatar-position {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        padding-left: 4px;
        border-left: 1px solid rgba(255,255,255,.16);
      }
      body.sc-active .Root__cinema-view .wl-cinema-avatar-position button {
        width: 32px;
        min-width: 32px;
        padding: 0;
      }
      body.sc-active .Root__cinema-view .wl-cinema-avatar-toggle {
        border-radius: 999px 0 0 999px !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-avatar-border-toggle {
        margin-left: 4px !important;
        border-left: 1px solid rgba(255,255,255,.16) !important;
        border-radius: 0 999px 999px 0 !important;
      }
      body.sc-active .Root__cinema-view .wl-cinema-artist-toolbar button:disabled {
        opacity: .34;
        cursor: default;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .main-nowPlayingView-coverArtVisualEnhancement,
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .main-nowPlayingView-canvasVisualEnhancement {
        visibility: hidden !important;
        opacity: 0 !important;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-npv-context,
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-sc-meta-host {
        position: relative !important;
        z-index: 30 !important;
      }
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-npv-credits,
      body.sc-active .Root__cinema-view.wl-sc-cinema-artist-mode .wl-npv-queue {
        display: none !important;
      }
      @media (max-width: 700px) {
        body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground {
          right: 12px;
          left: 12px;
          grid-template-columns: 1fr;
          gap: 8px;
        }
        body.sc-active .Root__cinema-view .wl-cinema-artist-avatar {
          width: clamp(128px, 34vw, 190px);
          height: clamp(128px, 34vw, 190px);
        }
        body.sc-active .Root__cinema-view .wl-sc-cinema-artist-overlay[data-avatar-position="left"] .wl-cinema-artist-avatar {
          left: 24%;
        }
        body.sc-active .Root__cinema-view .wl-sc-cinema-artist-overlay[data-avatar-position="right"] .wl-cinema-artist-avatar {
          left: 76%;
        }
      }
      @media (prefers-reduced-motion: reduce) {
        body.sc-active .wl-marquee-content {
          animation: none !important;
          transition: none !important;
        }
        body.sc-active .Root__cinema-view .wl-cinema-artist-avatar {
          transition: none !important;
        }
        body.sc-active .Root__cinema-view .wl-cinema-artist-toolbar,
        body.sc-active .Root__cinema-view .wl-cinema-artist-toggle::after,
        body.sc-active .Root__cinema-view .wl-cinema-artwork-foreground,
        body.sc-active .Root__cinema-view,
        body.sc-active .wl-cinema-player-layer,
        body.sc-active .Root__cinema-view .wl-sc-cinema-artwork-background,
        body.sc-active .Root__cinema-view .wl-cinema-artwork-backdrop {
          transition: none !important;
        }
      }

      /*
       * Time-label overlay: data-sc-time attribute + CSS ::before.
       * Never touches textContent → no React reconciliation conflict.
       */
      body.sc-active [data-testid="playback-position"],
      body.sc-active [data-testid="playback-duration"],
      body.sc-active .playback-progressbar__time-elapsed,
      body.sc-active .playback-progressbar__time-total {
        color: transparent !important;
        position: relative !important;
      }
      body.sc-active [data-testid="playback-position"]::before,
      body.sc-active [data-testid="playback-duration"]::before,
      body.sc-active .playback-progressbar__time-elapsed::before,
      body.sc-active .playback-progressbar__time-total::before {
        content: attr(data-sc-time);
        color: var(--spice-subtext, #b3b3b3);
        position: absolute;
        z-index: 1;
        top: 0; left: 0; right: 0; bottom: 0;
        display: flex; align-items: center; justify-content: center;
      }

      /*
       * Custom SoundCloud progress bar.
       * Spotify's own fill/thumb/hover-tooltip are computed from ITS paused
       * track's length, so they can't reflect the SC track. We hide Spotify's
       * inner bar and overlay our own, fully driven by the SC position. The
       * overlay sits on top with pointer events, so Spotify never sees hover or
       * clicks (and thus never shows its wrong tooltip).
       */
      body.sc-active [data-testid="playback-progressbar"] { position: relative; }
      body.sc-active [data-testid="playback-progressbar"] [data-testid="progress-bar"] {
        visibility: hidden !important;
      }
      #sc-progress { display: none; }
      body.sc-active #sc-progress {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        cursor: pointer;
        z-index: 10;
        /* Expand hitbox vertically to make dragging easier without changing visual height */
        padding: 12px 0;
        margin: -12px 0;
      }
      #sc-progress .sc-progress__track {
        position: relative;
        width: 100%;
        height: 4px;
        border-radius: 2px;
        background: var(--background-tinted-base, rgba(255,255,255,0.3));
        /* Fix: Ensure track stays visually centered in the expanded hitbox */
        margin-top: auto;
        margin-bottom: auto;
      }
      #sc-progress .sc-progress__fill {
        position: absolute;
        left: 0; top: 0; bottom: 0;
        width: 0%;
        border-radius: 2px;
        background: var(--spice-text, #fff);
      }
      #sc-progress:hover .sc-progress__fill,
      #sc-progress.sc-progress--hover .sc-progress__fill {
        background: #1ed760;
      }
      #sc-progress .sc-progress__thumb {
        position: absolute;
        top: 50%; left: 0%;
        width: 12px; height: 12px;
        margin-left: -6px;
        border-radius: 50%;
        background: #fff;
        transform: translateY(-50%);
        opacity: 0;
        transition: opacity 0.1s;
      }
      #sc-progress:hover .sc-progress__thumb,
      #sc-progress.sc-progress--hover .sc-progress__thumb {
        opacity: 1;
      }
      #sc-progress .sc-progress__tip {
        position: absolute;
        bottom: 100%;
        left: 0;
        transform: translateX(-50%);
        margin-bottom: 8px;
        padding: 3px 7px;
        border-radius: 4px;
        background: #000;
        color: #fff;
        font-size: 11px; font-weight: 600;
        white-space: nowrap;
        pointer-events: none;
        opacity: 0;
        font-family: var(--font-family, system-ui, sans-serif);
      }
      #sc-progress.sc-progress--hover .sc-progress__tip { opacity: 1; }
    `;
    // Spicetify no longer supplies the semantic cinema class on every build.
    // Keep the existing fullscreen rules shared with our discovered root.
    s.textContent = s.textContent.replace(
      /\.Root__cinema-view(?![-\w])/g,
      ":is(.Root__cinema-view, [data-wl-cinema-root])",
    );
    document.head.appendChild(s);
  }

  // ── Volume helpers ────────────────────────────────────────────────────────

  private readSpotifyVolume(): number | null {
    try {
      const inp = q<HTMLInputElement>(SEL_VOLUME);
      if (!inp) return null;
      const max = parseFloat(inp.max);
      const val = parseFloat(inp.value);
      if (!isFinite(val)) return null;
      return isFinite(max) && max > 1 ? val / max : val;
    } catch {
      return null;
    }
  }

  private _lastCheckedVolume: number = -1;
  private checkVolumeChanges(): void {
    if (this._isUpdatingSpotifyRange) return;
    try {
      const vol = Spicetify.Player.getVolume();
      // If the volume changed since we last checked
      if (Math.abs(vol - this._lastCheckedVolume) > 0.001) {
        this._lastCheckedVolume = vol;
        if (this._track) {
          this.audio.muted = vol <= 0.001;
          if (vol > 0) this.audio.volume = vol;
          if (this._scVolMultEnabled) {
            this._scVolumeLevel = vol;
            try { Spicetify.LocalStorage.set("wavelink:volume-level", String(vol)); } catch {}
          }
        }
      }
    } catch {}
  }

  // ── Source badge ─────────────────────────────────────────────────────────

  private ensureSourceBadge(): HTMLAnchorElement {
    if (this._sourceBadge && document.contains(this._sourceBadge)) {
      return this._sourceBadge;
    }
    this.resetSourceBadgeHoverDodge(false);
    const element = document.createElement("a");
    element.id = "wavelink-source-badge";
    element.hidden = true;
    element.dataset.wlOwned = "true";
    document.body.appendChild(element);
    this._sourceBadge = element;
    return element;
  }

  private isSourceBadgeFullscreenPlayerHidden(): boolean {
    return sourceBadgeFullscreenPlayerHidden({
      source: this._sourceBadgeSource,
      soundCloudPlayerHidden: document.body.classList.contains(
        "wl-cinema-player-idle",
      ),
      spotifyPlayerHidden: this.cinemaRoots().some((root) =>
        root.classList.contains("Root__cinema-view--controls-hidden"),
      ),
    });
  }

  private applySourceBadgePresentation(): void {
    const badge = this._sourceBadge;
    if (!badge) return;
    const trackUrl =
      this._sourceBadgeSource === "soundcloud" && this._track
        ? this._track.sharing === "private"
          ? this._track.user.permalink_url
          : this._track.permalink_url
        : null;
    const presentation = sourceBadgePresentation(
      this._sourceBadgePreferences,
      {
        source: this._sourceBadgeSource,
        runtimeSide: this._sourceBadgeRuntimeSide,
        fullscreenPlayerHidden:
          this.isSourceBadgeFullscreenPlayerHidden(),
        soundCloudUrl: trackUrl,
        trackTitle: this._track?.title,
      },
    );

    badge.hidden = !presentation.visible;
    badge.dataset.source = this._sourceBadgeSource ?? "";
    badge.dataset.side = presentation.side;
    badge.dataset.displayMode = this._sourceBadgePreferences.displayMode;
    badge.dataset.hideWithPlayer = String(
      this._sourceBadgePreferences.hideWithFullscreenPlayer,
    );
    badge.classList.toggle(
      "sc-badge--soundcloud",
      this._sourceBadgeSource === "soundcloud",
    );
    badge.classList.toggle(
      "sc-badge--spotify",
      this._sourceBadgeSource === "spotify",
    );
    badge.classList.toggle(
      "is-fullscreen-hidden",
      presentation.fadeWithFullscreenPlayer,
    );
    badge.classList.toggle(
      "is-fullscreen-docked",
      presentation.dockAtViewportEdge,
    );
    badge.setAttribute("aria-hidden", String(presentation.ariaHidden));
    badge.setAttribute("aria-label", presentation.ariaLabel);
    badge.title = presentation.ariaLabel;
    badge.style.pointerEvents = presentation.pointerInteractive
      ? "auto"
      : "none";
    badge.style.cursor = presentation.href ? "pointer" : "default";

    if (presentation.href) {
      badge.href = presentation.href;
      badge.target = "_blank";
      badge.rel = "noreferrer";
      badge.removeAttribute("tabindex");
    } else {
      badge.removeAttribute("href");
      badge.removeAttribute("target");
      badge.removeAttribute("rel");
      badge.tabIndex = -1;
    }

    const renderSignature = `${this._sourceBadgeSource ?? "none"}:${this._sourceBadgePreferences.displayMode}`;
    if (badge.dataset.renderSignature === renderSignature) return;
    badge.dataset.renderSignature = renderSignature;
    const soundCloudSvg =
      `<svg viewBox="0 0 24 24" fill="white" width="16" height="16" aria-hidden="true">` +
      `<path d="M23.999 14.165c-.052 1.796-1.612 3.169-3.4 3.169h-8.18a.68.68 0 0 1-.675-.683V7.862a.747.747 0 0 1 .452-.724s.75-.513 2.333-.513a5.364 5.364 0 0 1 2.763.755 5.433 5.433 0 0 1 2.57 3.54c.282-.08.574-.121.868-.12.884 0 1.73.358 2.347.992s.948 1.49.922 2.373ZM10.721 8.421c.247 2.98.427 5.697 0 8.672a.264.264 0 0 1-.53 0c-.395-2.946-.22-5.718 0-8.672a.264.264 0 0 1 .53 0ZM9.072 9.448c.285 2.659.37 4.986-.006 7.655a.277.277 0 0 1-.55 0c-.331-2.63-.256-5.02 0-7.655a.277.277 0 0 1 .556 0Zm-1.663-.257c.27 2.726.39 5.171 0 7.904a.266.266 0 0 1-.532 0c-.38-2.69-.257-5.21 0-7.904a.266.266 0 0 1 .532 0Zm-1.647.77a26.108 26.108 0 0 1-.008 7.147.272.272 0 0 1-.542 0 27.955 27.955 0 0 1 0-7.147.275.275 0 0 1 .55 0Zm-1.67 1.769c.421 1.865.228 3.5-.029 5.388a.257.257 0 0 1-.514 0c-.21-1.858-.398-3.549 0-5.389a.272.272 0 0 1 .543 0Zm-1.655-.273c.388 1.897.26 3.508-.01 5.412-.026.28-.514.283-.54 0-.244-1.878-.347-3.54-.01-5.412a.283.283 0 0 1 .56 0Zm-1.668.911c.4 1.268.257 2.292-.026 3.572a.257.257 0 0 1-.514 0c-.241-1.262-.354-2.312-.023-3.572a.283.283 0 0 1 .563 0Z"/>` +
      `</svg>`;
    const spotifySvg =
      `<svg viewBox="0 0 24 24" fill="white" width="16" height="16" aria-hidden="true">` +
      `<path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>` +
      `</svg>`;
    const label =
      this._sourceBadgeSource === "spotify" ? "Spotify" : "SoundCloud";
    badge.innerHTML =
      (this._sourceBadgeSource === "spotify"
        ? spotifySvg
        : soundCloudSvg) +
      `<span class="wl-source-badge__label">${label}</span>`;
  }

  private updateSourceBadge(source: SourceBadgeSource): void {
    if (this._sourceBadge && !document.contains(this._sourceBadge)) {
      this._sourceBadge = null;
      this.resetSourceBadgeHoverDodge(false);
    }
    const previousSource = this._sourceBadgeSource;
    this._sourceBadgeSource = source;
    if (source !== previousSource) {
      this.resetSourceBadgeHoverDodge(false);
    }
    if (
      !this._sourceBadge &&
      (!this._sourceBadgePreferences.enabled || source === null)
    ) {
      return;
    }
    this.ensureSourceBadge();
    this.applySourceBadgePresentation();
  }

  // Decide which source badge to show from current state:
  //   • SoundCloud — an SC track is actively playing or loading
  //   • Spotify    — no SC track active and Spotify is playing
  //   • none       — nothing is playing
  private refreshSourceBadge(): void {
    let source: "soundcloud" | "spotify" | null = null;
    if (this._track && (this._isLoading || !this.audio.paused)) {
      source = "soundcloud";
    } else {
      let spotifyPlaying = false;
      try {
        spotifyPlaying = !!Spicetify?.Player?.isPlaying?.();
      } catch {}
      if (spotifyPlaying) source = "spotify";
    }
    this.updateSourceBadge(source);
  }

  // ── Progress bar ─────────────────────────────────────────────────────────

  private syncSpotifyProgress(): void {
    if (
      !this._track ||
      !isFinite(this.audio.duration) ||
      this.audio.duration <= 0
    )
      return;
    const cur = this.audio.currentTime;
    const dur = this.audio.duration;
    const fraction = cur / dur;

    // Always update time labels (text changes don't interfere with drag).
    try {
      if (!this._cachedPosEl || !document.contains(this._cachedPosEl))
        this._cachedPosEl = q(SEL_POS_TEXT);
      if (this._cachedPosEl)
        this._cachedPosEl.setAttribute("data-sc-time", fmtTime(cur));
      if (!this._cachedDurEl || !document.contains(this._cachedDurEl))
        this._cachedDurEl = q(SEL_DUR_TEXT);
      if (this._cachedDurEl)
        this._cachedDurEl.setAttribute("data-sc-time", fmtTime(dur));
    } catch {}

    // Skip fill/thumb updates while the user is dragging — otherwise the
    // thumb snaps back to SC's current position every 250 ms.
    if (this._isSeeking) return;

    //paint our own overlay bar (Spotify's underlying bar is hidden via CSS),
    //so the fill exactly matches the SC track's position and length.
    this.updateProgressOverlay(fraction);

    // Fix: Do NOT update Spotify's range input value. It causes an asynchronous
    // feedback loop where Spotify thinks the user seeked, firing an onseek event
    // after our guard flag resets, and forces SC audio to jump to that position.
    // Our overlay (#sc-progress) handles the visual entirely.
  }

  // ── Now-playing metadata ──────────────────────────────────────────────────

  private updateNowPlayingBar(): void {
    document.body.classList.add("sc-active");
    this._tryEnsureNativeControls?.();
    this.updateNativeControls();
    this.applyTrackInfo();
    this.refreshSourceBadge();
    setTimeout(() => {
      this._tryHookSkipButtons?.();
      this._tryHookProgressBar?.();
    }, 150);
  }

  // Write the SC title / artist / cover onto Spotify's now-playing widget.
  // Runs on every timer tick (not just on load) because Spotify re-renders the
  // track-info widget (e.g. its marquee recalculation) and drops our attributes
  // — without re-applying, the bar reverts to the paused Spotify track's title.
  private getNativeMetadata(): { title: string; artists: string[] } {
    try {
      const item = (
        Spicetify.Player as unknown as {
          data?: {
            item?: {
              name?: string;
              artists?: Array<{ name?: string }>;
              metadata?: Record<string, string | undefined>;
            };
          };
        }
      ).data?.item;
      const metadataArtist = normalizeMetadataText(
        item?.metadata?.artist_name ?? item?.metadata?.artistName,
      );
      const artists = (item?.artists ?? [])
        .map((artist) => normalizeMetadataText(artist.name))
        .filter(Boolean);
      if (artists.length === 0 && metadataArtist) artists.push(metadataArtist);
      return { title: normalizeMetadataText(item?.name), artists };
    } catch {
      return { title: "", artists: [] };
    }
  }

  private findExactMetadataHost(
    root: ParentNode,
    expectedText: string,
  ): HTMLElement | null {
    const normalized = normalizeMetadataText(expectedText);
    if (!normalized) return null;
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a, [data-encore-id="text"], span, div',
      ),
    ).filter(
      (element) =>
        !element.closest(".wl-marquee-viewport") &&
        normalizeMetadataText(element.textContent) === normalized,
    );
    if (candidates.length === 0) return null;

    const deepest =
      candidates.find(
        (element) =>
          !Array.from(element.children).some(
            (child) =>
              !child.classList.contains("wl-marquee-viewport") &&
              normalizeMetadataText(child.textContent) === normalized,
          ),
      ) ?? candidates[0];
    let promoted = deepest;
    let parent = promoted.parentElement;
    while (
      parent &&
      parent !== root &&
      !parent.classList.contains("wl-marquee-viewport") &&
      normalizeMetadataText(parent.textContent) === normalized
    ) {
      promoted = parent;
      parent = parent.parentElement;
    }
    return promoted;
  }

  private findPanelArtistHost(
    root: HTMLElement,
    nativeTitle: string,
    artists: string[],
    seedHost: HTMLElement | null = null,
  ): HTMLElement | null {
    const cleanArtists = artists.map(normalizeMetadataText).filter(Boolean);
    const metadataScope =
      seedHost?.closest<HTMLElement>(SEL_PANEL_META_ROOT.join(", ")) ??
      qWithin<HTMLElement>(root, SEL_PANEL_META_ROOT) ??
      root;
    const artistActions = Array.from(
      metadataScope.querySelectorAll<HTMLElement>(
        'a, [href], [role="link"], [data-testid="context-item-info-artist"]',
      ),
    ).filter((element) => {
      if (
        element.closest("[data-wl-owned]") ||
        element.closest(".wl-marquee-viewport")
      ) {
        return false;
      }
      const href = normalizeMetadataText(element.getAttribute("href"));
      const text = normalizeMetadataText(element.textContent);
      return (
        element.getAttribute("data-testid") ===
          "context-item-info-artist" ||
        /(?:^spotify:artist:|\/artist\/)/i.test(href) ||
        cleanArtists.some(
          (artist) => text === artist || text.includes(artist),
        )
      );
    });

    const semanticRow = qWithin<HTMLElement>(metadataScope, [
      ".main-trackInfo-artists:not([data-encore-id])",
      '[data-testid="context-item-info-subtitles"]',
    ]);
    if (semanticRow) return semanticRow;
    let best = seedHost;
    for (const combined of [
      cleanArtists.join(", "),
      cleanArtists.join(" • "),
      cleanArtists.join(" & "),
    ]) {
      const exact = this.findExactMetadataHost(metadataScope, combined);
      if (exact) {
        best = exact;
        break;
      }
    }

    best ??= this.findExactMetadataHost(
      metadataScope,
      cleanArtists[0] ?? "",
    );
    best ??= artistActions[0] ?? null;
    if (!best) return null;

    const titleHost = qWithin<HTMLElement>(metadataScope, SEL_TITLE);
    let parent = best.parentElement;
    while (
      artistActions.length > 0 &&
      !artistActions.every(
        (element) => element === best || best!.contains(element),
      ) &&
      parent &&
      parent !== metadataScope
    ) {
      if (
        titleHost &&
        (parent === titleHost || parent.contains(titleHost))
      ) {
        break;
      }
      const foreignAction = Array.from(
        parent.querySelectorAll<HTMLElement>(
          'a, [href], button, [role="link"], [role="button"]',
        ),
      ).some(
        (element) =>
          !artistActions.some(
            (artistAction) =>
              artistAction === element ||
              artistAction.contains(element) ||
              element.contains(artistAction),
          ) && !element.closest("[data-wl-owned]"),
      );
      if (foreignAction) break;
      best = parent;
      parent = parent.parentElement;
    }

    // Some Spotify builds expose text wrappers without semantic artist hrefs.
    // Retain the guarded text promotion as a fallback for those shapes.
    parent = best.parentElement;
    while (artistActions.length === 0 && parent && parent !== metadataScope) {
      const text = normalizeMetadataText(parent.textContent);
      if (nativeTitle && text.includes(nativeTitle)) break;
      if (!cleanArtists.every((artist) => text.includes(artist))) break;
      best = parent;
      parent = parent.parentElement;
    }
    return best;
  }

  private panelRoots(): HTMLElement[] {
    this.cinemaRoots();
    return qAllUnique<HTMLElement>(SEL_PANEL_ROOT);
  }

  private playerBarWidgets(): HTMLElement[] {
    const bars = qAllUnique<HTMLElement>(SEL_PLAYER_BAR);
    const widgets = qAllUnique<HTMLElement>(SEL_BAR_WIDGET);
    // The sidebar/cinema may contain a second widget. Only the real bottom
    // bar owns these bindings; older Spotify builds have no semantic bar root.
    return bars.length > 0
      ? widgets.filter((widget) => bars.some((bar) => bar.contains(widget)))
      : widgets;
  }

  private hideNativeElement(
    element: HTMLElement,
    active: Set<HTMLElement>,
  ): void {
    active.add(element);
    if (!this._hiddenNative.has(element)) {
      this._hiddenNative.set(element, {
        ariaHidden: element.getAttribute("aria-hidden"),
        inert: (element as HTMLElement & { inert: boolean }).inert,
      });
    }
    element.classList.add("wl-sc-native-hidden");
    element.setAttribute("aria-hidden", "true");
    (element as HTMLElement & { inert: boolean }).inert = true;
  }

  private restoreHiddenNative(
    element: HTMLElement,
    snapshot: HiddenNativeSnapshot,
  ): void {
    element.classList.remove("wl-sc-native-hidden");
    restoreAttribute(element, "aria-hidden", snapshot.ariaHidden);
    (element as HTMLElement & { inert: boolean }).inert = snapshot.inert;
    this._hiddenNative.delete(element);
  }

  private releaseUnusedHiddenNative(active: Set<HTMLElement>): void {
    for (const [element, snapshot] of Array.from(this._hiddenNative)) {
      if (!active.has(element) || !document.contains(element)) {
        this.restoreHiddenNative(element, snapshot);
      }
    }
  }

  private cinemaRoots(): HTMLElement[] {
    const roots = Array.from(
      document.querySelectorAll<HTMLElement>(".Root__cinema-view"),
    );
    const detected = new Set<HTMLElement>();
    for (const group of Array.from(document.querySelectorAll<HTMLElement>(
      '[role="radiogroup"]',
    ))) {
      if (
        group.closest("[data-wl-owned]") ||
        !group.querySelector('[role="radio"][value="artwork"]') ||
        !group.querySelector('[role="radio"][value="hero"]')
      ) continue;
      let root = group.parentElement;
      while (root && root !== document.body && !root.classList.contains("Root__top-container")) {
        const rect = root.getBoundingClientRect();
        if (rect.width >= window.innerWidth * 0.65 && rect.height >= window.innerHeight * 0.5) {
          detected.add(root);
          root.setAttribute("data-wl-cinema-root", "true");
          if (!roots.some((existing) => existing === root || existing.contains(root))) roots.push(root);
          break;
        }
        root = root.parentElement;
      }
    }
    for (const previous of this._semanticCinemaRoots) {
      if (!detected.has(previous)) previous.removeAttribute("data-wl-cinema-root");
    }
    this._semanticCinemaRoots = detected;
    return roots;
  }

  private cinemaControlTarget(
    control: HTMLElement,
    group: HTMLElement,
  ): HTMLElement {
    // Spotify may render the semantic radio as one child of a clickable
    // wrapper (for example beside an icon/label sibling). Walk outward while
    // the wrapper still belongs to this option alone; stop before any common
    // container that also owns the artwork/other radios.
    let target = control;
    let parent = control.parentElement;
    while (parent && parent !== group) {
      const radios = parent.querySelectorAll<HTMLElement>('[role="radio"]');
      if (radios.length !== 1 || radios[0] !== control) break;
      target = parent;
      parent = parent.parentElement;
    }
    return target;
  }

  private findCinemaOverlayHost(root: HTMLElement): HTMLElement | null {
    const metadataHosts = Array.from(
      root.querySelectorAll<HTMLElement>(".wl-sc-meta-host"),
    ).filter((element) => !element.closest("[data-wl-owned]"));

    const rootRect = root.getBoundingClientRect();
    if (rootRect.width <= 0 || rootRect.height <= 0) return null;
    for (const metadata of metadataHosts) {
      const foreground = this.findCinemaForegroundLayer(root, metadata);
      if (!foreground) continue;
      let candidate = foreground.parentElement;
      while (candidate && candidate !== root) {
        const rect = candidate.getBoundingClientRect();
        const style = window.getComputedStyle(candidate);
        const positioned =
          style.position === "relative" || style.position === "absolute";
        if (
          positioned &&
          rect.width >= rootRect.width * 0.65 &&
          rect.height >= rootRect.height * 0.75 &&
          rect.height <= rootRect.height * 1.25
        ) {
          return candidate;
        }
        candidate = candidate.parentElement;
      }
    }
    return null;
  }

  private findCinemaForegroundLayer(
    boundary: HTMLElement,
    element: HTMLElement,
  ): HTMLElement | null {
    if (!boundary.contains(element)) return null;
    const boundaryRect = boundary.getBoundingClientRect();
    let candidate = element.parentElement;
    while (candidate && candidate !== boundary) {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      if (
        (style.position === "absolute" || style.position === "fixed") &&
        rect.width >= boundaryRect.width * 0.5 &&
        rect.height > 0 &&
        rect.height <= boundaryRect.height * 0.45 &&
        Math.abs(boundaryRect.bottom - rect.bottom) <= 96
      ) {
        return candidate;
      }
      candidate = candidate.parentElement;
    }
    return null;
  }

  private findCinemaControlsLayer(
    root: HTMLElement,
    group: HTMLElement,
  ): HTMLElement | null {
    const rootRect = root.getBoundingClientRect();
    let candidate = group.parentElement;
    let fallback: HTMLElement | null = null;
    while (candidate && candidate !== root) {
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      const topAligned = Math.abs(rect.top - rootRect.top) <= 32;
      const compact =
        rect.height > 0 &&
        rect.height <= Math.min(140, rootRect.height * 0.25);
      const wide = rect.width >= rootRect.width * 0.5;
      const stacking =
        style.position === "absolute" ||
        style.position === "fixed" ||
        (style.position !== "static" && style.zIndex !== "auto") ||
        style.transform !== "none" ||
        style.filter !== "none" ||
        style.isolation === "isolate";
      if (topAligned && compact && wide && stacking) fallback = candidate;
      candidate = candidate.parentElement;
    }
    return fallback;
  }

  private clearCinemaToolbarTimer(binding: CinemaArtistBinding): void {
    if (binding.toolbarHideTimer === null) return;
    window.clearTimeout(binding.toolbarHideTimer);
    binding.toolbarHideTimer = null;
  }

  private updateCinemaToolbarPresentation(
    binding: CinemaArtistBinding,
  ): void {
    this.clearCinemaToolbarTimer(binding);
    const presentation = artistToolbarPresentation({
      artistMode: this._cinemaArtistMode,
      nowMs: Date.now(),
      lastActivityAtMs: binding.toolbarLastActivityAtMs,
      keyboardFocusWithin: binding.toolbarKeyboardFocusWithin,
      reducedMotion:
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false,
    });
    binding.toolbar.style.setProperty(
      "--wl-cinema-toolbar-fade-ms",
      `${presentation.transitionMs}ms`,
    );
    binding.toolbar.classList.toggle("is-visible", presentation.visible);
    binding.overlay.classList.toggle(
      "is-controls-visible",
      this._cinemaArtistMode && presentation.visible,
    );
    (binding.toolbar as HTMLElement & { inert: boolean }).inert =
      presentation.inert;
    setAttributeIfChanged(
      binding.toolbar,
      "aria-hidden",
      String(presentation.ariaHidden),
    );
    if (presentation.hideAfterMs !== null) {
      binding.toolbarHideTimer = window.setTimeout(() => {
        binding.toolbarHideTimer = null;
        if (this._cinemaArtistSurfaces.get(binding.root) !== binding) return;
        this.updateCinemaToolbarPresentation(binding);
      }, presentation.hideAfterMs);
    }
  }

  private noteCinemaToolbarActivity(binding: CinemaArtistBinding): void {
    if (
      !this._cinemaArtistMode ||
      this._cinemaArtistSurfaces.get(binding.root) !== binding
    ) {
      return;
    }
    binding.toolbarLastActivityAtMs = Date.now();
    this.updateCinemaToolbarPresentation(binding);
  }

  private syncCinemaToolbarMode(binding: CinemaArtistBinding): void {
    if (binding.toolbarArtistModeActive === this._cinemaArtistMode) return;
    binding.toolbarArtistModeActive = this._cinemaArtistMode;
    binding.toolbarLastActivityAtMs = Date.now();
    if (!this._cinemaArtistMode) {
      binding.toolbarKeyboardModality = false;
      binding.toolbarKeyboardFocusWithin = false;
    }
    this.updateCinemaToolbarPresentation(binding);
  }

  private clearCinemaPlayerTimer(binding: CinemaArtistBinding): void {
    if (binding.playerHideTimer === null) return;
    window.clearTimeout(binding.playerHideTimer);
    binding.playerHideTimer = null;
  }

  private syncCinemaPlayerDocumentPresentation(): void {
    const hidden = Array.from(this._cinemaArtistSurfaces.values()).some(
      (candidate) =>
        candidate.playerModeActive === true &&
        document.contains(candidate.root) &&
        candidate.root.classList.contains("wl-cinema-player-idle"),
    );
    const wasHidden = document.body.classList.contains(
      "wl-cinema-player-idle",
    );
    document.body.classList.toggle("wl-cinema-player-idle", hidden);
    if (wasHidden !== hidden) {
      this.resetSourceBadgeHoverDodge(false);
    }
    this.applySourceBadgePresentation();
    if (this._cinemaArtistSurfaces.size === 0) {
      document.body.style.removeProperty("--wl-cinema-player-fade-ms");
      document.body.style.removeProperty(
        "--wl-cinema-player-grid-offset",
      );
    }
  }

  private rememberCinemaPlayerGridOffset(
    binding: CinemaArtistBinding,
    layer: HTMLElement,
  ): void {
    if (binding.root.classList.contains("wl-cinema-player-idle")) return;
    const rect = layer.getBoundingClientRect();
    if (!Number.isFinite(rect.height) || rect.height < 48) return;
    const style = window.getComputedStyle(layer);
    const marginStart = Number.parseFloat(style.marginBlockStart);
    const marginEnd = Number.parseFloat(style.marginBlockEnd);
    const owner =
      layer.closest<HTMLElement>(".Root__top-container") ??
      binding.root.closest<HTMLElement>(".Root__top-container");
    const ownerStyle = owner ? window.getComputedStyle(owner) : null;
    const parsedRowGap = Number.parseFloat(ownerStyle?.rowGap ?? "");
    const parsedPanelGap = Number.parseFloat(
      ownerStyle?.getPropertyValue("--panel-gap") ??
        window
          .getComputedStyle(document.documentElement)
          .getPropertyValue("--panel-gap"),
    );
    const rowGap = Number.isFinite(parsedRowGap)
      ? Math.max(0, parsedRowGap)
      : Number.isFinite(parsedPanelGap)
        ? Math.max(0, parsedPanelGap)
        : 0;
    const offset = cinemaPlayerGridOffset(
      rect.height,
      marginStart,
      marginEnd,
      rowGap,
    );
    if (offset === null) return;
    if (Math.abs(binding.playerGridOffsetPx - offset) < 0.5) return;
    binding.playerGridOffsetPx = offset;
    document.body.style.setProperty(
      "--wl-cinema-player-grid-offset",
      `${Math.ceil(offset)}px`,
    );
  }

  private cinemaPlayerKeyboardFocusWithin(
    binding: CinemaArtistBinding,
  ): boolean {
    const active = document.activeElement;
    return (
      binding.playerKeyboardModality &&
      active instanceof Element &&
      Boolean(binding.playerLayer?.contains(active))
    );
  }

  private findCinemaPlayerLayer(
    binding: CinemaArtistBinding,
  ): HTMLElement | null {
    const current = binding.playerLayer;
    if (
      current?.isConnected &&
      (current.matches(
        '[data-testid="now-playing-bar"], .Root__now-playing-bar',
      ) ||
        binding.root.classList.contains("wl-cinema-player-idle"))
    ) {
      return current;
    }
    const viewportWidth = Math.max(
      window.innerWidth,
      binding.root.getBoundingClientRect().width,
    );
    const viewportHeight = Math.max(
      window.innerHeight,
      binding.root.getBoundingClientRect().bottom,
    );
    const semantic = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-testid="now-playing-bar"], .Root__now-playing-bar',
      ),
    )
      .map((element) => ({
        element,
        rect: element.getBoundingClientRect(),
      }))
      .filter(
        ({ rect }) =>
          rect.width >= viewportWidth * 0.65 &&
          rect.height >= 48 &&
          rect.height <= 180 &&
          rect.bottom >= viewportHeight - 36,
      )
      .sort(
        (left, right) =>
          Math.abs(viewportHeight - left.rect.bottom) -
            Math.abs(viewportHeight - right.rect.bottom) ||
          left.rect.height - right.rect.height,
      )[0]?.element;
    if (semantic) return semantic;

    const anchor =
      (this._nativeControls &&
      document.contains(this._nativeControls)
        ? this._nativeControls
        : document.getElementById("wavelink-native-controls")) ??
      null;
    if (!anchor) return null;
    let candidate = anchor.parentElement;
    let best: HTMLElement | null = null;
    let bestHeight = Number.POSITIVE_INFINITY;
    while (candidate && candidate !== document.body) {
      const rect = candidate.getBoundingClientRect();
      if (
        rect.width >= viewportWidth * 0.65 &&
        rect.height >= 48 &&
        rect.height <= 180 &&
        rect.bottom >= viewportHeight - 36 &&
        rect.height < bestHeight
      ) {
        best = candidate;
        bestHeight = rect.height;
      }
      candidate = candidate.parentElement;
    }
    return best;
  }

  private reconcileCinemaPlayerLayer(
    binding: CinemaArtistBinding,
  ): void {
    const layer = this.findCinemaPlayerLayer(binding);
    if (binding.playerLayer !== layer) {
      binding.playerLayer?.classList.remove(
        "wl-cinema-player-layer",
        "wl-cinema-player-idle",
      );
      binding.playerLayer = layer;
    }
    if (!layer) return;
    // Spotify rewrites className on this React-owned footer. Reassert both
    // markers even when the semantic element itself did not change.
    layer.classList.add("wl-cinema-player-layer");
    layer.classList.toggle(
      "wl-cinema-player-idle",
      binding.root.classList.contains("wl-cinema-player-idle"),
    );
    this.rememberCinemaPlayerGridOffset(binding, layer);
  }

  private updateCinemaPlayerPresentation(
    binding: CinemaArtistBinding,
  ): void {
    this.clearCinemaPlayerTimer(binding);
    const wasHidden = binding.root.classList.contains(
      "wl-cinema-player-idle",
    );
    const presentation = cinemaPlayerPresentation({
      active: binding.playerModeActive === true,
      nowMs: Date.now(),
      lastActivityAtMs: binding.playerLastActivityAtMs,
      keyboardFocusWithin:
        this.cinemaPlayerKeyboardFocusWithin(binding),
      reducedMotion:
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false,
    });
    binding.root.style.setProperty(
      "--wl-cinema-player-fade-ms",
      `${presentation.transitionMs}ms`,
    );
    document.body.style.setProperty(
      "--wl-cinema-player-fade-ms",
      `${presentation.transitionMs}ms`,
    );
    if (binding.playerLayer) {
      this.rememberCinemaPlayerGridOffset(
        binding,
        binding.playerLayer,
      );
    }
    binding.root.classList.toggle(
      "wl-cinema-player-idle",
      presentation.hidden,
    );
    this.syncCinemaPlayerDocumentPresentation();
    if (binding.playerLayer) {
      binding.playerLayer.classList.add("wl-cinema-player-layer");
      binding.playerLayer.classList.toggle(
        "wl-cinema-player-idle",
        presentation.hidden,
      );
    }
    if (wasHidden !== presentation.hidden) {
      this.trackCinemaArtworkLayout(
        binding,
        presentation.transitionMs,
      );
    }
    if (presentation.hideAfterMs !== null) {
      binding.playerHideTimer = window.setTimeout(() => {
        binding.playerHideTimer = null;
        if (this._cinemaArtistSurfaces.get(binding.root) !== binding) return;
        this.updateCinemaPlayerPresentation(binding);
      }, presentation.hideAfterMs);
    }
  }

  private noteCinemaPlayerActivity(
    binding: CinemaArtistBinding,
  ): void {
    if (
      binding.playerModeActive !== true ||
      this._cinemaArtistSurfaces.get(binding.root) !== binding
    ) {
      return;
    }
    binding.playerLastActivityAtMs = Date.now();
    this.updateCinemaPlayerPresentation(binding);
  }

  private syncCinemaPlayerMode(
    binding: CinemaArtistBinding,
    active: boolean,
  ): void {
    if (binding.playerModeActive === active) return;
    binding.playerModeActive = active;
    binding.playerLastActivityAtMs = Date.now();
    if (!active) binding.playerKeyboardModality = false;
    this.updateCinemaPlayerPresentation(binding);
  }

  private cancelCinemaArtworkLayoutFrame(
    binding: CinemaArtistBinding,
  ): void {
    if (binding.artworkLayoutFrame === null) return;
    window.cancelAnimationFrame(binding.artworkLayoutFrame);
    binding.artworkLayoutFrame = null;
  }

  private trackCinemaArtworkLayout(
    binding: CinemaArtistBinding,
    transitionMs: number,
  ): void {
    this.cancelCinemaArtworkLayoutFrame(binding);
    const durationMs =
      Number.isFinite(transitionMs) && transitionMs > 0
        ? transitionMs
        : 0;
    if (durationMs === 0) {
      this.syncCinemaArtworkCoverGeometry(binding);
      return;
    }
    const deadline = performance.now() + durationMs + 34;
    const sample = (nowMs: number) => {
      binding.artworkLayoutFrame = null;
      if (
        this._cinemaArtistSurfaces.get(binding.root) !== binding ||
        binding.root.dataset.wlCinemaMode !== "artwork" ||
        binding.artworkBackground.hidden
      ) {
        return;
      }
      this.syncCinemaArtworkCoverGeometry(binding);
      if (nowMs < deadline) {
        binding.artworkLayoutFrame =
          window.requestAnimationFrame(sample);
      }
    };
    binding.artworkLayoutFrame = window.requestAnimationFrame(sample);
  }

  private cancelCinemaScrollFrame(binding: CinemaArtistBinding): void {
    if (binding.scrollFrame === null) return;
    window.cancelAnimationFrame(binding.scrollFrame);
    binding.scrollFrame = null;
  }

  private clearCinemaScrollSettleTimer(
    binding: CinemaArtistBinding,
  ): void {
    if (binding.scrollSettleTimer === null) return;
    window.clearTimeout(binding.scrollSettleTimer);
    binding.scrollSettleTimer = null;
  }

  private cinemaArtworkScrollActive(): boolean {
    return Array.from(this._cinemaArtistSurfaces.values()).some(
      (binding) =>
        binding.scrollActive &&
        binding.root.dataset.wlCinemaMode === "artwork" &&
        document.contains(binding.root),
    );
  }

  private noteCinemaArtworkScroll(binding: CinemaArtistBinding): void {
    if (this._cinemaArtistSurfaces.get(binding.root) !== binding) return;
    binding.scrollActive = true;
    binding.artworkForeground.classList.add("is-scroll-active");
    this.clearCinemaScrollSettleTimer(binding);
    this.scheduleCinemaArtworkScrollPresentation(binding);
    binding.scrollSettleTimer = window.setTimeout(() => {
      binding.scrollSettleTimer = null;
      if (this._cinemaArtistSurfaces.get(binding.root) !== binding) return;
      binding.scrollActive = false;
      binding.artworkForeground.classList.remove("is-scroll-active");
      this.syncCinemaArtworkCoverGeometry(binding);
      this.syncCinemaArtworkScrollPresentation(binding);
      window.requestAnimationFrame(() => {
        if (this._cinemaArtistSurfaces.get(binding.root) !== binding) return;
        this.applyTrackInfo();
      });
    }, CINEMA_ARTWORK_SCROLL_SETTLE_MS);
  }

  private syncCinemaArtworkScrollPresentation(
    binding: CinemaArtistBinding,
  ): void {
    const viewport = binding.scrollViewport;
    const active =
      binding.root.dataset.wlCinemaMode === "artwork" &&
      !binding.artworkForeground.hidden;
    const presentation = artworkPanelsPresentation({
      active,
      scrollTop: viewport?.scrollTop ?? 0,
      scrollHeight: viewport?.scrollHeight ?? 0,
      clientHeight: viewport?.clientHeight ?? 0,
      reducedMotion:
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ??
        false,
    });
    const progress = Math.round(presentation.progress * 1_000) / 1_000;
    const presentationKey = [
      active,
      progress,
      presentation.visible,
      presentation.inert,
      presentation.transitionMs,
    ].join("|");
    if (binding.scrollPresentationKey === presentationKey) return;
    binding.scrollPresentationKey = presentationKey;
    binding.artworkForeground.style.setProperty(
      "--wl-cinema-panels-opacity",
      String(progress),
    );
    binding.artworkForeground.style.setProperty(
      "--wl-cinema-panels-fade-ms",
      `${presentation.transitionMs}ms`,
    );
    binding.artworkForeground.classList.toggle(
      "has-scroll-progress",
      presentation.visible,
    );
    binding.artworkForeground.classList.toggle(
      "is-scroll-interactive",
      !presentation.inert,
    );
    (binding.artworkForeground as HTMLElement & { inert: boolean }).inert =
      presentation.inert;
    setAttributeIfChanged(
      binding.artworkForeground,
      "aria-hidden",
      String(presentation.ariaHidden),
    );
  }

  private scheduleCinemaArtworkScrollPresentation(
    binding: CinemaArtistBinding,
  ): void {
    if (binding.scrollFrame !== null) return;
    binding.scrollFrame = window.requestAnimationFrame(() => {
      binding.scrollFrame = null;
      if (this._cinemaArtistSurfaces.get(binding.root) !== binding) return;
      this.syncCinemaArtworkCoverGeometry(binding);
      this.syncCinemaArtworkScrollPresentation(binding);
    });
  }

  private bindCinemaScrollViewport(
    binding: CinemaArtistBinding,
    viewport: HTMLElement | null,
  ): void {
    if (binding.scrollViewport === viewport) return;
    binding.scrollAbort?.abort();
    binding.scrollAbort = null;
    this.cancelCinemaScrollFrame(binding);
    this.clearCinemaScrollSettleTimer(binding);
    binding.scrollActive = false;
    binding.scrollPresentationKey = "";
    binding.artworkForeground.classList.remove("is-scroll-active");
    binding.scrollViewport?.classList.remove(
      "wl-cinema-scroll-viewport",
    );
    binding.scrollViewport = viewport;
    if (viewport) {
      viewport.classList.add("wl-cinema-scroll-viewport");
      binding.scrollAbort = new AbortController();
      viewport.addEventListener(
        "scroll",
        () => this.noteCinemaArtworkScroll(binding),
        {
          passive: true,
          signal: binding.scrollAbort.signal,
        },
      );
    }
    this.syncCinemaArtworkCoverGeometry(binding);
    this.syncCinemaArtworkScrollPresentation(binding);
  }

  private createCinemaArtistBinding(root: HTMLElement): CinemaArtistBinding {
    const artworkBackground = document.createElement("div");
    artworkBackground.className = "wl-sc-cinema-artwork-background";
    artworkBackground.setAttribute("data-wl-owned", "true");
    artworkBackground.setAttribute("aria-hidden", "true");
    artworkBackground.hidden = true;

    const artworkBackdrop = document.createElement("img");
    artworkBackdrop.className = "wl-cinema-artwork-backdrop";
    artworkBackdrop.setAttribute("data-wl-owned", "true");
    artworkBackdrop.setAttribute("aria-hidden", "true");
    artworkBackdrop.alt = "";
    artworkBackdrop.hidden = true;
    artworkBackground.appendChild(artworkBackdrop);

    const artworkCover = document.createElement("img");
    artworkCover.className = "wl-cinema-artwork-cover";
    artworkCover.setAttribute("data-wl-owned", "true");
    artworkCover.setAttribute("aria-hidden", "true");
    artworkCover.alt = "";
    artworkCover.hidden = true;
    artworkBackground.appendChild(artworkCover);

    const artworkForeground = document.createElement("div");
    artworkForeground.className = "wl-cinema-artwork-foreground";
    artworkForeground.setAttribute("data-wl-owned", "true");
    artworkForeground.hidden = true;

    const artworkModeControl = document.createElement("div");
    artworkModeControl.className =
      "wl-cinema-artwork-background-control";
    artworkModeControl.setAttribute("data-wl-owned", "true");
    artworkModeControl.setAttribute("role", "radiogroup");
    artworkModeControl.setAttribute(
      "aria-label",
      "Artwork background",
    );
    const artworkModeButtons: HTMLButtonElement[] = [];
    const artworkModes: Array<
      [ArtworkBackgroundMode, string, string]
    > = [
      ["blurred", "Blurred artwork", "Use a blurred artwork background"],
      ["color", "Color", "Use the artwork's dominant color"],
    ];
    for (const [mode, label, description] of artworkModes) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.dataset.backgroundMode = mode;
      button.setAttribute("data-wl-owned", "true");
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", description);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._cinemaArtworkBackgroundMode = mode;
        this.persistSetting(
          STORAGE_KEYS.cinemaArtworkBackgroundMode,
          mode,
        );
        this.applyTrackInfo();
      });
      artworkModeButtons.push(button);
      artworkModeControl.appendChild(button);
    }
    artworkModeControl.addEventListener("keydown", (event) => {
      const keyboard = event as KeyboardEvent;
      if (
        ![
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
          "Home",
          "End",
        ].includes(keyboard.key)
      ) {
        return;
      }
      const target = keyboard.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const current = normalizeArtworkBackgroundMode(
        target.dataset.backgroundMode,
      );
      const next = nextArtworkBackgroundMode(current, keyboard.key);
      keyboard.preventDefault();
      keyboard.stopPropagation();
      const nextButton = artworkModeButtons.find(
        (button) => button.dataset.backgroundMode === next,
      );
      nextButton?.focus();
      nextButton?.click();
    });
    artworkForeground.appendChild(artworkModeControl);

    const overlay = document.createElement("div");
    overlay.className = "wl-sc-cinema-artist-overlay";
    overlay.setAttribute("data-wl-owned", "true");
    overlay.hidden = true;

    const backdrop = document.createElement("img");
    backdrop.className = "wl-cinema-artist-backdrop";
    backdrop.setAttribute("data-wl-owned", "true");
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.alt = "";
    backdrop.hidden = true;
    backdrop.addEventListener("error", () => {
      backdrop.dataset.failedSrc = backdrop.getAttribute("src") ?? "";
      backdrop.hidden = true;
    });

    const avatar = document.createElement("img");
    avatar.className = "wl-cinema-artist-avatar";
    avatar.setAttribute("data-wl-owned", "true");
    avatar.setAttribute("aria-hidden", "true");
    avatar.alt = "";
    avatar.hidden = true;
    avatar.addEventListener("error", () => {
      const currentSource = avatar.getAttribute("src") ?? "";
      const renditionFallback = avatar.dataset.fallbackSrc ?? "";
      const nextSource =
        renditionFallback && currentSource !== renditionFallback
          ? renditionFallback
          : currentSource !== WAVELINK_USER_AVATAR_FALLBACK
            ? WAVELINK_USER_AVATAR_FALLBACK
            : "";
      if (nextSource) {
        avatar.dataset.failedSrc = "";
        avatar.hidden = false;
        avatar.src = nextSource;
        return;
      }
      avatar.dataset.failedSrc = currentSource;
      avatar.hidden = true;
    });

    const toolbar = document.createElement("div");
    toolbar.className = "wl-cinema-artist-toolbar";
    toolbar.setAttribute("data-wl-owned", "true");
    toolbar.setAttribute("role", "group");
    toolbar.setAttribute("aria-label", "WaveLink artist image options");

    const avatarToggle = document.createElement("button");
    avatarToggle.type = "button";
    avatarToggle.className = "wl-cinema-avatar-toggle";
    avatarToggle.textContent = "Hide avatar";
    avatarToggle.setAttribute("data-wl-owned", "true");
    avatarToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._cinemaAvatarVisible = !this._cinemaAvatarVisible;
      this.persistSetting(
        STORAGE_KEYS.cinemaAvatarVisible,
        String(this._cinemaAvatarVisible),
      );
      this.applyTrackInfo();
    });

    const borderToggle = document.createElement("button");
    borderToggle.type = "button";
    borderToggle.className = "wl-cinema-avatar-border-toggle";
    borderToggle.textContent = "Border";
    borderToggle.setAttribute("data-wl-owned", "true");
    borderToggle.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this._cinemaAvatarBorderVisible = !this._cinemaAvatarBorderVisible;
      this.persistSetting(
        STORAGE_KEYS.cinemaAvatarBorderVisible,
        String(this._cinemaAvatarBorderVisible),
      );
      this.applyTrackInfo();
    });

    const positionGroup = document.createElement("div");
    positionGroup.className = "wl-cinema-avatar-position";
    positionGroup.setAttribute("data-wl-owned", "true");
    positionGroup.setAttribute("role", "radiogroup");
    positionGroup.setAttribute("aria-label", "Artist avatar position");

    const positionButtons: HTMLButtonElement[] = [];
    const positions: Array<[ArtistAvatarPosition, string, string]> = [
      ["left", "L", "Place artist avatar on the left"],
      ["center", "C", "Place artist avatar in the center"],
      ["right", "R", "Place artist avatar on the right"],
    ];
    for (const [position, text, label] of positions) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.dataset.avatarPosition = position;
      button.setAttribute("data-wl-owned", "true");
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", label);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this._cinemaAvatarPosition = position;
        this.persistSetting(STORAGE_KEYS.cinemaAvatarPosition, position);
        this.applyTrackInfo();
      });
      positionButtons.push(button);
      positionGroup.appendChild(button);
    }
    positionGroup.addEventListener("keydown", (event) => {
      const keyboard = event as KeyboardEvent;
      if (
        !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
          keyboard.key,
        )
      ) {
        return;
      }
      const target = keyboard.target;
      if (!(target instanceof HTMLButtonElement)) return;
      const current = normalizeArtistAvatarPosition(
        target.dataset.avatarPosition,
      );
      const next = nextArtistAvatarPosition(current, keyboard.key);
      keyboard.preventDefault();
      keyboard.stopPropagation();
      const nextButton = positionButtons.find(
        (button) => button.dataset.avatarPosition === next,
      );
      nextButton?.focus();
      nextButton?.click();
    });

    toolbar.append(avatarToggle, positionGroup, borderToggle);
    overlay.append(backdrop, avatar, toolbar);
    const toolbarActivityAbort = new AbortController();
    const binding: CinemaArtistBinding = {
      root,
      artworkBackground,
      artworkBackdrop,
      artworkCover,
      artworkForeground,
      artworkModeControl,
      artworkModeButtons,
      overlay,
      overlayHost: null,
      backdrop,
      avatar,
      toolbar,
      avatarToggle,
      borderToggle,
      positionButtons,
      artistModeButton: null,
      artistInteractionTarget: null,
      artistControlAbort: null,
      artistAriaChecked: null,
      artistAriaDisabled: null,
      artistDisabled: null,
      artistTabIndex: null,
      artistObserver: null,
      artworkButton: null,
      artworkAriaChecked: null,
      artworkTabIndex: null,
      artworkOverridden: false,
      nativeModeButtons: new Set(),
      controlsLayer: null,
      foregroundLayers: new Set(),
      playerLayer: null,
      scrollViewport: null,
      scrollAbort: null,
      scrollFrame: null,
      scrollSettleTimer: null,
      scrollActive: false,
      scrollPresentationKey: "",
      nativeArtworkCover: null,
      artworkCoverBaseWidth: 0,
      artworkCoverBaseHeight: 0,
      artworkLayoutFrame: null,
      toolbarActivityAbort,
      toolbarHideTimer: null,
      toolbarLastActivityAtMs: Date.now(),
      toolbarKeyboardModality: false,
      toolbarKeyboardFocusWithin: false,
      toolbarArtistModeActive: null,
      playerHideTimer: null,
      playerLastActivityAtMs: Date.now(),
      playerKeyboardModality: false,
      playerModeActive: null,
      playerGridOffsetPx: 0,
      artworkSignature: "",
      paletteSignature: "",
      signature: "",
    };
    this._cinemaArtistSurfaces.set(root, binding);
    const activityOptions = {
      signal: toolbarActivityAbort.signal,
    };
    root.addEventListener(
      "pointermove",
      () => this.noteCinemaToolbarActivity(binding),
      { ...activityOptions, passive: true },
    );
    document.addEventListener(
      "pointermove",
      () => {
        binding.playerKeyboardModality = false;
        this.noteCinemaPlayerActivity(binding);
      },
      { ...activityOptions, passive: true },
    );
    document.addEventListener(
      "pointerdown",
      () => {
        binding.playerKeyboardModality = false;
        this.noteCinemaPlayerActivity(binding);
      },
      { ...activityOptions, capture: true, passive: true },
    );
    document.addEventListener(
      "keydown",
      () => {
        binding.playerKeyboardModality = true;
        this.noteCinemaPlayerActivity(binding);
      },
      { ...activityOptions, capture: true },
    );
    document.addEventListener(
      "focusin",
      () => this.noteCinemaPlayerActivity(binding),
      { ...activityOptions, capture: true },
    );
    document.addEventListener(
      "focusout",
      () => {
        queueMicrotask(() => {
          if (this._cinemaArtistSurfaces.get(root) !== binding) return;
          this.noteCinemaPlayerActivity(binding);
        });
      },
      { ...activityOptions, capture: true },
    );
    root.addEventListener(
      "pointerdown",
      () => {
        binding.toolbarKeyboardModality = false;
        binding.toolbarKeyboardFocusWithin = false;
        this.noteCinemaToolbarActivity(binding);
        this.noteCinemaPlayerActivity(binding);
      },
      { ...activityOptions, capture: true, passive: true },
    );
    root.addEventListener(
      "keydown",
      () => {
        binding.toolbarKeyboardModality = true;
        if (toolbar.contains(document.activeElement)) {
          binding.toolbarKeyboardFocusWithin = true;
        }
        this.noteCinemaToolbarActivity(binding);
        this.noteCinemaPlayerActivity(binding);
      },
      { ...activityOptions, capture: true },
    );
    root.addEventListener(
      "focusin",
      () => this.noteCinemaPlayerActivity(binding),
      { ...activityOptions, capture: true },
    );
    root.addEventListener(
      "focusout",
      () => {
        queueMicrotask(() => {
          if (this._cinemaArtistSurfaces.get(root) !== binding) return;
          this.noteCinemaPlayerActivity(binding);
        });
      },
      { ...activityOptions, capture: true },
    );
    toolbar.addEventListener(
      "click",
      (event) => {
        if ((event as MouseEvent).detail <= 0) return;
        queueMicrotask(() => {
          if (this._cinemaArtistSurfaces.get(root) !== binding) return;
          const active = document.activeElement;
          if (active instanceof HTMLElement && toolbar.contains(active)) {
            active.blur();
          }
          binding.toolbarKeyboardModality = false;
          binding.toolbarKeyboardFocusWithin = false;
          this.noteCinemaToolbarActivity(binding);
        });
      },
      { ...activityOptions, capture: true },
    );
    toolbar.addEventListener(
      "focusin",
      (event) => {
        const target = event.target;
        const focusVisible =
          target instanceof HTMLElement && target.matches(":focus-visible");
        binding.toolbarKeyboardFocusWithin =
          binding.toolbarKeyboardModality || focusVisible;
        this.noteCinemaToolbarActivity(binding);
      },
      activityOptions,
    );
    toolbar.addEventListener(
      "focusout",
      () => {
        queueMicrotask(() => {
          if (this._cinemaArtistSurfaces.get(root) !== binding) return;
          binding.toolbarKeyboardFocusWithin =
            binding.toolbarKeyboardModality &&
            toolbar.contains(document.activeElement);
          this.noteCinemaToolbarActivity(binding);
        });
      },
      activityOptions,
    );
    return binding;
  }

  private syncCinemaArtistControlState(
    binding: CinemaArtistBinding,
  ): void {
    const button = binding.artistModeButton;
    if (!button) return;
    if (!button.classList.contains("wl-cinema-artist-toggle")) {
      button.classList.add("wl-cinema-artist-toggle");
    }
    setAttributeIfChanged(
      button,
      "data-wl-cinema-artist-control",
      "true",
    );
    if (button.hasAttribute("disabled")) button.removeAttribute("disabled");
    if (button.hasAttribute("aria-disabled")) {
      button.removeAttribute("aria-disabled");
    }
    if (button instanceof HTMLButtonElement && button.disabled) {
      button.disabled = false;
    }
    setAttributeIfChanged(
      button,
      "aria-checked",
      String(this._cinemaArtistMode),
    );
    setAttributeIfChanged(
      button,
      "tabindex",
      this._cinemaArtistMode ? "0" : "-1",
    );
  }

  private bindCinemaArtistControl(
    binding: CinemaArtistBinding,
    button: HTMLElement,
    interactionTarget: HTMLElement,
  ): void {
    binding.artistModeButton = button;
    binding.artistInteractionTarget = interactionTarget;
    binding.artistControlAbort = new AbortController();
    binding.artistAriaChecked = button.getAttribute("aria-checked");
    binding.artistAriaDisabled = button.getAttribute("aria-disabled");
    binding.artistDisabled = button.getAttribute("disabled");
    binding.artistTabIndex = button.getAttribute("tabindex");
    interactionTarget.addEventListener(
      "click",
      this._onCinemaArtistModeClick,
      {
        capture: true,
        signal: binding.artistControlAbort.signal,
      },
    );
    button.addEventListener("keydown", this._onCinemaArtistModeKeyDown, {
      capture: true,
      signal: binding.artistControlAbort.signal,
    });
    this.syncCinemaArtistControlState(binding);
    binding.artistObserver = new MutationObserver(() => {
      if (binding.artistModeButton !== button) return;
      this.syncCinemaArtistControlState(binding);
    });
    binding.artistObserver.observe(button, {
      attributes: true,
      attributeFilter: ["disabled", "aria-disabled"],
    });
  }

  private releaseCinemaArtistControl(binding: CinemaArtistBinding): void {
    const button = binding.artistModeButton;
    binding.artistControlAbort?.abort();
    binding.artistControlAbort = null;
    binding.artistInteractionTarget = null;
    if (!button) return;
    binding.artistObserver?.disconnect();
    binding.artistObserver = null;
    button.classList.remove("wl-cinema-artist-toggle");
    button.removeAttribute("data-wl-cinema-artist-control");
    restoreAttribute(button, "aria-checked", binding.artistAriaChecked);
    restoreAttribute(button, "aria-disabled", binding.artistAriaDisabled);
    restoreAttribute(button, "disabled", binding.artistDisabled);
    restoreAttribute(button, "tabindex", binding.artistTabIndex);
    binding.artistModeButton = null;
    binding.artistAriaChecked = null;
    binding.artistAriaDisabled = null;
    binding.artistDisabled = null;
    binding.artistTabIndex = null;
  }

  private releaseCinemaArtworkControl(binding: CinemaArtistBinding): void {
    const artwork = binding.artworkButton;
    if (!artwork) return;
    artwork.removeEventListener(
      "keydown",
      this._onCinemaArtworkModeKeyDown,
      true,
    );
    if (binding.artworkOverridden) {
      restoreAttribute(artwork, "aria-checked", binding.artworkAriaChecked);
      restoreAttribute(artwork, "tabindex", binding.artworkTabIndex);
    }
    artwork.classList.remove("wl-cinema-artwork-toggle");
    binding.artworkButton = null;
    binding.artworkAriaChecked = null;
    binding.artworkTabIndex = null;
    binding.artworkOverridden = false;
  }

  private reconcileCinemaNativeModeButtons(
    binding: CinemaArtistBinding,
    group: HTMLElement,
  ): void {
    const current = new Set(
      Array.from(
        group.querySelectorAll<HTMLElement>(
          '[role="radio"]:not([value="canvas"]):not([value="hero"]):not([value="lyrics"]):not([data-wl-owned])',
        ),
      ),
    );
    for (const button of binding.nativeModeButtons) {
      if (!current.has(button)) {
        button.removeEventListener("click", this._onCinemaNativeModeClick);
        button.removeEventListener(
          "keydown",
          this._onCinemaArtworkModeKeyDown,
          true,
        );
      }
    }
    for (const button of current) {
      if (!binding.nativeModeButtons.has(button)) {
        button.addEventListener("click", this._onCinemaNativeModeClick);
        button.addEventListener(
          "keydown",
          this._onCinemaArtworkModeKeyDown,
          true,
        );
      }
    }
    binding.nativeModeButtons = current;
  }

  private reconcileCinemaForegroundLayers(
    binding: CinemaArtistBinding,
  ): void {
    const current = new Set<HTMLElement>();
    for (const element of Array.from(
      binding.root.querySelectorAll<HTMLElement>(
        ".wl-sc-meta-host",
      ),
    )) {
      const boundary = binding.overlayHost;
      const layer = boundary
        ? this.findCinemaForegroundLayer(boundary, element)
        : null;
      if (layer && layer !== binding.overlay) current.add(layer);
    }
    for (const layer of binding.foregroundLayers) {
      if (!current.has(layer)) {
        layer.classList.remove("wl-cinema-foreground-layer");
      }
    }
    for (const layer of current) {
      layer.classList.add("wl-cinema-foreground-layer");
    }
    binding.foregroundLayers = current;

    const rootRect = binding.root.getBoundingClientRect();
    let infoHeight = 0;
    for (const layer of current) {
      const rect = layer.getBoundingClientRect();
      const bottomGap = Math.max(0, rootRect.bottom - rect.bottom);
      if (rect.height > 0 && bottomGap <= 96) {
        infoHeight = Math.max(infoHeight, rootRect.bottom - rect.top);
      }
    }
    if (infoHeight > 0) {
      binding.root.style.setProperty(
        "--wl-cinema-info-height",
        `${Math.ceil(infoHeight)}px`,
      );
    } else {
      binding.root.style.removeProperty("--wl-cinema-info-height");
    }
  }

  private reconcileCinemaControls(
    binding: CinemaArtistBinding,
    activeHidden: Set<HTMLElement>,
  ): void {
    const group = binding.root.querySelector<HTMLElement>(
      '[role="radiogroup"]:not(.wl-cinema-avatar-position)',
    );
    if (!group) {
      this.releaseCinemaArtistControl(binding);
      for (const button of binding.nativeModeButtons) {
        button.removeEventListener("click", this._onCinemaNativeModeClick);
        button.removeEventListener(
          "keydown",
          this._onCinemaArtworkModeKeyDown,
          true,
        );
      }
      binding.nativeModeButtons.clear();
      if (binding.artworkButton && !document.contains(binding.artworkButton)) {
        this.releaseCinemaArtworkControl(binding);
      }
      binding.controlsLayer?.classList.remove("wl-cinema-controls-layer");
      binding.controlsLayer = null;
      this.reconcileCinemaForegroundLayers(binding);
      return;
    }

    const canvas = group.querySelector<HTMLElement>(
      '[role="radio"][value="canvas"]:not([data-wl-owned])',
    );
    const lyrics = group.querySelector<HTMLElement>(
      '[role="radio"][value="lyrics"]:not([data-wl-owned])',
    );
    const nativeArtist = group.querySelector<HTMLElement>(
      '[role="radio"][value="hero"]:not([data-wl-owned])',
    );
    if (!this._cinemaModeInitialized && (nativeArtist || canvas)) {
      this._cinemaArtistMode =
        nativeArtist?.getAttribute("aria-checked") === "true";
      this._cinemaModeInitialized = true;
    }

    // Reuse Spotify's real hero radio instead of injecting a cloned child into
    // its React-owned radiogroup. Capture-phase handlers keep Spotify from
    // activating its stale native artist visual while WaveLink owns the view.
    const artistInteractionTarget = nativeArtist
      ? this.cinemaControlTarget(nativeArtist, group)
      : null;
    if (
      binding.artistModeButton !== nativeArtist ||
      binding.artistInteractionTarget !== artistInteractionTarget
    ) {
      this.releaseCinemaArtistControl(binding);
      if (nativeArtist && artistInteractionTarget) {
        this.bindCinemaArtistControl(
          binding,
          nativeArtist,
          artistInteractionTarget,
        );
      }
    } else {
      this.syncCinemaArtistControlState(binding);
    }

    for (const unsupported of [canvas, lyrics]) {
      if (unsupported) {
        this.hideNativeElement(
          this.cinemaControlTarget(unsupported, group),
          activeHidden,
        );
      }
    }

    this.reconcileCinemaNativeModeButtons(binding, group);

    const artwork = group.querySelector<HTMLElement>(
      '[role="radio"][value="artwork"]:not([data-wl-owned])',
    );
    if (binding.artworkButton !== artwork) {
      this.releaseCinemaArtworkControl(binding);
      if (artwork) {
        binding.artworkButton = artwork;
        binding.artworkAriaChecked = artwork.getAttribute("aria-checked");
        binding.artworkTabIndex = artwork.getAttribute("tabindex");
      }
    }
    if (
      binding.artworkButton &&
      !binding.artworkButton.classList.contains(
        "wl-cinema-artwork-toggle",
      )
    ) {
      binding.artworkButton.classList.add("wl-cinema-artwork-toggle");
    }

    const controlsLayer =
      this.findCinemaControlsLayer(binding.root, group) ??
      group.parentElement ??
      group;
    if (binding.controlsLayer !== controlsLayer) {
      binding.controlsLayer?.classList.remove("wl-cinema-controls-layer");
      binding.controlsLayer = controlsLayer;
    }
    controlsLayer.classList.add("wl-cinema-controls-layer");
    this.reconcileCinemaForegroundLayers(binding);
  }

  private applyCinemaArtworkPalette(
    binding: CinemaArtistBinding,
    palette: ArtworkPalette,
  ): void {
    binding.artworkBackground.style.setProperty(
      "--wl-cinema-color-raw",
      palette.raw,
    );
    binding.artworkBackground.style.setProperty(
      "--wl-cinema-color-dark",
      palette.dark,
    );
    binding.artworkBackground.style.setProperty(
      "--wl-cinema-color-light",
      palette.light,
    );
  }

  private syncCinemaArtworkPalette(
    binding: CinemaArtistBinding,
    artwork: string,
    signature: string,
  ): void {
    if (binding.paletteSignature === signature) return;
    binding.paletteSignature = signature;
    this.applyCinemaArtworkPalette(
      binding,
      FALLBACK_ARTWORK_PALETTE,
    );
    if (!artwork || artwork === WAVELINK_TRACK_FALLBACK_ARTWORK) return;

    let fetchUrl = "";
    try {
      fetchUrl = soundCloudMediaProxyUrl(artwork);
    } catch (cause) {
      warn("player", "Could not prepare artwork palette URL:", cause);
      return;
    }
    void this._artworkPaletteCache
      .load(artwork, () => loadArtworkPalette(fetchUrl))
      .then((palette) => {
        if (
          binding.paletteSignature !== signature ||
          this._cinemaArtistSurfaces.get(binding.root) !== binding
        ) {
          return;
        }
        this.applyCinemaArtworkPalette(binding, palette);
      })
      .catch((cause) => {
        if (
          binding.paletteSignature !== signature ||
          this._cinemaArtistSurfaces.get(binding.root) !== binding
        ) {
          return;
        }
        warn("player", "Could not extract artwork palette:", cause);
        this.applyCinemaArtworkPalette(
          binding,
          FALLBACK_ARTWORK_PALETTE,
        );
      });
  }

  private syncCinemaArtworkModeControl(
    binding: CinemaArtistBinding,
  ): void {
    binding.artworkBackground.dataset.backgroundMode =
      this._cinemaArtworkBackgroundMode;
    for (const button of binding.artworkModeButtons) {
      const selected =
        button.dataset.backgroundMode ===
        this._cinemaArtworkBackgroundMode;
      setAttributeIfChanged(
        button,
        "aria-checked",
        String(selected),
      );
      setAttributeIfChanged(button, "tabindex", selected ? "0" : "-1");
    }
  }

  private syncCinemaArtworkBackground(
    binding: CinemaArtistBinding,
    track: SCTrack,
    artworkMode: boolean,
  ): void {
    const preferredArtwork = fullscreenArtworkUrl(
      track,
      WAVELINK_TRACK_FALLBACK_ARTWORK,
    );
    const artwork = this._failedCinemaArtworkSources.has(preferredArtwork)
      ? WAVELINK_TRACK_FALLBACK_ARTWORK
      : preferredArtwork;
    const signature = [trackKey(track), artwork].join("\u0000");
    const enteringArtwork = artworkMode &&
      !binding.root.classList.contains("wl-sc-cinema-artwork-mode");

    binding.root.classList.toggle(
      "wl-sc-cinema-artwork-mode",
      artworkMode,
    );
    binding.artworkBackground.hidden = !artworkMode;
    this.syncCinemaArtworkForeground(binding, artworkMode);
    this.syncCinemaArtworkModeControl(binding);
    this.syncCinemaArtworkPalette(binding, artwork, signature);
    if (artworkMode) this.syncCinemaArtworkCoverGeometry(binding);
    if (enteringArtwork) this.trackCinemaArtworkLayout(binding, 500);
    if (binding.artworkSignature === signature) return;

    binding.artworkSignature = signature;
    // Never leave the preceding track's palette visible while the new cover
    // is loading or after a failed image request.
    binding.artworkBackdrop.hidden = true;
    binding.artworkBackdrop.removeAttribute("src");
    binding.artworkCover.hidden = true;
    binding.artworkCover.removeAttribute("src");
    if (!artwork) return;

    const candidate = document.createElement("img");
    candidate.className = "wl-cinema-artwork-backdrop";
    candidate.setAttribute("data-wl-owned", "true");
    candidate.setAttribute("aria-hidden", "true");
    candidate.alt = "";
    candidate.decoding = "async";
    candidate.loading = "eager";
    candidate.hidden = true;
    candidate.addEventListener(
      "load",
      () => {
        if (
          binding.artworkSignature !== signature ||
          this._cinemaArtistSurfaces.get(binding.root) !== binding
        ) {
          return;
        }
        binding.artworkBackdrop.replaceWith(candidate);
        binding.artworkBackdrop = candidate;
        candidate.hidden = false;
        binding.artworkCover.src = artwork;
        binding.artworkCover.hidden = false;
      },
      { once: true },
    );
    candidate.addEventListener(
      "error",
      () => {
        if (
          binding.artworkSignature !== signature ||
          this._cinemaArtistSurfaces.get(binding.root) !== binding
        ) {
          return;
        }
        if (artwork !== WAVELINK_TRACK_FALLBACK_ARTWORK) {
          this._failedCinemaArtworkSources.add(artwork);
          this.syncCinemaArtworkBackground(binding, track, artworkMode);
          return;
        }
        binding.artworkBackdrop.hidden = true;
        binding.artworkBackdrop.removeAttribute("src");
        binding.artworkCover.hidden = true;
        binding.artworkCover.removeAttribute("src");
      },
      { once: true },
    );
    candidate.src = artwork;
  }

  private syncCinemaArtworkForeground(
    binding: CinemaArtistBinding,
    artworkMode: boolean,
  ): void {
    binding.artworkForeground.hidden = !artworkMode;
    if (!artworkMode) {
      this.syncCinemaArtworkScrollPresentation(binding);
      return;
    }

    for (const selector of [".wl-npv-credits", ".wl-npv-queue"]) {
      const candidates = Array.from(
        binding.root.querySelectorAll<HTMLElement>(selector),
      ).filter(
        (section) =>
          section !== binding.artworkForeground &&
          !section.closest(".wl-sc-cinema-artist-overlay"),
      );
      const section = candidates
        .map((element) => ({
          element,
          rect: element.getBoundingClientRect(),
        }))
        .sort(
          (left, right) =>
            right.rect.width * right.rect.height -
            left.rect.width * left.rect.height,
        )[0]?.element;
      if (
        section &&
        section.parentElement !== binding.artworkForeground
      ) {
        binding.artworkForeground.appendChild(section);
      }
    }
    this.syncCinemaArtworkScrollPresentation(binding);
  }

  private syncCinemaArtworkCoverGeometry(
    binding: CinemaArtistBinding,
  ): void {
    if (
      binding.root.dataset.wlCinemaMode !== "artwork" ||
      binding.artworkBackground.hidden
    ) {
      return;
    }
    const surfaceRect = binding.artworkBackground.getBoundingClientRect();
    if (surfaceRect.width <= 0 || surfaceRect.height <= 0) return;
    const atScrollTop = (binding.scrollViewport?.scrollTop ?? 0) <= 1;
    const validRect = (rect: DOMRect): boolean => {
      if (rect.width < 96 || rect.height < 96) return false;
      const ratio = rect.width / rect.height;
      return (
        ratio >= 0.8 &&
        ratio <= 1.25 &&
        rect.right > surfaceRect.left &&
        rect.left < surfaceRect.right &&
        rect.bottom > surfaceRect.top &&
        rect.top < surfaceRect.bottom &&
        // Spotify can expose an entering cover below the visual viewport
        // before its fullscreen layout settles. Keep our centered fallback
        // instead of copying that transient position. Scrolling is allowed
        // to move the cover above the viewport as usual.
        (!atScrollTop || (
          rect.top >= surfaceRect.top - 2 &&
          rect.bottom <= surfaceRect.bottom + 2 &&
          rect.top + rect.height / 2 <= surfaceRect.top + surfaceRect.height * 0.68
        ))
      );
    };

    let nativeCover: {
      image: HTMLImageElement;
      rect: DOMRect;
    } | null = null;
    const cached = binding.nativeArtworkCover;
    if (
      cached?.isConnected &&
      binding.root.contains(cached) &&
      cached.matches("img:not([data-wl-owned])") &&
      !cached.closest("[data-wl-owned]")
    ) {
      const rect = cached.getBoundingClientRect();
      if (validRect(rect)) nativeCover = { image: cached, rect };
    }
    if (!nativeCover) {
      nativeCover =
        Array.from(
          binding.root.querySelectorAll<HTMLImageElement>(
            "img:not([data-wl-owned])",
          ),
        )
          .map((image) => ({
            image,
            rect: image.getBoundingClientRect(),
          }))
          .filter(({ image, rect }) =>
            !image.closest("[data-wl-owned]") && validRect(rect),
          )
          .sort(
            (left, right) =>
              right.rect.width * right.rect.height -
              left.rect.width * left.rect.height,
          )[0] ?? null;
    }

    if (!nativeCover) {
      binding.nativeArtworkCover = null;
      binding.artworkCoverBaseWidth = 0;
      binding.artworkCoverBaseHeight = 0;
      binding.artworkCover.classList.remove("is-native-aligned");
      for (const property of [
        "left",
        "top",
        "width",
        "height",
        "border-radius",
        "--wl-cinema-cover-x",
        "--wl-cinema-cover-y",
        "--wl-cinema-cover-scale-x",
        "--wl-cinema-cover-scale-y",
      ]) {
        binding.artworkCover.style.removeProperty(property);
      }
      return;
    }

    const { image, rect } = nativeCover;
    const newTarget =
      binding.nativeArtworkCover !== image ||
      binding.artworkCoverBaseWidth <= 0 ||
      binding.artworkCoverBaseHeight <= 0;
    if (newTarget) {
      binding.nativeArtworkCover = image;
      binding.artworkCoverBaseWidth = rect.width;
      binding.artworkCoverBaseHeight = rect.height;
      binding.artworkCover.style.removeProperty("left");
      binding.artworkCover.style.removeProperty("top");
      setStylePropertyIfChanged(
        binding.artworkCover,
        "width",
        `${rect.width}px`,
      );
      setStylePropertyIfChanged(
        binding.artworkCover,
        "height",
        `${rect.height}px`,
      );
      setStylePropertyIfChanged(
        binding.artworkCover,
        "border-radius",
        window.getComputedStyle(image).borderRadius,
      );
    }
    const transform = cinemaArtworkCoverTransform(
      surfaceRect,
      rect,
      binding.artworkCoverBaseWidth,
      binding.artworkCoverBaseHeight,
    );
    if (!transform) return;
    binding.artworkCover.classList.add("is-native-aligned");
    setStylePropertyIfChanged(
      binding.artworkCover,
      "--wl-cinema-cover-x",
      `${Math.round(transform.x * 100) / 100}px`,
    );
    setStylePropertyIfChanged(
      binding.artworkCover,
      "--wl-cinema-cover-y",
      `${Math.round(transform.y * 100) / 100}px`,
    );
    setStylePropertyIfChanged(
      binding.artworkCover,
      "--wl-cinema-cover-scale-x",
      String(Math.round(transform.scaleX * 100_000) / 100_000),
    );
    setStylePropertyIfChanged(
      binding.artworkCover,
      "--wl-cinema-cover-scale-y",
      String(Math.round(transform.scaleY * 100_000) / 100_000),
    );
  }

  private syncCinemaArtistBinding(
    binding: CinemaArtistBinding,
    track: SCTrack,
  ): void {
    const visuals = fullscreenArtistVisuals(
      track,
      this._activeArtistProfile,
    );
    const banner = visuals.bannerUrl;
    const avatarSources = soundCloudAvatarSources(
      visuals.avatarUrl,
      "t500x500",
    );
    const avatar =
      avatarSources?.primary ?? WAVELINK_USER_AVATAR_FALLBACK;
    const avatarFallback =
      avatarSources?.fallback ?? WAVELINK_USER_AVATAR_FALLBACK;
    const signature = [
      trackKey(track),
      banner,
      avatar,
      avatarFallback,
      this._cinemaArtistMode,
      this._cinemaAvatarVisible,
      this._cinemaAvatarBorderVisible,
      this._cinemaAvatarPosition,
    ].join("\u0000");

    binding.root.classList.toggle(
      "wl-sc-cinema-artist-mode",
      this._cinemaArtistMode,
    );
    binding.overlay.hidden = !this._cinemaArtistMode;
    binding.overlay.dataset.avatarPosition = this._cinemaAvatarPosition;
    this.syncCinemaArtistControlState(binding);
    this.syncCinemaToolbarMode(binding);
    if (binding.artworkButton) {
      if (this._cinemaArtistMode) {
        if (!binding.artworkOverridden) {
          binding.artworkAriaChecked =
            binding.artworkButton.getAttribute("aria-checked");
          binding.artworkTabIndex =
            binding.artworkButton.getAttribute("tabindex");
          binding.artworkOverridden = true;
        }
        binding.artworkButton.setAttribute("aria-checked", "false");
        binding.artworkButton.setAttribute("tabindex", "-1");
      } else if (binding.artworkOverridden) {
        restoreAttribute(
          binding.artworkButton,
          "aria-checked",
          binding.artworkAriaChecked,
        );
        restoreAttribute(
          binding.artworkButton,
          "tabindex",
          binding.artworkTabIndex,
        );
        binding.artworkOverridden = false;
      }
    }
    const artworkChecked =
      binding.artworkButton?.getAttribute("aria-checked");
    const artworkMode =
      !this._cinemaArtistMode &&
      (!binding.artworkButton ||
        artworkChecked === null ||
        artworkChecked === "true");
    binding.root.dataset.wlCinemaMode = this._cinemaArtistMode
      ? "artist"
      : artworkMode
        ? "artwork"
        : "native";
    this.syncCinemaPlayerMode(
      binding,
      this._cinemaArtistMode || artworkMode,
    );
    this.syncCinemaArtworkBackground(binding, track, artworkMode);

    if (binding.signature !== signature) {
      binding.signature = signature;
      if (banner) {
        if (binding.backdrop.getAttribute("src") !== banner) {
          binding.backdrop.dataset.failedSrc = "";
          binding.backdrop.src = banner;
        }
        binding.backdrop.hidden =
          binding.backdrop.dataset.failedSrc === banner;
      } else {
        binding.backdrop.hidden = true;
        binding.backdrop.removeAttribute("src");
        binding.backdrop.dataset.failedSrc = "";
      }

      if (avatar) {
        binding.avatar.dataset.fallbackSrc = avatarFallback;
        if (binding.avatar.getAttribute("src") !== avatar) {
          binding.avatar.dataset.failedSrc = "";
          binding.avatar.src = avatar;
        }
        binding.avatar.hidden = binding.avatar.dataset.failedSrc === avatar;
      } else {
        binding.avatar.hidden = true;
        binding.avatar.removeAttribute("src");
        binding.avatar.dataset.failedSrc = "";
      }
    }

    const avatarAvailable =
      Boolean(avatar) && !binding.avatar.dataset.failedSrc;
    const visibility = artistAvatarVisibilityPresentation(
      avatarAvailable,
      this._cinemaAvatarVisible,
    );
    const avatarShown = !visibility.hidden;
    const border = artistAvatarBorderPresentation(
      avatarAvailable,
      this._cinemaAvatarVisible,
      this._cinemaAvatarBorderVisible,
    );
    binding.overlay.classList.toggle("is-avatar-hidden", visibility.hidden);
    binding.overlay.classList.toggle(
      "is-avatar-border-hidden",
      !border.drawn,
    );
    binding.avatarToggle.disabled = visibility.disabled;
    binding.avatarToggle.textContent = visibility.label;
    binding.avatarToggle.setAttribute(
      "aria-pressed",
      String(visibility.ariaPressed),
    );
    binding.avatarToggle.setAttribute(
      "aria-label",
      visibility.ariaLabel,
    );
    binding.borderToggle.disabled = border.disabled;
    setAttributeIfChanged(
      binding.borderToggle,
      "aria-pressed",
      String(border.ariaPressed),
    );
    setAttributeIfChanged(
      binding.borderToggle,
      "aria-label",
      border.ariaLabel,
    );
    binding.borderToggle.title = border.ariaLabel;
    for (const button of binding.positionButtons) {
      const selected =
        button.dataset.avatarPosition === this._cinemaAvatarPosition;
      button.disabled = !avatarShown;
      button.setAttribute("aria-checked", String(selected));
      button.setAttribute("tabindex", selected ? "0" : "-1");
    }
  }

  private reconcileCinemaArtistSurface(
    root: HTMLElement,
    track: SCTrack,
    activeHidden: Set<HTMLElement>,
  ): void {
    const binding =
      this._cinemaArtistSurfaces.get(root) ??
      this.createCinemaArtistBinding(root);
    const detectedHost = this.findCinemaOverlayHost(root);
    const overlayHost =
      detectedHost ??
      (binding.overlayHost && root.contains(binding.overlayHost)
        ? binding.overlayHost
        : root);
    if (overlayHost !== binding.overlayHost) {
      binding.overlayHost?.classList.remove("wl-cinema-visual-host");
      binding.controlsLayer?.classList.remove("wl-cinema-controls-layer");
      binding.controlsLayer = null;
      for (const layer of binding.foregroundLayers) {
        layer.classList.remove("wl-cinema-foreground-layer");
      }
      binding.foregroundLayers.clear();
      binding.artworkBackground.remove();
      binding.artworkForeground.remove();
      binding.overlay.remove();
      binding.overlayHost = overlayHost;
    }
    if (overlayHost) {
      overlayHost.classList.add("wl-cinema-visual-host");
      if (binding.artworkBackground.parentElement !== overlayHost) {
        overlayHost.prepend(binding.artworkBackground);
      }
      if (binding.artworkForeground.parentElement !== overlayHost) {
        overlayHost.appendChild(binding.artworkForeground);
      }
      if (binding.overlay.parentElement !== overlayHost) {
        overlayHost.appendChild(binding.overlay);
      }
    } else if (!overlayHost) {
      binding.artworkBackground.remove();
      binding.artworkForeground.remove();
      binding.overlay.remove();
    }
    const scrollViewport =
      binding.overlayHost?.closest<HTMLElement>(
        "[data-overlayscrollbars-viewport]",
      ) ??
      binding.root.querySelector<HTMLElement>(
        ".main-actionBar-ActionBarContainer [data-overlayscrollbars-viewport]",
      ) ??
      binding.root.querySelector<HTMLElement>(
        "[data-overlayscrollbars-viewport]",
      );
    this.bindCinemaScrollViewport(binding, scrollViewport);
    if (
      this._cinemaArtistMode &&
      binding.scrollViewport &&
      binding.scrollViewport.scrollTop !== 0
    ) {
      binding.scrollViewport.scrollTop = 0;
      this.syncCinemaArtworkScrollPresentation(binding);
    }
    this.reconcileCinemaPlayerLayer(binding);
    this.reconcileCinemaControls(binding, activeHidden);
    this.syncCinemaArtistBinding(binding, track);
  }

  private releaseCinemaArtistSurface(binding: CinemaArtistBinding): void {
    this.clearCinemaToolbarTimer(binding);
    this.clearCinemaPlayerTimer(binding);
    this.cancelCinemaArtworkLayoutFrame(binding);
    binding.scrollAbort?.abort();
    binding.scrollAbort = null;
    this.cancelCinemaScrollFrame(binding);
    this.clearCinemaScrollSettleTimer(binding);
    binding.scrollActive = false;
    binding.scrollPresentationKey = "";
    binding.nativeArtworkCover = null;
    binding.artworkCoverBaseWidth = 0;
    binding.artworkCoverBaseHeight = 0;
    binding.artworkForeground.classList.remove("is-scroll-active");
    binding.toolbarActivityAbort.abort();
    this.releaseCinemaArtistControl(binding);
    for (const button of binding.nativeModeButtons) {
      button.removeEventListener("click", this._onCinemaNativeModeClick);
      button.removeEventListener(
        "keydown",
        this._onCinemaArtworkModeKeyDown,
        true,
      );
    }
    binding.nativeModeButtons.clear();
    this.releaseCinemaArtworkControl(binding);
    binding.controlsLayer?.classList.remove("wl-cinema-controls-layer");
    binding.playerLayer?.classList.remove(
      "wl-cinema-player-layer",
      "wl-cinema-player-idle",
    );
    binding.playerLayer = null;
    for (const layer of binding.foregroundLayers) {
      layer.classList.remove("wl-cinema-foreground-layer");
    }
    binding.foregroundLayers.clear();
    binding.scrollViewport?.classList.remove("wl-cinema-scroll-viewport");
    binding.scrollViewport = null;
    binding.overlayHost?.classList.remove("wl-cinema-visual-host");
    binding.artworkBackdrop.removeAttribute("src");
    binding.artworkCover.removeAttribute("src");
    binding.artworkBackground.removeAttribute("data-background-mode");
    for (const property of [
      "--wl-cinema-color-raw",
      "--wl-cinema-color-dark",
      "--wl-cinema-color-light",
    ]) {
      binding.artworkBackground.style.removeProperty(property);
    }
    binding.artworkBackground.remove();
    binding.artworkForeground.remove();
    binding.overlay.remove();
    binding.root.classList.remove("wl-sc-cinema-artist-mode");
    binding.root.classList.remove("wl-sc-cinema-artwork-mode");
    binding.root.classList.remove("wl-cinema-player-idle");
    binding.root.removeAttribute("data-wl-cinema-mode");
    binding.root.style.removeProperty("--wl-cinema-info-height");
    binding.root.style.removeProperty("--wl-cinema-player-fade-ms");
    this._cinemaArtistSurfaces.delete(binding.root);
    this.syncCinemaPlayerDocumentPresentation();
  }

  private releaseUnusedCinemaArtistSurfaces(
    active: Set<HTMLElement>,
  ): void {
    for (const binding of Array.from(this._cinemaArtistSurfaces.values())) {
      if (!active.has(binding.root) || !document.contains(binding.root)) {
        this.releaseCinemaArtistSurface(binding);
      }
    }
  }

  private prepareArtistProfile(track: SCTrack, loadId: number): void {
    const urn = track.user.urn || track.user.id;
    const embedded = track.user.profile_header_url ? track.user : null;
    const cached = this._artistProfileCache.get(urn);
    this._activeArtistProfile = cached === undefined ? embedded : cached ?? embedded;
    if (cached !== undefined) return;

    void this._artistProfileCache.load(urn, () => getUser(urn)).then((profile) => {
      if (
        loadId !== this._loadId ||
        !this._track ||
        (this._track.user.urn || this._track.user.id) !== urn
      ) {
        return;
      }
      this._activeArtistProfile = profile ?? embedded;
      this.applyTrackInfo();
    });
  }

  private blockNativeInteraction(
    host: HTMLElement,
    active: Set<HTMLElement>,
  ): void {
    const selector =
      'a, [href], button, [role="link"], [role="button"]';
    const elements = new Set<HTMLElement>();
    const ancestor = host.closest<HTMLElement>(selector);
    if (ancestor) elements.add(ancestor);
    for (const descendant of Array.from(
      host.querySelectorAll<HTMLElement>(selector),
    )) {
      if (!descendant.closest("[data-wl-owned]")) elements.add(descendant);
    }
    // Plain cover images and metadata hosts without nested links still need
    // capture blocking, but keeping an outer metadata host non-inert preserves
    // its pointerenter/pointerleave marquee controls when real links exist.
    if (elements.size === 0) elements.add(host);
    for (const element of elements) {
      this.blockNativeInteractionElement(element, active);
    }
  }

  private blockNativeInteractionElement(
    element: HTMLElement,
    active: Set<HTMLElement>,
  ): void {
    active.add(element);
    let binding = this._blockedNative.get(element);
    if (!binding) {
      const block = (event: Event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      const blockKey = (event: Event) => {
        const key = (event as KeyboardEvent).key;
        if (key === "Enter" || key === " ") block(event);
      };
      binding = {
        element,
        href: element.getAttribute("href"),
        tabIndex: element.getAttribute("tabindex"),
        ariaDisabled: element.getAttribute("aria-disabled"),
        inert: (element as HTMLElement & { inert: boolean }).inert,
        block,
        blockKey,
      };
      this._blockedNative.set(element, binding);
      element.addEventListener("click", block, true);
      element.addEventListener("auxclick", block, true);
      element.addEventListener("contextmenu", block, true);
      element.addEventListener("keydown", blockKey, true);
    } else if (element.hasAttribute("href")) {
      // React may reuse the same anchor for a newer native Spotify item while
      // WaveLink is active. Preserve that newer value for a clean hand-back.
      binding.href = element.getAttribute("href");
    }
    element.classList.add("wl-sc-native-blocked");
    element.removeAttribute("href");
    element.setAttribute("tabindex", "-1");
    element.setAttribute("aria-disabled", "true");
    (element as HTMLElement & { inert: boolean }).inert = true;
  }

  private restoreNativeInteraction(binding: NativeInteractionBinding): void {
    const { element } = binding;
    element.removeEventListener("click", binding.block, true);
    element.removeEventListener("auxclick", binding.block, true);
    element.removeEventListener("contextmenu", binding.block, true);
    element.removeEventListener("keydown", binding.blockKey, true);
    element.classList.remove("wl-sc-native-blocked");
    // React can reuse this node for the next Spotify track before handoff.
    // Only undo values we still own; never roll a fresh Spotify href back.
    if (!element.hasAttribute("href")) restoreAttribute(element, "href", binding.href);
    if (element.getAttribute("tabindex") === "-1") restoreAttribute(element, "tabindex", binding.tabIndex);
    if (element.getAttribute("aria-disabled") === "true") restoreAttribute(element, "aria-disabled", binding.ariaDisabled);
    (element as HTMLElement & { inert: boolean }).inert = binding.inert;
    this._blockedNative.delete(element);
  }

  private releaseUnusedNativeInteractions(active: Set<HTMLElement>): void {
    for (const binding of Array.from(this._blockedNative.values())) {
      if (!active.has(binding.element) || !document.contains(binding.element)) {
        this.restoreNativeInteraction(binding);
      }
    }
  }

  private localizedLabel(key: string, fallback: string): string {
    try {
      const locale = (Spicetify as unknown as {
        Locale?: { get?: (label: string) => string };
      }).Locale;
      return normalizeMetadataText(locale?.get?.(key)) || fallback;
    } catch {
      return fallback;
    }
  }

  private findPanelSection(
    root: HTMLElement,
    kind: "credits" | "queue",
  ): HTMLElement | null {
    const direct = qWithin<HTMLElement>(root, kind === "credits" ? [
      ".main-nowPlayingView-credits",
      ".main-nowPlayingView-creditsFirstGroup",
      ".UKqQZUM72VYTTZIF",
    ] : [
      ".main-nowPlayingView-queue",
      ".IFn9W9LzIMaRmqc6",
      ".IeLr0yURifQBomed",
    ]);
    if (direct && !direct.closest("[data-wl-owned]")) {
      return (
        direct.closest<HTMLElement>(
          "section, .main-nowPlayingView-section, .Ds4GjMFA7MZt1WIG",
        ) ?? direct
      );
    }

    const fallback = kind === "credits" ? "Credits" : "Next in queue";
    const localized = this.localizedLabel(
      kind === "credits"
        ? "web-player.now-playing-view.credits"
        : "queue.next-in-queue",
      fallback,
    ).toLocaleLowerCase();
    const headings = Array.from(
      root.querySelectorAll<HTMLElement>("h2, h3"),
    ).filter((heading) => !heading.closest("[data-wl-owned]"));
    const heading = headings.find((candidate) => {
      const text = normalizeMetadataText(candidate.textContent).toLocaleLowerCase();
      return text === localized || text === fallback.toLocaleLowerCase();
    });
    if (!heading) return null;
    return (
      heading.closest<HTMLElement>(
        "section, .main-nowPlayingView-section, .Ds4GjMFA7MZt1WIG",
      ) ?? heading.parentElement?.parentElement ?? heading.parentElement
    );
  }

  private findPanelHeader(root: HTMLElement): HTMLElement | null {
    if (root.matches(CINEMA_ROOT_SELECTOR)) {
      // The artwork layer is prepended to the cinema root. Do not rely on
      // :first-child after takeover or the native context becomes visible again.
      const controls = root.querySelector<HTMLElement>(
        '[role="radiogroup"]:has([role="radio"][value="artwork"])',
      );
      const header = controls?.parentElement?.parentElement?.querySelector<HTMLElement>(
        'a[href]:not([data-wl-owned])',
      );
      if (header) return header;
    }
    const header = qWithin<HTMLElement>(root, [
      ":scope > :first-child a[href]",
      ".main-nowPlayingView-headerText a[href]",
      ".main-nowPlayingView-headerText",
      ".XggOTyE0kaAcS9mo > a.VHm0YfXyIUK2Qf0j",
      // Cinema/fullscreen header (context title such as Liked Songs).
      ".EdQus78H1Nc_ybPp a[href]",
      ".EdQus78H1Nc_ybPp",
    ]);
    return header?.closest("[data-wl-owned]") ? null : header;
  }

  private nativePanelActionKind(
    element: HTMLElement,
    includeTestId = true,
  ): NativePanelActionKind | null {
    return classifyNativePanelAction({
      ariaLabel: element.getAttribute("aria-label"),
      title: element.getAttribute("title"),
      textContent: element.textContent,
      testId: includeTestId ? element.getAttribute("data-testid") : null,
      className: element.getAttribute("class"),
    });
  }

  private commonPanelActionContainer(
    root: HTMLElement,
    elements: HTMLElement[],
  ): HTMLElement | null {
    if (elements.length === 0) return null;
    let container = elements[0].parentElement;
    while (
      container &&
      container !== root &&
      !elements.every((element) => container!.contains(element))
    ) {
      container = container.parentElement;
    }
    if (!container || container === root) return null;
    const interactiveCount = container.querySelectorAll(
      'button, [role="button"], a[aria-label]',
    ).length;
    return interactiveCount <= 8 ? container : null;
  }

  private liftPanelActionTarget(
    element: HTMLElement,
    container: HTMLElement,
  ): HTMLElement {
    let target = element;
    while (
      target.parentElement &&
      target.parentElement !== container &&
      target.parentElement.childElementCount === 1 &&
      !target.parentElement.closest("[data-wl-owned]")
    ) {
      target = target.parentElement;
    }
    return target;
  }

  private findNativePanelActionCluster(
    root: HTMLElement,
  ): NativePanelActionCluster | null {
    const excludedSections = this.stalePanelSections(root);
    const elements = Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [role="button"], a[aria-label]',
      ),
    ).filter(
      (element) =>
        !element.closest("[data-wl-owned]") &&
        !excludedSections.some((section) => section.contains(element)),
    );
    const semantic: NativePanelAction[] = [];
    for (const element of elements) {
      // The saved Spotify state may render only a green check whose button has
      // data-testid="add-button"/"remove-button" and no useful accessible
      // label. Include test IDs while seeding the top action cluster; lower
      // credits/queue/artist sections were excluded above.
      const kind = this.nativePanelActionKind(element);
      if (kind && kind !== "spotify-more") {
        semantic.push({ element, kind });
      }
    }
    if (semantic.length === 0) return null;

    const copy = semantic.find((action) => action.kind === "copy-song");
    const hide = semantic.find((action) => action.kind === "hide-album");
    const nativeLike = semantic.find(
      (action) => action.kind === "spotify-like",
    );
    let container =
      copy && hide
        ? this.commonPanelActionContainer(root, [
            copy.element,
            hide.element,
          ])
        : null;
    container ??=
      nativeLike?.element.parentElement &&
      nativeLike.element.parentElement !== root
        ? nativeLike.element.parentElement
        : null;
    container ??=
      semantic[0].element.parentElement !== root
        ? semantic[0].element.parentElement
        : null;
    if (!container) return null;

    const actions: NativePanelAction[] = [];
    for (const element of elements) {
      if (!container.contains(element)) continue;
      const kind = this.nativePanelActionKind(element);
      if (kind && kind !== "spotify-more") {
        actions.push({ element, kind });
      }
    }
    if (actions.length === 0) return null;

    const targets = new Set<HTMLElement>();
    let likeAnchor: HTMLElement | null = null;
    for (const action of actions) {
      const target = this.liftPanelActionTarget(action.element, container);
      targets.add(target);
      if (action.kind === "spotify-like" && !likeAnchor) likeAnchor = target;
    }
    return {
      container,
      hiddenTargets: Array.from(targets),
      likeAnchor,
    };
  }

  private createPanelLikeButton(): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "wl-npv-like";
    button.setAttribute("data-wl-owned", "true");
    button.addEventListener("click", () => {
      const track = this._track;
      if (track) void this.togglePanelLike(track);
    });

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", WAVELINK_HEART_ICON.viewBox);
    svg.setAttribute("width", String(WAVELINK_HEART_ICON.width));
    svg.setAttribute("height", String(WAVELINK_HEART_ICON.height));
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute(
      "stroke-width",
      String(WAVELINK_HEART_ICON.strokeWidth),
    );
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path",
    );
    path.setAttribute("d", WAVELINK_HEART_ICON.path);
    svg.appendChild(path);
    button.appendChild(svg);
    return button;
  }

  private renderPanelLikeButton(
    button: HTMLButtonElement,
    state: LikeState,
  ): void {
    const presentation = createPanelLikePresentation(
      state.liked,
      state.busy,
    );
    button.classList.toggle("is-liked", presentation.filled);
    button.disabled = presentation.disabled;
    button.title = presentation.title;
    button.setAttribute("aria-label", presentation.ariaLabel);
    button.setAttribute("aria-pressed", presentation.ariaPressed);
    restoreAttribute(
      button,
      "aria-haspopup",
      presentation.ariaHasPopup,
    );
    restoreAttribute(button, "aria-busy", presentation.ariaBusy);
    const svg = button.querySelector("svg");
    if (svg) svg.setAttribute("fill", presentation.filled ? "currentColor" : "none");
  }

  private stalePanelSections(root: HTMLElement): HTMLElement[] {
    const sections = new Set<HTMLElement>();
    // Lyrics and the artist bio can be div cards rather than semantic sections.
    for (const section of Array.from(root.querySelectorAll<HTMLElement>(
      `[data-testid="lyrics-npv-section"], ${SEL_PANEL_ARTIST_ABOUT}`,
    ))) {
      if (!section.closest("[data-wl-owned]")) sections.add(section);
    }
    for (const heading of Array.from(
      root.querySelectorAll<HTMLElement>("h2, h3"),
    )) {
      if (heading.closest("[data-wl-owned]")) continue;
      const section =
        heading.closest<HTMLElement>(
          "section, .main-nowPlayingView-section, .Ds4GjMFA7MZt1WIG",
        ) ?? null;
      if (section && section !== root) sections.add(section);
    }
    return Array.from(sections);
  }

  private panelSectionRail(
    root: HTMLElement,
    nativeSection?: HTMLElement | null,
  ): HTMLElement {
    return (
      nativeSection?.parentElement ??
      root.querySelector<HTMLElement>(
        ".xqJdcGORWp8YNcgW, .main-nowPlayingView-mainWrapper",
      ) ??
      root
    );
  }

  private placeOwnedSection(
    root: HTMLElement,
    mount: HTMLElement,
    nativeSection: HTMLElement | null,
  ): void {
    if (nativeSection?.parentElement) {
      if (
        mount.parentElement !== nativeSection.parentElement ||
        mount.nextElementSibling !== nativeSection
      ) {
        nativeSection.parentElement.insertBefore(mount, nativeSection);
      }
      return;
    }
    const rail = this.panelSectionRail(root, nativeSection);
    if (mount.parentElement !== rail) rail.appendChild(mount);
  }

  private ensureOwnUser(): void {
    if (this._ownUserRequested) return;
    this._ownUserRequested = true;
    void getMe()
      .then((user) => {
        this._ownUserUrn = user.urn || user.id;
        if (this._track) this.applyTrackInfo();
      })
      .catch(() => {});
  }

  private likeKey(track: Pick<SCTrack, "urn" | "id">): SoundCloudUrn {
    return (
      canonicalLikedTrackId(track.urn || track.id) ||
      track.urn ||
      track.id
    );
  }

  private likeStateFor(track: SCTrack): LikeState {
    const key = this.likeKey(track);
    let state = this._likeStates.get(key);
    if (!state) {
      state = {
        liked: Boolean(track.user_favorite),
        resolved: false,
        busy: false,
        generation: 0,
      };
      this._likeStates.set(key, state);
    }
    return state;
  }

  private resolveLikeState(
    track: SCTrack,
    state: LikeState,
    force = false,
  ): void {
    const key = this.likeKey(track);
    state.resolved = true;
    const generation = ++state.generation;
    void getLikedTrackIds({ force })
      .then((ids) => {
        if (state.generation !== generation) return;
        state.liked = ids.has(key);
        track.user_favorite = state.liked;
      })
      .catch((cause) => {
        warn("player", "Could not read SoundCloud like state:", cause);
      })
      .finally(() => {
        if (state.generation === generation && this._track) {
          this.applyTrackInfo();
        }
      });
  }

  private ensureLikeState(track: SCTrack): LikeState {
    const state = this.likeStateFor(track);
    if (!state.resolved) this.resolveLikeState(track, state);
    return state;
  }

  private refreshPendingLikesAfterReturn(): void {
    if (
      this._pendingExternalLikeIds.size === 0 ||
      this._likeRefreshInFlight
    ) {
      return;
    }
    this._likeRefreshInFlight = true;
    const pending = Array.from(this._pendingExternalLikeIds);
    for (const trackId of pending) {
      const state = this._likeStates.get(trackId);
      if (state) state.generation += 1;
    }
    void getLikedTrackIds({ force: true })
      .then((ids) => {
        for (const trackId of pending) {
          publishLikedTrackStatus(trackId, ids.has(trackId));
          this._pendingExternalLikeIds.delete(trackId);
        }
      })
      .catch((cause) => {
        warn(
          "player",
          "Could not refresh SoundCloud likes after browser return:",
          cause,
        );
      })
      .finally(() => {
        this._likeRefreshInFlight = false;
        if (this._track) this.applyTrackInfo();
      });
  }

  private async togglePanelLike(track: SCTrack): Promise<void> {
    const key = this.likeKey(track);
    const state = this.ensureLikeState(track);
    if (state.busy) return;
    const wasLiked = state.liked;
    if (wasLiked) {
      state.busy = true;
      this.applyTrackInfo();
    }

    try {
      const result = await performPanelLikeAction(wasLiked, {
        showPrompt: () =>
          showSoundCloudLikePrompt(track, {
            onOpen: () => {
              state.generation += 1;
              state.resolved = true;
              this._pendingExternalLikeIds.add(key);
              invalidateLikedTrackIds();
            },
          }),
        unlike: () => unlikeTrack(key),
      });
      if (result === "unliked") {
        state.generation += 1;
        state.liked = false;
        state.resolved = true;
        track.user_favorite = false;
        publishLikedTrackStatus(key, false);
      }
    } catch (cause) {
      warn("player", "Could not remove SoundCloud like:", cause);
      try {
        Spicetify.showNotification(
          "WaveLink: SoundCloud could not remove this like.",
          true,
          5_000,
        );
      } catch {}
    } finally {
      state.busy = false;
      if (this._track) this.applyTrackInfo();
    }
  }

  private followStateFor(user: SCUser): FollowState {
    const key = user.urn || user.id;
    let state = this._followStates.get(key);
    if (!state) {
      state = {
        following: Boolean(user.followed_by_user),
        resolved: false,
        generation: 0,
      };
      this._followStates.set(key, state);
    }
    return state;
  }

  private resolveFollowState(
    user: SCUser,
    state: FollowState,
    force = false,
  ): void {
    const key = user.urn || user.id;
    state.resolved = true;
    const generation = ++state.generation;
    void isFollowingUser(key, { force })
      .then((following) => {
        if (state.generation !== generation) return;
        state.following = following;
        user.followed_by_user = following;
      })
      .catch((cause) => {
        warn("player", "Could not read SoundCloud follow state:", cause);
      })
      .finally(() => {
        if (this._track) this.applyTrackInfo();
      });
  }

  private ensureFollowState(user: SCUser): FollowState {
    const state = this.followStateFor(user);
    if (!state.resolved) {
      this.resolveFollowState(user, state);
    }
    return state;
  }

  private showPanelFollowPrompt(user: SCUser): void {
    const key = user.urn || user.id;
    const state = this.ensureFollowState(user);
    if (key === this._ownUserUrn) return;
    showSoundCloudFollowPrompt(user, state.following);
  }

  private createOwnedSection(
    className: string,
    label: string,
  ): HTMLElement {
    const section = document.createElement("section");
    section.className = `main-nowPlayingView-section wl-npv-section ${className}`;
    section.setAttribute("data-wl-owned", "true");
    section.setAttribute("aria-label", label);
    return section;
  }

  private appendSectionHeading(section: HTMLElement, title: string): void {
    const header = document.createElement("div");
    header.className = "wl-npv-section__header";
    const heading = document.createElement("h2");
    heading.textContent = title;
    header.appendChild(heading);
    section.appendChild(header);
  }

  private renderCreditsSection(
    section: HTMLElement,
    track: SCTrack,
    follow: FollowState,
  ): void {
    section.replaceChildren();
    this.appendSectionHeading(section, "Credits");
    const row = document.createElement("div");
    row.className = "wl-npv-credit-row";

    const person = document.createElement("button");
    person.type = "button";
    person.className = "wl-npv-credit-person";
    person.setAttribute(
      "aria-label",
      `Open ${track.user.username} in WaveLink`,
    );
    person.addEventListener("click", () =>
      openInWaveLink({ kind: "user", user: track.user }),
    );
    const avatar = document.createElement("img");
    avatar.className = "wl-npv-credit-avatar";
    const avatarSources = soundCloudAvatarSources(
      track.user.avatar_url,
      "t200x200",
    );
    avatar.src =
      avatarSources?.primary ?? WAVELINK_USER_AVATAR_FALLBACK;
    avatar.addEventListener("error", () => {
      const currentSource = avatar.getAttribute("src") ?? "";
      const nextSource = nextSoundCloudAvatarSource(
        currentSource,
        avatarSources,
        WAVELINK_USER_AVATAR_FALLBACK,
      );
      if (nextSource !== currentSource) {
        avatar.src = nextSource;
      } else {
        avatar.hidden = true;
      }
    });
    avatar.alt = "";
    const copy = document.createElement("span");
    copy.className = "wl-npv-credit-copy";
    const name = document.createElement("strong");
    name.textContent = track.user.username;
    const role = document.createElement("small");
    role.textContent = "Artist · SoundCloud uploader";
    copy.append(name, role);
    person.append(avatar, copy);
    row.appendChild(person);

    if ((track.user.urn || track.user.id) !== this._ownUserUrn) {
      const followButton = document.createElement("button");
      followButton.type = "button";
      followButton.className = "wl-npv-follow";
      followButton.setAttribute("aria-haspopup", "dialog");
      followButton.setAttribute(
        "aria-label",
        `${follow.following ? "Manage following" : "Follow"} ${track.user.username} on SoundCloud`,
      );
      followButton.textContent = follow.following ? "Following" : "Follow";
      followButton.addEventListener("click", () =>
        this.showPanelFollowPrompt(track.user),
      );
      row.appendChild(followButton);
    }
    section.appendChild(row);
  }

  private renderQueueSection(section: HTMLElement): void {
    section.replaceChildren();
    this.appendSectionHeading(section, "Next in queue");
    const nextIndex = nextAvailableTrackIndex(
      this.queue.map((entry) => entry.track),
      this.queueIndex,
      this._repeat,
    );
    const next = nextIndex === null ? null : this.queue[nextIndex]?.track ?? null;
    if (!next || nextIndex === null) {
      const empty = document.createElement("p");
      empty.className = "wl-npv-empty";
      empty.textContent = this._autoplayRelated
        ? "SoundCloud autoplay will choose a related track."
        : "End of queue";
      section.appendChild(empty);
      return;
    }

    const row = document.createElement("div");
    row.className = "wl-npv-next-row";
    const artButton = document.createElement("button");
    artButton.type = "button";
    artButton.className = "wl-npv-next-art-button";
    artButton.setAttribute("aria-label", `Play ${next.title}`);
    artButton.addEventListener("click", () => void this.playQueueIndex(nextIndex));
    const art = document.createElement("img");
    art.className = "wl-npv-next-art";
    art.src = (
      next.artwork_url ?? next.user.avatar_url ?? ""
    ).replace("-large", "-t200x200");
    art.alt = "";
    artButton.appendChild(art);
    const copy = document.createElement("div");
    copy.className = "wl-npv-next-copy";
    const badge = document.createElement("span");
    badge.className = "wl-npv-next-badge";
    badge.textContent = this._repeat === "one" ? "Repeating" : "Up next";
    const play = document.createElement("button");
    play.type = "button";
    play.className = "wl-npv-next-main";
    play.setAttribute("aria-label", `Play ${next.title}`);
    const title = document.createElement("strong");
    title.textContent = next.title;
    play.appendChild(title);
    play.addEventListener("click", () => void this.playQueueIndex(nextIndex));
    const artist = document.createElement("button");
    artist.type = "button";
    artist.className = "wl-npv-next-artist";
    artist.textContent = next.user.username;
    artist.setAttribute(
      "aria-label",
      `Open ${next.user.username} in WaveLink`,
    );
    artist.addEventListener("click", () =>
      openInWaveLink({ kind: "user", user: next.user }),
    );
    copy.append(badge, play, artist);
    row.append(artButton, copy);
    section.appendChild(row);
  }

  private reconcileBarSurface(
    root: HTMLElement,
    track: SCTrack,
    activeHidden: Set<HTMLElement>,
  ): void {
    // Both current widget variants end in a feedback/saved-track action group. Its
    // buttons can lack labels and test IDs, so recognize the scoped structure
    // instead of relying on translated "Add to library" labels.
    const nativeChildren = Array.from(root.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && !child.hasAttribute("data-wl-owned"),
    );
    const actions = nativeChildren[nativeChildren.length - 1];
    const isActionGroup = actions &&
      !actions.matches('[data-testid="cover-art-container"], [data-testid="CoverSlotCollapsed__container"]') &&
      !actions.querySelector('[data-testid="cover-art-button"], [data-testid="now-playing-widget-v2-byline"], .wl-sc-meta-host, a[href*="/artist/"]') &&
      !!actions.querySelector('button, [role="button"]');
    if (isActionGroup) this.hideNativeElement(actions, activeHidden);
    // Also cover themes that wrap/reorder the native action group.
    for (const action of Array.from(root.querySelectorAll<HTMLElement>(
      'button, [role="button"]',
    ))) {
      if (!action.closest("[data-wl-owned]") && this.nativePanelActionKind(action)) {
        this.hideNativeElement(action, activeHidden);
      }
    }

    this.ensureOwnUser();
    const like = this.ensureLikeState(track);
    let binding = this._barSurfaces.get(root);
    if (!binding) {
      const likeButton = this.createPanelLikeButton();
      likeButton.classList.add("wl-bar-like");
      binding = {
        root, likeButton, likeSignature: "",
        originalAriaLabel: root.getAttribute("aria-label"),
        appliedAriaLabel: "",
      };
      this._barSurfaces.set(root, binding);
    }
    if (binding.likeButton.parentElement !== root) {
      root.appendChild(binding.likeButton);
    }
    binding.appliedAriaLabel = `Now playing: ${track.title} by ${track.user.username} on SoundCloud`;
    root.setAttribute("aria-label", binding.appliedAriaLabel);
    const signature = [trackKey(track), like.liked, like.busy].join("\u0000");
    if (binding.likeSignature !== signature) {
      binding.likeSignature = signature;
      this.renderPanelLikeButton(binding.likeButton, like);
    }
  }

  private releaseBarSurface(binding: BarSurfaceBinding): void {
    binding.likeButton.remove();
    if (binding.root.getAttribute("aria-label") === binding.appliedAriaLabel) {
      restoreAttribute(binding.root, "aria-label", binding.originalAriaLabel);
    }
    this._barSurfaces.delete(binding.root);
  }

  private releaseUnusedBarSurfaces(active: Set<HTMLElement>): void {
    for (const binding of Array.from(this._barSurfaces.values())) {
      if (!active.has(binding.root) || !binding.root.isConnected) {
        this.releaseBarSurface(binding);
      }
    }
  }

  private reconcilePanelSurface(
    root: HTMLElement,
    track: SCTrack,
    activeHidden: Set<HTMLElement>,
  ): void {
    this.ensureOwnUser();
    const follow = this.ensureFollowState(track.user);
    const like = this.ensureLikeState(track);
    const context = this.currentEntry()?.context ?? DEFAULT_PLAYBACK_CONTEXT;
    const target = context.target ?? DEFAULT_PLAYBACK_CONTEXT.target!;
    let binding = this._panelSurfaces.get(root);
    if (!binding) {
      binding = {
        root,
        contextButton: null,
        likeButton: null,
        likeSignature: "",
        creditsSection: null,
        queueSection: null,
        signature: "",
        contextTarget: target,
      };
      this._panelSurfaces.set(root, binding);
      root.classList.add("wl-sc-panel-surface");
    }
    binding.contextTarget = target;

    const excludedSections = this.stalePanelSections(root);
    for (const candidate of Array.from(
      root.querySelectorAll<HTMLElement>(
        'button, [role="button"], a[aria-label]',
      ),
    )) {
      if (
        candidate.closest("[data-wl-owned]") ||
        excludedSections.some((section) => section.contains(candidate))
      ) {
        continue;
      }
      if (this.nativePanelActionKind(candidate) === "spotify-more") {
        this.hideNativeElement(candidate, activeHidden);
      }
    }

    const nativeHeader = this.findPanelHeader(root);
    if (nativeHeader) {
      this.hideNativeElement(nativeHeader, activeHidden);
      if (!binding.contextButton) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "wl-npv-context";
        button.setAttribute("data-wl-owned", "true");
        button.addEventListener("click", () =>
          openInWaveLink(binding!.contextTarget),
        );
        binding.contextButton = button;
      }
      if (
        binding.contextButton.parentElement !== nativeHeader.parentElement ||
        binding.contextButton.previousElementSibling !== nativeHeader
      ) {
        nativeHeader.insertAdjacentElement("afterend", binding.contextButton);
      }
      binding.contextButton.textContent = context.label;
      binding.contextButton.title = `Open ${context.label} in WaveLink`;
      binding.contextButton.setAttribute(
        "aria-label",
        `Open ${context.label} in WaveLink`,
      );
    }

    const nativeActions = this.findNativePanelActionCluster(root);
    if (nativeActions) {
      if (!binding.likeButton || !document.contains(binding.likeButton)) {
        binding.likeButton = this.createPanelLikeButton();
        binding.likeSignature = "";
      }
      const anchor =
        nativeActions.likeAnchor ?? nativeActions.hiddenTargets[0] ?? null;
      if (anchor?.parentElement) {
        const mount = anchor.parentElement;
        if (
          binding.likeButton.parentElement !== mount ||
          binding.likeButton.nextElementSibling !== anchor
        ) {
          mount.insertBefore(binding.likeButton, anchor);
        }
      } else if (
        !anchor &&
        binding.likeButton.parentElement !== nativeActions.container
      ) {
        nativeActions.container.appendChild(binding.likeButton);
      }
      for (const nativeAction of nativeActions.hiddenTargets) {
        this.hideNativeElement(nativeAction, activeHidden);
      }
      const likeSignature = [
        trackKey(track),
        like.liked,
        like.busy,
      ].join("\u0000");
      if (likeSignature !== binding.likeSignature) {
        binding.likeSignature = likeSignature;
        this.renderPanelLikeButton(binding.likeButton, like);
      }
    } else if (
      binding.likeButton &&
      !document.contains(binding.likeButton)
    ) {
      binding.likeButton = null;
      binding.likeSignature = "";
    }

    const nativeCredits = this.findPanelSection(root, "credits");
    if (nativeCredits) this.hideNativeElement(nativeCredits, activeHidden);
    if (!binding.creditsSection || !document.contains(binding.creditsSection)) {
      binding.creditsSection = this.createOwnedSection(
        "wl-npv-credits",
        "SoundCloud credits",
      );
      binding.signature = "";
    }
    this.placeOwnedSection(root, binding.creditsSection, nativeCredits);

    const nativeQueue = this.findPanelSection(root, "queue");
    if (nativeQueue) this.hideNativeElement(nativeQueue, activeHidden);
    if (!binding.queueSection || !document.contains(binding.queueSection)) {
      binding.queueSection = this.createOwnedSection(
        "wl-npv-queue",
        "WaveLink next in queue",
      );
      binding.signature = "";
    }
    this.placeOwnedSection(root, binding.queueSection, nativeQueue);

    // Both compact NPV and cinema mode can render extra cards (About the
    // artist, On tour, merch, etc.) from Spotify's paused native item. They
    // cannot be made truthful for a SoundCloud stream, so remove every native
    // card and leave only WaveLink's owned Credits and queue sections.
    for (const section of this.stalePanelSections(root)) {
      this.hideNativeElement(section, activeHidden);
    }

    const nextIndex = nextAvailableTrackIndex(
      this.queue.map((entry) => entry.track),
      this.queueIndex,
      this._repeat,
    );
    const nextKey =
      nextIndex === null ? "none" : trackKey(this.queue[nextIndex]?.track ?? track);
    const signature = [
      trackKey(track),
      track.user.urn || track.user.id,
      context.label,
      follow.following,
      this._ownUserUrn,
      nextIndex,
      nextKey,
      this._repeat,
      this._autoplayRelated,
    ].join("\u0000");
    if (signature !== binding.signature) {
      binding.signature = signature;
      this.renderCreditsSection(binding.creditsSection, track, follow);
      this.renderQueueSection(binding.queueSection);
    }
  }

  private releasePanelSurface(binding: PanelSurfaceBinding): void {
    binding.contextButton?.remove();
    binding.likeButton?.remove();
    binding.creditsSection?.remove();
    binding.queueSection?.remove();
    binding.root.classList.remove("wl-sc-panel-surface");
    this._panelSurfaces.delete(binding.root);
  }

  private releaseUnusedPanelSurfaces(active: Set<HTMLElement>): void {
    for (const binding of Array.from(this._panelSurfaces.values())) {
      if (!active.has(binding.root) || !document.contains(binding.root)) {
        this.releasePanelSurface(binding);
      }
    }
  }

  private collectMetadataTargets(): MetadataTarget[] {
    const targets: MetadataTarget[] = [];
    const seen = new Set<HTMLElement>();
    const push = (
      host: Element | null,
      role: MetadataRole,
      surface: MetadataSurface,
    ) => {
      if (!(host instanceof HTMLElement) || seen.has(host)) return;
      seen.add(host);
      targets.push({ host, role, surface });
    };

    const native = this.getNativeMetadata();
    for (const barWidget of this.playerBarWidgets()) {
      const metaRoot =
        barWidget.querySelector<HTMLElement>(
          ".main-nowPlayingWidget-trackInfo",
        ) ?? barWidget;
      // Keep the existing host after injecting our marquee: its textContent
      // now contains both native and WaveLink text, so exact matching alone
      // would lose the v2 title on the following timer tick.
      const title =
        metaRoot.querySelector<HTMLElement>(".wl-sc-meta-title") ??
        qWithin<HTMLElement>(metaRoot, SEL_TITLE) ??
        this.findExactMetadataHost(metaRoot, native.title);
      const artist =
        metaRoot.querySelector<HTMLElement>(".wl-sc-meta-artist") ??
        qWithin<HTMLElement>(metaRoot, SEL_ARTIST) ??
        this.findPanelArtistHost(metaRoot, native.title, native.artists);
      push(title, "title", "bar");
      push(artist, "artist", "bar");
    }

    for (const panelRoot of this.panelRoots()) {
      const native = this.getNativeMetadata();
      const metaRoot = qWithin<HTMLElement>(panelRoot, SEL_PANEL_META_ROOT);
      let title =
        panelRoot.querySelector<HTMLElement>(".wl-sc-meta-title") ??
        (metaRoot ? qWithin<HTMLElement>(metaRoot, SEL_TITLE) : null);
      let artist =
        panelRoot.querySelector<HTMLElement>(".wl-sc-meta-artist") ??
        (metaRoot ? qWithin<HTMLElement>(metaRoot, SEL_ARTIST) : null) ??
        qWithin<HTMLElement>(panelRoot, SEL_PANEL_ARTIST_FALLBACK);

      title ??= this.findExactMetadataHost(panelRoot, native.title);
      artist = this.findPanelArtistHost(
        panelRoot,
        native.title,
        native.artists,
        artist,
      );
      title ??= qWithin<HTMLElement>(panelRoot, SEL_PANEL_TITLE_FALLBACK);
      artist ??= qWithin<HTMLElement>(panelRoot, SEL_PANEL_ARTIST_FALLBACK);
      push(title, "title", "panel");
      push(artist, "artist", "panel");
    }
    return targets;
  }

  private scheduleMetadataMeasure(binding: MetadataBinding): void {
    if (binding.measureFrame !== null) return;
    binding.measureFrame = window.requestAnimationFrame(() => {
      binding.measureFrame = null;
      this.measureMetadataBinding(binding);
    });
  }

  private measureMetadataBinding(binding: MetadataBinding): void {
    if (!document.contains(binding.host)) return;
    const viewportWidth = binding.viewport.clientWidth;
    const contentWidth = binding.content.scrollWidth;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const signature = `${binding.content.textContent ?? ""}\u0000${viewportWidth}\u0000${contentWidth}\u0000${reduceMotion}`;
    if (signature === binding.signature) return;
    binding.signature = signature;
    binding.animation?.cancel();
    binding.animation = null;
    binding.content.style.removeProperty("transform");

    if (viewportWidth <= 0) {
      binding.host.removeAttribute("data-wl-overflow");
      return;
    }
    const motion = calculateMarqueeMotion(contentWidth - viewportWidth);
    if (!motion) {
      binding.host.setAttribute("data-wl-overflow", "false");
      return;
    }
    if (reduceMotion || typeof binding.content.animate !== "function") {
      binding.host.setAttribute("data-wl-overflow", "static");
      return;
    }

    binding.host.setAttribute("data-wl-overflow", "true");
    const [start, firstPause, farEdge, farPause, finish] = motion.offsets;
    binding.animation = binding.content.animate(
      [
        { transform: "translate3d(0, 0, 0)", offset: start },
        { transform: "translate3d(0, 0, 0)", offset: firstPause },
        {
          transform: `translate3d(-${motion.distancePx}px, 0, 0)`,
          offset: farEdge,
        },
        {
          transform: `translate3d(-${motion.distancePx}px, 0, 0)`,
          offset: farPause,
        },
        { transform: "translate3d(0, 0, 0)", offset: finish },
      ],
      { duration: motion.durationMs, iterations: Infinity, easing: "linear" },
    );
  }

  private releaseMetadataBinding(binding: MetadataBinding): void {
    if (binding.measureFrame !== null) {
      window.cancelAnimationFrame(binding.measureFrame);
      binding.measureFrame = null;
    }
    binding.observer?.disconnect();
    binding.animation?.cancel();
    binding.host.removeEventListener("pointerenter", binding.onPointerEnter);
    binding.host.removeEventListener("pointerleave", binding.onPointerLeave);
    binding.host.removeEventListener("focusin", binding.onFocusIn);
    binding.host.removeEventListener("focusout", binding.onFocusOut);
    binding.viewport.remove();
    binding.host.classList.remove(
      "wl-sc-meta-host",
      "wl-sc-meta-title",
      "wl-sc-meta-artist",
      "wl-sc-meta-bar",
      "wl-sc-meta-panel",
    );
    binding.host.removeAttribute("data-wl-meta");
    binding.host.removeAttribute("data-wl-overflow");
    binding.host.removeAttribute("data-sc-title");
    binding.host.removeAttribute("data-sc-artist");
    const appliedText = binding.content.textContent;
    if (binding.host.getAttribute("aria-label") === appliedText) {
      restoreAttribute(binding.host, "aria-label", binding.originalAriaLabel);
    }
    if (binding.host.getAttribute("title") === appliedText) {
      restoreAttribute(binding.host, "title", binding.originalTitle);
    }
    this._metadataBindings.delete(binding.host);
  }

  private syncMetadataTarget(
    target: MetadataTarget,
    text: string,
    activeHosts: Set<HTMLElement>,
  ): void {
    const { host, role, surface } = target;
    activeHosts.add(host);
    let binding = this._metadataBindings.get(host);
    if (binding && (binding.role !== role || binding.surface !== surface)) {
      this.releaseMetadataBinding(binding);
      binding = undefined;
    }

    if (!binding) {
      const viewport = document.createElement("span");
      viewport.className = "wl-marquee-viewport";
      viewport.setAttribute("aria-hidden", "true");
      const content = document.createElement("span");
      content.className = "wl-marquee-content";
      viewport.appendChild(content);

      let created!: MetadataBinding;
      const pause = () => created.animation?.pause();
      const resume = () => created.animation?.play();
      created = {
        host,
        role,
        surface,
        viewport,
        content,
        observer: null,
        animation: null,
        signature: "",
        measureFrame: null,
        originalAriaLabel: host.getAttribute("aria-label"),
        originalTitle: host.getAttribute("title"),
        onPointerEnter: pause,
        onPointerLeave: resume,
        onFocusIn: pause,
        onFocusOut: resume,
      };
      binding = created;
      host.classList.add(
        "wl-sc-meta-host",
        `wl-sc-meta-${role}`,
        `wl-sc-meta-${surface}`,
      );
      host.setAttribute("data-wl-meta", role);
      host.appendChild(viewport);
      host.addEventListener("pointerenter", created.onPointerEnter);
      host.addEventListener("pointerleave", created.onPointerLeave);
      host.addEventListener("focusin", created.onFocusIn);
      host.addEventListener("focusout", created.onFocusOut);
      if (typeof ResizeObserver !== "undefined") {
        created.observer = new ResizeObserver(() =>
          this.scheduleMetadataMeasure(created),
        );
        created.observer.observe(host);
        created.observer.observe(content);
      }
      this._metadataBindings.set(host, created);
    } else if (!host.contains(binding.viewport)) {
      host.appendChild(binding.viewport);
      binding.signature = "";
    }

    if (binding.content.textContent !== text) {
      binding.content.textContent = text;
      binding.signature = "";
    }
    host.setAttribute("aria-label", text);
    host.setAttribute("title", text);
    host.setAttribute(
      role === "title" ? "data-sc-title" : "data-sc-artist",
      text,
    );
    this.scheduleMetadataMeasure(binding);
  }

  private releaseUnusedMetadata(activeHosts: Set<HTMLElement>): void {
    for (const binding of Array.from(this._metadataBindings.values())) {
      if (!activeHosts.has(binding.host) || !document.contains(binding.host)) {
        this.releaseMetadataBinding(binding);
      }
    }
  }

  private ensureOwnedCover(
    root: HTMLElement,
    host: HTMLElement,
  ): HTMLImageElement {
    const existing = this._ownedCoverBindings.get(root);
    if (
      existing?.image.isConnected &&
      existing.host === host &&
      host.contains(existing.image)
    ) {
      return existing.image;
    }
    if (existing) this.releaseOwnedCover(root);

    const image = document.createElement("img");
    image.className = "wl-sc-cover-owned";
    image.setAttribute("data-wl-owned", "cover");
    image.alt = "";
    image.decoding = "async";
    image.loading = "eager";
    host.classList.add("wl-sc-cover-host");
    host.appendChild(image);
    this._ownedCoverBindings.set(root, { root, host, image });
    return image;
  }

  private releaseOwnedCover(root: HTMLElement): void {
    const binding = this._ownedCoverBindings.get(root);
    if (!binding) return;
    binding.image.removeEventListener("error", this._onCoverImageError);
    this._coverSnapshots.delete(binding.image);
    binding.image.remove();
    binding.host.classList.remove("wl-sc-cover-host");
    this._ownedCoverBindings.delete(root);
  }

  private releaseUnusedOwnedCovers(activeRoots: Set<HTMLElement>): void {
    for (const [root, binding] of Array.from(this._ownedCoverBindings)) {
      if (
        !activeRoots.has(root) ||
        !root.isConnected ||
        !binding.host.isConnected
      ) {
        this.releaseOwnedCover(root);
      }
    }
  }

  private findPanelVideoCoverHost(root: HTMLElement): HTMLElement | null {
    const rootRect = root.getBoundingClientRect();
    if (rootRect.width <= 0) return null;
    const video = Array.from(root.querySelectorAll<HTMLVideoElement>("video"))
      .find((candidate) => {
        if (candidate.closest("[data-wl-owned]")) return false;
        const rect = candidate.getBoundingClientRect();
        return rect.width >= Math.max(96, rootRect.width * 0.6) &&
          rect.height >= 96 && rect.top <= rootRect.top + 160;
      });
    if (!video) return null;

    // Canvas expands its absolutely-positioned 9:16 video outside a normal
    // square artwork slot. Mount into that slot, not the overflowing video
    // wrapper, so SoundCloud artwork keeps its usual size and position.
    let parent = video.parentElement;
    while (parent && parent !== root) {
      const rect = parent.getBoundingClientRect();
      if (rect.width >= 96 && rect.height >= 96 &&
        rect.width <= rootRect.width + 2 &&
        rect.width / rect.height >= 0.8 && rect.width / rect.height <= 1.25) {
        return parent;
      }
      parent = parent.parentElement;
    }
    return video.parentElement;
  }

  private collectCoverTargets(preferOwnedCover = false): HTMLImageElement[] {
    const covers = new Set<HTMLImageElement>();
    const activeOwnedRoots = new Set<HTMLElement>();
    const useTarget = (
      root: HTMLElement,
      cover: HTMLImageElement | null,
      host: HTMLElement | null,
      keepNativeImage = false,
    ): void => {
      // A local fallback must never replace Spotify's React-owned image. When
      // the same paused Spotify item is replayed, React keeps the old props and
      // may not repair an image/srcset that WaveLink changed in the DOM. Keep
      // that native cover untouched underneath a disposable WaveLink overlay.
      if ((preferOwnedCover || keepNativeImage) && host) {
        activeOwnedRoots.add(root);
        covers.add(this.ensureOwnedCover(root, host));
        return;
      }
      if (cover) {
        this.releaseOwnedCover(root);
        covers.add(cover);
        return;
      }
      if (!host) return;
      activeOwnedRoots.add(root);
      covers.add(this.ensureOwnedCover(root, host));
    };

    for (const barWidget of this.playerBarWidgets()) {
      const cover = qWithin<HTMLImageElement>(barWidget, [
        '[data-testid="cover-art-container"] img:not([data-wl-owned])',
        '[data-testid="CoverSlotCollapsed__container"] img:not([data-wl-owned])',
        '[data-testid="cover-art-button"] img:not([data-wl-owned])',
        ".main-nowPlayingWidget-coverArt img.cover-art-image",
        ".main-coverSlotCollapsed-container img:not([data-wl-owned])",
        '[data-testid="cover-art-image"]',
        "img.cover-art-image",
      ]);
      const iconHost = barWidget.querySelector<HTMLElement>(".cover-art-icon")
        ?.parentElement;
      const host = qWithin<HTMLElement>(barWidget, [
        '[data-testid="cover-art-button"]',
        '[data-testid="cover-art-container"]',
        '[data-testid="CoverSlotCollapsed__container"]',
        ".main-nowPlayingWidget-coverArt",
        ".main-coverSlotCollapsed-container",
      ]) ?? iconHost ?? cover?.parentElement ?? null;
      // Spotify's current Image component remembers load errors in React
      // state. Changing its src can leave a permanent note after handoff, even
      // after restoring the original attributes. Keep that image untouched.
      useTarget(barWidget, cover, host, !!barWidget.querySelector(
        '[data-testid="cover-art-button"]',
      ));
    }

    for (const panelRoot of this.panelRoots()) {
      const cinema = panelRoot.matches(CINEMA_ROOT_SELECTOR);
      // Fullscreen already owns a sharp cover above its background. Do not
      // inject a second image into Spotify's animated cover container: its
      // layout must remain untouched and is only a geometry reference.
      if (cinema) continue;
      let cover = qWithin<HTMLImageElement>(panelRoot, [
        '[data-testid="cover-art-slot"] img:not([data-wl-owned])',
        '[data-testid="track-visual-enhancement"] img:not([data-wl-owned])',
        ".main-nowPlayingView-coverArtVisualEnhancement img.cover-art-image",
        ".main-nowPlayingView-coverArt img.cover-art-image",
        ".main-nowPlayingView-coverArt img:not([data-wl-owned])",
        ".main-nowPlayingView-coverArtContainer img:not([data-wl-owned])",
        "img.pDBB5ICQaA0_FhTA",
      ]);
      const iconHost = panelRoot.querySelector<HTMLElement>(".cover-art-icon")
        ?.parentElement;
      const structuralHost = qWithin<HTMLElement>(panelRoot, [
        '[data-testid="cover-art-slot"]',
        '[data-testid="track-visual-enhancement"]',
        ".main-nowPlayingView-coverArtVisualEnhancement",
        ".main-nowPlayingView-coverArt",
        ".main-nowPlayingView-coverArtContainer",
      ]) ?? iconHost ?? null;
      const videoHost = !structuralHost
        ? this.findPanelVideoCoverHost(panelRoot)
        : null;
      if (videoHost) {
        useTarget(panelRoot, null, videoHost, true);
        continue;
      }

      // Spotify's missing-art placeholder has no <img>. Prefer its semantic
      // cover host over every other image in the NPV, then mount a WaveLink
      // image there. A root-wide image search can otherwise select a hidden
      // Credits/About image and leave the visible note placeholder unchanged
      // until Spotify happens to remount the panel after cinema mode.
      if (!cover && structuralHost) {
        useTarget(panelRoot, null, structuralHost);
        continue;
      }
      const host = structuralHost ?? cover?.parentElement ?? null;
      useTarget(panelRoot, cover, host, !!panelRoot.querySelector(
        '[data-testid="cover-art-slot"]',
      ));
    }
    this.releaseUnusedOwnedCovers(activeOwnedRoots);
    return Array.from(covers);
  }

  private imageState(image: HTMLImageElement): ImageAttributeState {
    return {
      src: image.getAttribute("src"),
      srcset: image.getAttribute("srcset"),
      sizes: image.getAttribute("sizes"),
      alt: image.getAttribute("alt"),
    };
  }

  private restoreCover(
    image: HTMLImageElement,
    snapshot: ImageOverlaySnapshot,
  ): void {
    image.removeEventListener("error", this._onCoverImageError);
    const release = releaseImageOverlay(snapshot, this.imageState(image));
    restoreAttribute(image, "src", release.state.src);
    restoreAttribute(image, "srcset", release.state.srcset);
    restoreAttribute(image, "sizes", release.state.sizes);
    restoreAttribute(image, "alt", release.state.alt);
    image.classList.remove("wl-sc-cover", "wl-sc-cover-panel");
    this._coverSnapshots.delete(image);
  }

  private applyTrackInfo(): void {
    const track = this._track;
    // Profile/like requests can finish after media loading failed and released
    // Spotify. Never reinsert overlays while their sc-active styles are off.
    if (!track || !document.body.classList.contains("sc-active")) return;
    try {
      const activeHidden = new Set<HTMLElement>();
      const barRoots = new Set(this.playerBarWidgets());
      for (const root of barRoots) {
        this.reconcileBarSurface(root, track, activeHidden);
      }
      this.releaseUnusedBarSurfaces(barRoots);

      const panelRoots = new Set(this.panelRoots());
      for (const root of panelRoots) {
        this.reconcilePanelSurface(root, track, activeHidden);
      }
      this.releaseUnusedPanelSurfaces(panelRoots);

      const cinemaRoots = new Set(this.cinemaRoots());
      for (const root of cinemaRoots) {
        this.reconcileCinemaArtistSurface(root, track, activeHidden);
      }
      this.releaseUnusedCinemaArtistSurfaces(cinemaRoots);
      this.releaseUnusedHiddenNative(activeHidden);

      const activeHosts = new Set<HTMLElement>();
      const activeInteractions = new Set<HTMLElement>();
      for (const target of this.collectMetadataTargets()) {
        this.syncMetadataTarget(
          target,
          target.role === "title" ? track.title : track.user.username,
          activeHosts,
        );
        // Neither the compact panel nor the bottom bar may retain a native
        // Spotify href for metadata that WaveLink has visually replaced.
        this.blockNativeInteraction(target.host, activeInteractions);
      }
      this.releaseUnusedMetadata(activeHosts);

      const preferredArt = soundCloudTrackArtworkUrl(
        track.artwork_url,
        "t500x500",
      );
      const art = this._failedCoverSources.has(preferredArt)
        ? WAVELINK_TRACK_FALLBACK_ARTWORK
        : preferredArt;
      const artSrcset =
        art === WAVELINK_TRACK_FALLBACK_ARTWORK ? null : art;
      const activeCovers = new Set<HTMLImageElement>();
      for (const image of this.collectCoverTargets(
        art === WAVELINK_TRACK_FALLBACK_ARTWORK,
      )) {
        activeCovers.add(image);
        const current = this.imageState(image);
        const applied: ImageAttributeState = {
          ...current,
          src: art,
          srcset: artSrcset,
          alt: `${track.title} — ${track.user.username}`,
        };
        this._coverSnapshots.set(
          image,
          updateImageOverlaySnapshot(
            this._coverSnapshots.get(image),
            current,
            applied,
          ),
        );
        image.classList.add("wl-sc-cover");
        if (Array.from(panelRoots).some((root) => root.contains(image))) {
          image.classList.add("wl-sc-cover-panel");
          this.blockNativeInteraction(
            image.closest<HTMLElement>(".wl-sc-cover-host") ?? image,
            activeInteractions,
          );
        }
        image.removeEventListener("error", this._onCoverImageError);
        image.addEventListener("error", this._onCoverImageError);
        image.setAttribute("src", art);
        restoreAttribute(image, "srcset", artSrcset);
        image.setAttribute("alt", `${track.title} — ${track.user.username}`);
      }
      for (const [image, snapshot] of Array.from(this._coverSnapshots)) {
        if (!activeCovers.has(image) || !document.contains(image)) {
          this.restoreCover(image, snapshot);
        }
      }
      this.releaseUnusedNativeInteractions(activeInteractions);
    } catch {}
  }

  // ── Media attachment ──────────────────────────────────────────────────────

  private resetMediaSource(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (this.softwareAac) {
      const softwareAac = this.softwareAac;
      softwareAac.destroy();
      this.softwareAac = null;
    }
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
  }

  private ensureSoftwareAacContext(): AudioContext {
    if (
      this.softwareAacContext &&
      this.softwareAacContext.state !== "closed"
    ) {
      return this.softwareAacContext;
    }
    const AudioContextConstructor =
      window.AudioContext ??
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
    if (!AudioContextConstructor) {
      throw new Error("This Spotify build has no Web Audio output.");
    }
    this.softwareAacContext = new AudioContextConstructor({
      latencyHint: "playback",
    });
    return this.softwareAacContext;
  }

  private readonly _onSoftwareAacUnlockIntent = (event: Event): void => {
    if (!event.isTrusted) return;
    if (
      event instanceof KeyboardEvent &&
      event.key !== "Enter" &&
      event.key !== " "
    ) {
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".wl-app")) return;
    this.primeSoftwareAacOutput(true);
  };

  private primeSoftwareAacOutput(fromTrustedInput = false): void {
    // Creating/resuming during the synchronous part of a track click preserves
    // Chrome's autoplay grant. Automatic queue advances then reuse this one
    // context instead of requiring a new user gesture for every track.
    if (
      !fromTrustedInput &&
      navigator.userActivation &&
      !navigator.userActivation.isActive
    ) {
      return;
    }
    try {
      const context = this.ensureSoftwareAacContext();
      if (context.state !== "running") {
        void context.resume().catch(() => undefined);
      }
    } catch (cause) {
      warn("player", "Could not prime the bundled AAC audio output:", cause);
    }
  }

  private restoreSpotifyVolumeProfile(): void {
    if (this._savedSpotifyVolume === null) return;
    const saved = this._savedSpotifyVolume;
    this._savedSpotifyVolume = null;
    try {
      // Volume restoration is a playback-handoff invariant: Spotify must get
      // its original level back whenever WaveLink releases the player bar.
      Spicetify.Player.setVolume(saved);
      this._lastCheckedVolume = saved;
    } catch (cause) {
      logError("player", "Could not restore Spotify volume:", cause);
    }
  }

  private releaseSpotifyControl(): void {
    this.linuxMediaSession.release();
    this.stopTimer();
    this.muteSpotifyAudio(false);
    document.body.classList.remove("sc-active", "sc-playing");
    this.restoreSpotifyVolumeProfile();
    this.restoreNativeBar();
  }

  private restoreNativeBar(): void {
    for (const binding of Array.from(this._metadataBindings.values())) {
      this.releaseMetadataBinding(binding);
    }
    for (const [image, snapshot] of Array.from(this._coverSnapshots)) {
      this.restoreCover(image, snapshot);
    }
    for (const root of Array.from(this._ownedCoverBindings.keys())) {
      this.releaseOwnedCover(root);
    }
    for (const binding of Array.from(this._barSurfaces.values())) {
      this.releaseBarSurface(binding);
    }
    for (const binding of Array.from(this._panelSurfaces.values())) {
      this.releasePanelSurface(binding);
    }
    for (const binding of Array.from(this._cinemaArtistSurfaces.values())) {
      this.releaseCinemaArtistSurface(binding);
    }
    for (const [element, snapshot] of Array.from(this._hiddenNative)) {
      this.restoreHiddenNative(element, snapshot);
    }
    for (const binding of Array.from(this._blockedNative.values())) {
      this.restoreNativeInteraction(binding);
    }
    this._progressOverlay?.remove();
    this._progressOverlay = null;
    this._progressFill = null;
    this._progressThumb = null;
    this.closeNativeQueue();
  }

  private failPlayback(message: string): void {
    this.resetMediaSource();
    this._isLoading = false;
    this._error = message;
    this._notice = null;
    this.releaseSpotifyControl();
    try {
      Spicetify.showNotification(`WaveLink: ${message}`, true, 6_000);
    } catch {}
    this.emit();
  }

  private async handleSoftwareAacFailure(
    track: SCTrack,
    loadId: number,
    playback: SoftwareAacPlayback,
    cause: Error,
    requestPlay = false,
  ): Promise<void> {
    if (loadId !== this._loadId || this.softwareAac !== playback) return;
    const key = trackKey(track);
    if (!(cause instanceof SoftwareAacDecodeError) || this._softwareAacFallbackTracks.has(key)) {
      this._resumePendingSeek = null;
      this._playRequestedWhileLoading = false;
      this.failPlayback(`AAC decoder: ${cause.message}`);
      return;
    }

    // Replace only the media source, not the queue entry or its history load
    // ID. The normal readiness handlers seek before playing the new rendition.
    this._resumePendingSeek = {
      loadId,
      trackKey: key,
      positionMs: this.playbackResumePositionMs(),
      streamRecovery: true,
    };
    this._playRequestedWhileLoading = requestPlay || this._playRequestedWhileLoading || !playback.paused;
    this._softwareAacFallbackTracks.set(key, playback.rendition);
    this._softwareAacRecoveryLoadId = loadId;
    this._isLoading = true;
    warn("player", "Switching '%s' to alternate AAC after a decoder failure", track.title);

    try {
      // Immediately stop the broken rendition and invalidate its callbacks.
      this.resetMediaSource();
      if (loadId !== this._loadId) return;
      this.emit();
      if (loadId !== this._loadId) return;
      if (!await this.attachMedia(track, loadId, playback.rendition) || loadId !== this._loadId) return;
      this.applyPendingPlaybackResumeSeek();
    } catch (error) {
      if (loadId !== this._loadId) return;
      this._resumePendingSeek = null;
      this._playRequestedWhileLoading = false;
      const detail = error instanceof Error ? error.message : cause.message;
      this.failPlayback(`AAC decoder: ${detail}`);
    } finally {
      if (this._softwareAacRecoveryLoadId === loadId) {
        this._softwareAacRecoveryLoadId = null;
      }
      if (loadId === this._loadId) {
        this._isLoading = false;
        this.emit();
      }
    }
  }

  private async attachMedia(
    track: SCTrack,
    loadId: number,
    excludeAacRendition = this._softwareAacFallbackTracks.get(trackKey(track)),
  ): Promise<boolean> {
    const nativeAacMseSupported =
      typeof MediaSource !== "undefined" &&
      typeof MediaSource.isTypeSupported === "function" &&
      MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"');
    const source = await createMediaSession(track, { excludeAacRendition });
    if (loadId !== this._loadId) return false;
    this.resetMediaSource();

    if (source.kind === "progressive") {
      // A plain media element may consume SoundCloud's signed CDN URL without
      // a CORS-readable response. Setting crossorigin here would turn that
      // into a stricter CORS fetch and can make otherwise playable MP3s fail.
      this.audio.removeAttribute("crossorigin");
      this.audio.src = source.url;
      this.audio.load();
      return true;
    }

    if (source.codec === "aac" && !nativeAacMseSupported) {
      let softwareAac: SoftwareAacPlayback;
      try {
        softwareAac = await SoftwareAacPlayback.create({
          mediaElement: this.audio,
          audioContext: this.ensureSoftwareAacContext(),
          sourceUrl: source.url,
          rendition: source.aacRendition,
          durationHint: track.duration / 1_000,
          onFatalError: (cause) => {
            void this.handleSoftwareAacFailure(track, loadId, softwareAac, cause);
          },
        });
      } catch (cause) {
        if (loadId !== this._loadId) return false;
        if (excludeAacRendition === undefined && cause instanceof SoftwareAacDecodeError) {
          // Retry only a distinct rendition if the selected one fails to decode.
          this._softwareAacFallbackTracks.set(trackKey(track), source.aacRendition);
          warn("player", "Retrying '%s' with alternate AAC after a decoder failure", track.title);
          return this.attachMedia(track, loadId, source.aacRendition);
        }
        throw cause;
      }
      if (loadId !== this._loadId) {
        softwareAac.destroy();
        return false;
      }
      this.softwareAac = softwareAac;
      softwareAac.notifyReady();
      return true;
    }

    if (Hls.isSupported()) {
      this.audio.crossOrigin = "anonymous";
      return new Promise<boolean>((resolve, reject) => {
        let settled = false;
        let networkRecoveries = 0;
        let mediaRecoveries = 0;
        const hls = new Hls({
          // Spotify's CSP can block blob workers in some releases. Playback is
          // audio-only, so the small main-thread cost is preferable to a hard
          // worker startup failure.
          enableWorker: false,
          // hls.js 1.6 prefers the newer ManagedMediaSource API when a host
          // exposes it. Spotify's embedded Chromium is more reliable with the
          // regular MediaSource implementation used by Hls.isSupported().
          preferManagedMediaSource: false,
          backBufferLength: 90,
          maxBufferLength: 45,
          manifestLoadingTimeOut: 15_000,
          levelLoadingTimeOut: 15_000,
          fragLoadingTimeOut: 20_000,
          // Keep loadSource() on the raw CDN URL so hls.js resolves relative
          // manifest entries correctly, but route every resulting XHR
          // (master/variant manifests, keys, init segments and fragments)
          // through Spicetify's CORS relay. The helper strictly allowlists
          // SoundCloud media hosts before embedding the target URL.
          xhrSetup: (xhr, url) => {
            configureSoundCloudMediaXhr(xhr, url);
          },
        });
        this.hls = hls;
        const timeout = window.setTimeout(() => {
          if (settled) return;
          settled = true;
          hls.destroy();
          if (this.hls === hls) this.hls = null;
          reject(new Error("Timed out while preparing the HLS audio buffer."));
        }, 30_000);

        // resetMediaSource() destroys the previous HLS instance whenever the
        // user switches or stops a track. Settle that superseded attachment
        // immediately instead of leaving its Promise alive until the timeout.
        hls.on(Hls.Events.DESTROYING, () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          if (this.hls === hls) this.hls = null;
          resolve(false);
        });
        hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(source.url));
        // A parsed manifest only proves that the playlist is readable. Wait
        // until hls.js has successfully created the SourceBuffer so a later
        // bufferAddCodecError cannot turn an already-resolved setup into an
        // immediate playback failure.
        hls.on(Hls.Events.BUFFER_CREATED, () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timeout);
          if (loadId !== this._loadId || this.hls !== hls) {
            hls.destroy();
            if (this.hls === hls) this.hls = null;
            resolve(false);
            return;
          }
          resolve(true);
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (loadId !== this._loadId || this.hls !== hls) {
            if (!settled) {
              settled = true;
              window.clearTimeout(timeout);
              resolve(false);
            }
            hls.destroy();
            return;
          }
          // hls.js initially emits bufferAddCodecError as non-fatal and may
          // promote it later when no alternate level exists. Handle it before
          // the fatal guard and never call recoverMediaError(): re-attaching
          // cannot make an unsupported SourceBuffer MIME type usable.
          if (isHlsSourceBufferCodecError(data.details)) {
            const mimeType =
              "mimeType" in data && typeof data.mimeType === "string"
                ? ` (${data.mimeType})`
                : "";
            const message = `Unsupported HLS audio buffer${mimeType}: ${data.details}`;
            if (!settled) {
              settled = true;
              window.clearTimeout(timeout);
              hls.destroy();
              if (this.hls === hls) this.hls = null;
              reject(new Error(message));
              return;
            }
            this.failPlayback(message);
            return;
          }
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRecoveries < 1) {
            networkRecoveries += 1;
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 1) {
            mediaRecoveries += 1;
            hls.recoverMediaError();
            return;
          }
          if (!settled) {
            settled = true;
            window.clearTimeout(timeout);
            hls.destroy();
            if (this.hls === hls) this.hls = null;
            reject(new Error(`HLS ${data.type}: ${data.details}`));
            return;
          }
          this.failPlayback(`Stream interrupted: ${data.details}`);
        });
        hls.attachMedia(this.audio);
      });
    }

    if (this.audio.canPlayType("application/vnd.apple.mpegurl")) {
      if (loadId !== this._loadId) return false;
      this.audio.src = source.url;
      this.audio.load();
      return true;
    }

    throw new Error("This Spotify build cannot play HLS audio.");
  }

  // ── Timer ─────────────────────────────────────────────────────────────────

  private startTimer(): void {
    if (this.progressTimer !== null) return;
    this.progressTimer = setInterval(() => {
      const currentUri = this.spotifyItemUri();
      if (
        classifySpotifyHandoff(
          this._spotifyBaselineUri,
          currentUri,
          this.spotifyPlaying(),
        ) === "yield-now" &&
        currentUri &&
        this.handoffToSpotify(currentUri, true)
      ) {
        return;
      }
      this._tryHookProgressBar?.(); // re-hook if Spotify re-rendered the element
      this._tryHookSkipButtons?.(); // re-hook transport buttons too
      this._tryHookVolumeInput?.(); // re-hook volume slider if re-rendered
      this._tryEnsureNativeControls?.(); // re-inject WaveLink controls if needed
      // Deep fullscreen reconciliation performs several geometry reads.
      // Keep it out of kinetic artwork scrolling, then run one settled
      // reassert from noteCinemaArtworkScroll().
      if (!this.cinemaArtworkScrollActive()) {
        this.applyTrackInfo(); // re-assert title/artist/cover across re-renders
      }
      this.syncSpotifyProgress();
      this.forceSpotifyPaused(); // keep Spotify silent AND paused
      this.checkVolumeChanges();
      this.emit();
    }, 250);
  }

  private stopTimer(): void {
    if (this.progressTimer === null) return;
    clearInterval(this.progressTimer);
    this.progressTimer = null;
  }

  private emit(): void {
    const s = this.getState();
    this.listeners.forEach((cb) => cb(s));
    this.updateGlobalControls();
    if (this._tryEnsureNativeControls) this.updateNativeControls();
    this.persistPlaybackResume();
  }

  private ensureGlobalControls(): HTMLElement {
    if (this._globalControls && document.contains(this._globalControls)) {
      return this._globalControls;
    }
    if (!document.getElementById("wavelink-global-player-styles")) {
      const style = document.createElement("style");
      style.id = "wavelink-global-player-styles";
      style.textContent = `
        #wavelink-global-player{position:fixed;right:16px;bottom:104px;z-index:10000;width:min(520px,calc(100vw - 32px));display:grid;grid-template-columns:48px minmax(110px,1fr) auto;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(20,20,24,.96);box-shadow:0 12px 36px rgba(0,0,0,.5);color:#fff;font:12px/1.3 system-ui,sans-serif;backdrop-filter:blur(14px)}
        #wavelink-global-player[hidden]{display:none!important}
        #wavelink-global-player .wl-global-art{width:48px;height:48px;border-radius:7px;object-fit:cover;background:linear-gradient(135deg,#ff7a18,#ff3d81)}
        #wavelink-global-player .wl-global-meta{min-width:0;display:grid;gap:3px}
        #wavelink-global-player .wl-global-title,#wavelink-global-player .wl-global-artist{color:inherit;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        #wavelink-global-player .wl-global-title{font-weight:700}
        #wavelink-global-player .wl-global-artist{color:#b3b3b3}
        #wavelink-global-player .wl-global-progress{width:100%;height:4px;margin-top:4px;accent-color:#ff5d54}
        #wavelink-global-player .wl-global-actions{display:flex;align-items:center;gap:4px}
        #wavelink-global-player button{width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:#fff;cursor:pointer;font:16px/1 system-ui}
        #wavelink-global-player button:hover{background:rgba(255,255,255,.13)}
        #wavelink-global-player .wl-global-play{background:#fff;color:#111}
        #wavelink-global-player[data-error="true"]{border-color:rgba(241,94,108,.7)}
      `;
      document.head.appendChild(style);
    }
    const bar = document.createElement("section");
    bar.id = "wavelink-global-player";
    bar.hidden = true;
    bar.setAttribute("aria-label", "WaveLink player");
    bar.innerHTML = `
      <img class="wl-global-art" alt="">
      <div class="wl-global-meta">
        <a class="wl-global-title" target="_blank" rel="noreferrer"></a>
        <a class="wl-global-artist" target="_blank" rel="noreferrer"></a>
        <input class="wl-global-progress" type="range" min="0" max="1" step="0.001" aria-label="WaveLink playback position">
      </div>
      <div class="wl-global-actions">
        <button type="button" data-action="prev" aria-label="Previous">‹</button>
        <button type="button" data-action="play" class="wl-global-play" aria-label="Play">▶</button>
        <button type="button" data-action="next" aria-label="Next">›</button>
        <button type="button" data-action="stop" aria-label="Stop and close">×</button>
      </div>`;
    bar.querySelector('[data-action="prev"]')?.addEventListener("click", () => void this.prev());
    bar.querySelector('[data-action="play"]')?.addEventListener("click", () => this.toggle());
    bar.querySelector('[data-action="next"]')?.addEventListener("click", () => void this.next());
    bar.querySelector('[data-action="stop"]')?.addEventListener("click", () => this.stop());
    bar.querySelector<HTMLInputElement>(".wl-global-progress")?.addEventListener("input", (event) => {
      this.seek(Number((event.currentTarget as HTMLInputElement).value));
    });
    document.body.appendChild(bar);
    this._globalControls = bar;
    return bar;
  }

  private updateGlobalControls(): void {
    const bar = this.ensureGlobalControls();
    const track = this._track;
    const nativeBarAvailable = Boolean(
      this._nativeControls &&
        document.contains(this._nativeControls),
    );
    // Errors/notices must remain visible even when the Spotify bar adapter is
    // present; otherwise a failed stream appears to do nothing at all.
    bar.hidden = !track || (nativeBarAvailable && !this._error && !this._notice);
    if (!track) return;
    const art = bar.querySelector<HTMLImageElement>(".wl-global-art");
    if (art) {
      const source = soundCloudTrackArtworkUrl(
        track.artwork_url,
        "t200x200",
      );
      art.hidden = false;
      art.onerror = () => {
        if (art.getAttribute("src") !== WAVELINK_TRACK_FALLBACK_ARTWORK) {
          art.src = WAVELINK_TRACK_FALLBACK_ARTWORK;
        }
      };
      if (art.getAttribute("src") !== source) art.src = source;
    }
    const title = bar.querySelector<HTMLAnchorElement>(".wl-global-title");
    if (title) {
      title.textContent = track.title;
      title.href = track.permalink_url;
      title.title = this._error ?? `Open ${track.title} on SoundCloud`;
    }
    const artist = bar.querySelector<HTMLAnchorElement>(".wl-global-artist");
    if (artist) {
      artist.textContent = this._error ?? this._notice ?? `${track.user.username} · SoundCloud`;
      artist.href = track.user.permalink_url;
    }
    const progress = bar.querySelector<HTMLInputElement>(".wl-global-progress");
    if (progress) progress.value = String(this.getState().position || 0);
    const play = bar.querySelector<HTMLButtonElement>('[data-action="play"]');
    if (play) {
      play.textContent = this._isLoading ? "…" : this._error ? "↻" : this.audio.paused ? "▶" : "Ⅱ";
      play.setAttribute("aria-label", this._error ? "Retry" : this.audio.paused ? "Play" : "Pause");
    }
    bar.dataset.error = String(Boolean(this._error));
  }

  // ── Public state ──────────────────────────────────────────────────────────

  private playbackResumePositionMs(): number {
    const pending = this._resumePendingSeek;
    if (
      pending &&
      this._track &&
      pending.trackKey === trackKey(this._track)
    ) {
      return pending.positionMs;
    }
    const seconds = Number(this.audio.currentTime);
    return Number.isFinite(seconds) && seconds > 0
      ? Math.round(seconds * 1_000)
      : 0;
  }

  private persistPlaybackResume(force = false): void {
    const track = this._track;
    const ownerUrn = this._resumeOwnerUrn;
    if (!track || !ownerUrn) return;
    if (this._resumeUnloading && !force) return;
    // Loading a restored stream emits several position=0 snapshots before
    // metadata is ready. The pending seek below is authoritative during that
    // window; ordinary ticks must not overwrite the saved resume point.
    if (this._resumeRestoring && !force) return;

    const now = Date.now();
    if (!force && now < this._resumeSaveRetryAfter) return;
    const currentTrackKey = trackKey(track);
    const positionMs = this.playbackResumePositionMs();
    const positionBucket = Math.floor(positionMs / 5_000);
    const structureChanged =
      currentTrackKey !== this._resumeLastSavedTrackKey ||
      this._queueRevision !== this._resumeLastSavedQueueRevision;
    if (
      !force &&
      !structureChanged &&
      (now - this._resumeLastSavedAt < 5_000 ||
        positionBucket === this._resumeLastSavedPositionBucket)
    ) {
      return;
    }

    const saved = savePlaybackResumeState(
      {
        ownerUrn,
        positionMs,
        queue: this.queue.map((entry) => ({
          track: entry.track,
          context: entry.context,
        })),
        queueIndex: this.queueIndex,
      },
      now,
    );
    if (!saved) {
      this._resumeSaveRetryAfter = now + 10_000;
      return;
    }
    this._resumeSaveRetryAfter = 0;
    this._resumeLastSavedAt = now;
    this._resumeLastSavedTrackKey = currentTrackKey;
    this._resumeLastSavedQueueRevision = this._queueRevision;
    this._resumeLastSavedPositionBucket = positionBucket;
  }

  private clearPlaybackResumeCheckpoint(preserveStored = false): void {
    this._resumePendingSeek = null;
    this._resumeRestoring = false;
    this._playRequestedWhileLoading = false;
    this._resumeLastSavedAt = 0;
    this._resumeLastSavedTrackKey = "";
    this._resumeLastSavedQueueRevision = -1;
    this._resumeLastSavedPositionBucket = -1;
    this._resumeSaveRetryAfter = 0;
    if (!preserveStored) clearPlaybackResumeState();
  }

  private applyPendingPlaybackResumeSeek(): boolean {
    const pending = this._resumePendingSeek;
    const track = this._track;
    if (!pending || !track) return false;
    if (
      pending.loadId !== this._loadId ||
      pending.trackKey !== trackKey(track)
    ) {
      return false;
    }
    if (
      this.audio.readyState < 1 ||
      !Number.isFinite(this.audio.duration) ||
      this.audio.duration <= 0
    ) {
      return false;
    }

    // A live source swap should finish the track normally, even near the end.
    // Only a restored desktop session uses the restart-from-zero policy.
    const seconds = pending.streamRecovery
      ? Math.min(pending.positionMs / 1_000, Math.max(0, this.audio.duration - 0.05))
      : resumePositionSeconds(pending.positionMs, Math.round(this.audio.duration * 1_000));
    try {
      this.audio.currentTime = seconds;
    } catch (cause) {
      warn("player", "Could not restore WaveLink playback position:", cause);
      return false;
    }
    const shouldStartPlayback =
      !this._resumeUnloading && this._playRequestedWhileLoading;
    this._playRequestedWhileLoading = false;
    this._resumePendingSeek = null;
    log(
      "player",
      "restored paused playback position %.1fs for '%s'",
      seconds,
      track.title,
    );
    this.syncSpotifyProgress();
    this.emit();
    this.persistPlaybackResume(true);
    if (shouldStartPlayback) void this.startAudio(pending.loadId);
    return shouldStartPlayback;
  }

  private async waitForStablePausedSpotifyBaseline(
    generation: number,
  ): Promise<{ allowed: boolean; uri: string | null }> {
    let uri = this.spotifyItemUri();
    let stableSamples = 0;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (
        generation !== this._resumeInitializationGeneration ||
        this._track ||
        this.spotifyPlaying()
      ) {
        return { allowed: false, uri };
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
      const current = this.spotifyItemUri();
      if (current === uri) stableSamples += 1;
      else {
        uri = current;
        stableSamples = 0;
      }
      // A null URI during early Spotify bootstrap is not yet a stable native
      // baseline. Give Spotify the full sampling window to publish its item.
      if (stableSamples >= 2 && uri !== null) {
        return {
          allowed:
            generation === this._resumeInitializationGeneration &&
            !this._track &&
            !this.spotifyPlaying(),
          uri,
        };
      }
    }
    return {
      allowed:
        generation === this._resumeInitializationGeneration &&
        !this._track &&
        !this.spotifyPlaying(),
      uri,
    };
  }

  /**
   * Restore the last active WaveLink source after the SoundCloud owner has
   * been verified. Safe to call from both compiled bundles because the player
   * itself is a shared window singleton and initialization is owner-scoped.
   */
  initializePlaybackResume(
    owner: Pick<SCUser, "id" | "urn">,
  ): Promise<void> {
    const ownerUrn = canonicalPlaybackResumeOwnerUrn(owner.urn || owner.id);
    if (!ownerUrn) return Promise.resolve();
    if (
      this._resumeOwnerUrn &&
      this._resumeOwnerUrn !== ownerUrn &&
      this._track
    ) {
      // Never re-label account A's active track as account B's checkpoint.
      // A verified live account switch releases the old playback owner first.
      this.stop();
    }
    this._resumeOwnerUrn = ownerUrn;
    this._ownUserUrn = ownerUrn;
    if (this._track) this.persistPlaybackResume(true);

    if (
      this._resumeInitializationOwnerUrn === ownerUrn &&
      this._resumeInitializationPromise
    ) {
      return this._resumeInitializationPromise;
    }
    if (this._resumeInitializationOwnerUrn === ownerUrn && this._track) {
      return Promise.resolve();
    }
    this._resumeInitializationOwnerUrn = ownerUrn;
    const generation = ++this._resumeInitializationGeneration;
    const loadGeneration = this._loadId;
    const task = this.restorePlaybackResume(
      ownerUrn,
      generation,
      loadGeneration,
    ).finally(() => {
      if (this._resumeInitializationPromise === task) {
        this._resumeInitializationPromise = null;
      }
    });
    this._resumeInitializationPromise = task;
    return task;
  }

  private async restorePlaybackResume(
    ownerUrn: SoundCloudUrn,
    generation: number,
    loadGeneration: number,
  ): Promise<void> {
    const saved = loadPlaybackResumeState(ownerUrn);
    if (!saved || this._track || loadGeneration !== this._loadId) return;
    const savedCurrent = saved.queue[saved.queueIndex];
    if (!savedCurrent) {
      clearPlaybackResumeState();
      return;
    }

    const baselinePromise = this.waitForStablePausedSpotifyBaseline(
      generation,
    );
    let freshTrack: SCTrack | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        // Stored metadata is only a safe UI snapshot. Resolve a fresh entity
        // and let loadTrackInternal request a newly signed media URL later.
        freshTrack = await getTrack(savedCurrent.track.urn);
        break;
      } catch (cause) {
        const status =
          cause && typeof cause === "object" && "status" in cause
            ? Number((cause as { status?: unknown }).status)
            : 0;
        if (status === 401 || status === 404) {
          clearPlaybackResumeState();
          warn("player", "Could not refresh the saved WaveLink track:", cause);
          return;
        }
        const transient = status === 0 || status === 429 || status >= 500;
        if (!transient || attempt >= 2) {
          warn("player", "Could not refresh the saved WaveLink track:", cause);
          return;
        }
        await new Promise<void>((resolve) =>
          window.setTimeout(resolve, 750 * (attempt + 1)),
        );
        if (
          generation !== this._resumeInitializationGeneration ||
          loadGeneration !== this._loadId ||
          this._track ||
          this.spotifyPlaying()
        ) {
          return;
        }
      }
    }
    if (!freshTrack) return;
    const baseline = await baselinePromise;
    if (
      !baseline.allowed ||
      generation !== this._resumeInitializationGeneration ||
      this._resumeOwnerUrn !== ownerUrn ||
      this._track ||
      loadGeneration !== this._loadId ||
      this.spotifyPlaying() ||
      this.spotifyItemUri() !== baseline.uri
    ) {
      return;
    }
    if (isTrackUnavailable(freshTrack)) {
      clearPlaybackResumeState();
      return;
    }

    const entries: QueueEntry[] = saved.queue.map((entry, index) => ({
      token: this._nextQueueToken++,
      track: index === saved.queueIndex ? freshTrack : entry.track,
      context: normalizePlaybackContext(entry.context),
    }));
    if (entries.length === 0 || !entries[saved.queueIndex]) {
      clearPlaybackResumeState();
      return;
    }
    // The stored queue is already the effective order (including shuffle).
    // Adopt it directly instead of setQueue(), which would reshuffle it.
    this.detachQueueSource();
    this.originalQueue = entries;
    this.queue = [...entries];
    this.queueIndex = saved.queueIndex;
    this._queueRevision++;
    this._relatedPromise = null;
    this._spotifyBaselineUri = baseline.uri;

    const restoredSeconds = resumePositionSeconds(
      saved.positionMs,
      freshTrack.duration,
    );
    this._resumePendingSeek = {
      trackKey: trackKey(freshTrack),
      loadId: this._loadId + 1,
      positionMs: Math.round(restoredSeconds * 1_000),
    };
    this._resumeRestoring = true;
    log(
      "player",
      "restoring paused WaveLink track '%s' at %.1fs",
      freshTrack.title,
      restoredSeconds,
    );
    try {
      const result = await this.loadTrackInternal(freshTrack, false, false);
      if (result === "loaded") this.applyPendingPlaybackResumeSeek();
    } finally {
      this._resumeRestoring = false;
      if (this._track && generation === this._resumeInitializationGeneration) {
        this.persistPlaybackResume(true);
      }
    }
  }

  private persistSetting(key: string, value: string): void {
    try {
      if (typeof Spicetify !== "undefined") {
        Spicetify.LocalStorage.set(key, value);
      }
    } catch (storageError) {
      warn("player", `Could not persist ${key}:`, storageError);
    }
  }

  private makeEntries(
    tracks: readonly SCTrack[],
    context: PlaybackContext = this.currentEntry()?.context ??
      DEFAULT_PLAYBACK_CONTEXT,
  ): QueueEntry[] {
    const normalizedContext = normalizePlaybackContext(context);
    return tracks.map((track) => ({
      token: this._nextQueueToken++,
      track,
      context: normalizedContext,
    }));
  }

  private currentEntry(): QueueEntry | null {
    return this.queue[this.queueIndex] ?? null;
  }

  private queueSourceHasMore(): boolean {
    return Boolean(
      this._queueSource && this._queueSourceSnapshot?.nextHref,
    );
  }

  private queueDisplayTotal(): number {
    const total = Number(this._queueSourceSnapshot?.totalCount);
    return Number.isFinite(total) && total >= 0
      ? Math.max(this.queue.length, Math.floor(total))
      : this.queue.length;
  }

  /**
   * Stop listening to a collection source before a structural queue change.
   * An already-running request is harmless: its generation no longer matches
   * and therefore cannot refill a cleared or replaced queue.
   */
  private detachQueueSource(): void {
    const unsubscribe = this._queueSourceUnsubscribe;
    this._queueSourceGeneration += 1;
    this._queueSource = null;
    this._queueSourceSnapshot = null;
    this._queueSourceUnsubscribe = null;
    this._queueSourceLoadedCount = 0;
    this._queueSourceLoadPromise = null;
    try {
      unsubscribe?.();
    } catch (cause) {
      warn("player", "Could not release paginated queue source:", cause);
    }
  }

  private queueSourcePrefixMatches(
    snapshot: PaginatedTrackSourceSnapshot,
  ): boolean {
    if (
      snapshot.tracks.length < this._queueSourceLoadedCount ||
      this.originalQueue.length < this._queueSourceLoadedCount
    ) {
      return false;
    }
    for (let index = 0; index < this._queueSourceLoadedCount; index += 1) {
      if (
        trackKey(snapshot.tracks[index]) !==
        trackKey(this.originalQueue[index].track)
      ) {
        return false;
      }
    }
    return true;
  }

  private acceptQueueSourceSnapshot(
    source: PaginatedTrackSource,
    generation: number,
    snapshot: PaginatedTrackSourceSnapshot,
  ): void {
    if (
      source !== this._queueSource ||
      generation !== this._queueSourceGeneration
    ) {
      return;
    }
    if (!this.queueSourcePrefixMatches(snapshot)) {
      warn(
        "player",
        "Paginated queue source changed its loaded prefix; detaching it safely.",
      );
      this.detachQueueSource();
      this._nativeQueueSignature = "";
      this.emit();
      return;
    }

    const previousLoadedCount = this._queueSourceLoadedCount;
    this._queueSourceSnapshot = snapshot;
    this._queueSourceLoadedCount = snapshot.tracks.length;
    const appendedTracks = snapshot.tracks.slice(previousLoadedCount);
    if (appendedTracks.length > 0) {
      const context =
        this.originalQueue[previousLoadedCount - 1]?.context ??
        this.currentEntry()?.context ??
        DEFAULT_PLAYBACK_CONTEXT;
      const entries = this.makeEntries(appendedTracks, context);
      this.originalQueue.push(...entries);
      this._queueRevision += 1;
      this._relatedPromise = null;
      if (this._shuffle) this.rebuildShuffledQueue(true);
      else this.queue.push(...entries);
      log(
        "player",
        "paginated queue appended %d tracks (%d/%d loaded)",
        entries.length,
        this.queue.length,
        this.queueDisplayTotal(),
      );
    }
    this._nativeQueueSignature = "";
    this.emit();
  }

  private attachQueueSource(source: PaginatedTrackSource): void {
    this.detachQueueSource();
    const generation = this._queueSourceGeneration;
    const snapshot = source.getSnapshot();
    this._queueSource = source;
    this._queueSourceSnapshot = snapshot;
    this._queueSourceLoadedCount = Math.min(
      this.originalQueue.length,
      snapshot.tracks.length,
    );

    const unsubscribe = source.subscribe((nextSnapshot) => {
      this.acceptQueueSourceSnapshot(source, generation, nextSnapshot);
    });
    if (
      source !== this._queueSource ||
      generation !== this._queueSourceGeneration
    ) {
      unsubscribe();
      return;
    }
    this._queueSourceUnsubscribe = unsubscribe;

    // Cover a page that finished between getSnapshot() and subscribe().
    this.acceptQueueSourceSnapshot(source, generation, source.getSnapshot());
  }

  private requestQueueSourcePage(): Promise<boolean> {
    const source = this._queueSource;
    const snapshot = this._queueSourceSnapshot;
    if (!source || !snapshot?.nextHref) return Promise.resolve(false);
    if (this._queueSourceLoadPromise) return this._queueSourceLoadPromise;

    const generation = this._queueSourceGeneration;
    const loadedBefore = this._queueSourceLoadedCount;
    const pending = source
      .loadNext()
      .then((nextSnapshot) => {
        this.acceptQueueSourceSnapshot(source, generation, nextSnapshot);
        return (
          source === this._queueSource &&
          generation === this._queueSourceGeneration &&
          this._queueSourceLoadedCount > loadedBefore
        );
      })
      .catch((cause) => {
        if (
          source === this._queueSource &&
          generation === this._queueSourceGeneration
        ) {
          warn("player", "Could not load the next queue page:", cause);
          // The source owns its retry cursor and error projection. Re-read it
          // in case an implementation reports failure by rejecting.
          this.acceptQueueSourceSnapshot(
            source,
            generation,
            source.getSnapshot(),
          );
        }
        return false;
      })
      .finally(() => {
        if (this._queueSourceLoadPromise === pending) {
          this._queueSourceLoadPromise = null;
        }
      });
    this._queueSourceLoadPromise = pending;
    return pending;
  }

  private maybePrefetchQueueForIndex(index: number): void {
    const snapshot = this._queueSourceSnapshot;
    if (!snapshot?.nextHref || snapshot.loading || index < 0) return;
    const threshold = paginationPrefetchIndex(
      this._queueSourceLoadedCount,
      snapshot.pageSize,
    );
    if (index >= threshold) void this.requestQueueSourcePage();
  }

  private reportQueueSourceBoundaryError(): void {
    this._notice =
      this._queueSourceSnapshot?.error ||
      "WaveLink could not load the next queue page yet. Press Next to retry.";
    this.emit();
  }

  /** Preserve played history/current item and shuffle only upcoming entries. */
  private rebuildShuffledQueue(preserveHistory = true): void {
    const currentToken = this.currentEntry()?.token ?? null;
    const canonicalTokens = new Set(
      this.originalQueue.map((entry) => entry.token),
    );
    const prefix =
      preserveHistory && this.queueIndex >= 0
        ? this.queue
            .slice(0, this.queueIndex + 1)
            .filter((entry) => canonicalTokens.has(entry.token))
        : [];
    const used = new Set(prefix.map((entry) => entry.token));
    const upcoming = this.originalQueue.filter(
      (entry) => !used.has(entry.token),
    );
    this.queue = [
      ...prefix,
      ...deterministicShuffle(upcoming, this.originalQueue),
    ];
    this.queueIndex =
      currentToken === null
        ? -1
        : this.queue.findIndex((entry) => entry.token === currentToken);
  }

  private restoreOriginalQueueOrder(): void {
    const currentToken = this.currentEntry()?.token ?? null;
    if (currentToken === null || this.queueIndex < 0) {
      this.queue = [...this.originalQueue];
      this.queueIndex = -1;
      return;
    }
    // Keep the effective played history (shuffle may have produced B → D)
    // and restore only the still-unplayed suffix to canonical order. Replacing
    // the entire queue would put unplayed A/C before current D and skip them.
    const history = this.queue.slice(0, this.queueIndex + 1);
    const played = new Set(history.map((entry) => entry.token));
    const upcoming = this.originalQueue.filter(
      (entry) => !played.has(entry.token),
    );
    this.queue = [...history, ...upcoming];
    this.queueIndex = history.findIndex(
      (entry) => entry.token === currentToken,
    );
  }

  /** Align direct loadTrack() calls to a queue, creating an entry if needed. */
  private ensureTrackQueued(track: SCTrack): void {
    const current = this.currentEntry();
    if (
      current &&
      (current.track === track || trackKey(current.track) === trackKey(track))
    ) {
      current.track = track;
      const canonical = this.originalQueue.find(
        (entry) => entry.token === current.token,
      );
      if (canonical) canonical.track = track;
      return;
    }

    let index = this.queue.findIndex((entry) => entry.track === track);
    if (index < 0) {
      index = this.queue.findIndex(
        (entry) => trackKey(entry.track) === trackKey(track),
      );
    }
    if (index >= 0) {
      this.queueIndex = index;
      return;
    }

    this.detachQueueSource();
    const [entry] = this.makeEntries(
      [track],
      current?.context ?? DEFAULT_PLAYBACK_CONTEXT,
    );
    this.originalQueue.push(entry);
    this.queue.push(entry);
    this.queueIndex = this.queue.length - 1;
    this._queueRevision++;
  }

  private async appendRelatedTracks(): Promise<boolean> {
    const baseTrack = this._track;
    if (!baseTrack) return false;
    const revision = this._queueRevision;
    const loadId = this._loadId;

    try {
      const result = await getRelatedTracks(baseTrack.urn || baseTrack.id, 30);
      if (
        revision !== this._queueRevision ||
        loadId !== this._loadId ||
        !this._track ||
        trackKey(this._track) !== trackKey(baseTrack)
      ) {
        return false;
      }

      const seen = new Set(
        this.originalQueue.map((entry) => trackKey(entry.track)),
      );
      const related: SCTrack[] = [];
      for (const track of result.collection ?? []) {
        const key = trackKey(track);
        if (!key || seen.has(key) || isTrackUnavailable(track)) continue;
        seen.add(key);
        related.push(track);
      }
      if (related.length === 0) return false;

      const entries = this.makeEntries(related, {
        label: "WaveLink Radio",
        target: { kind: "main", tab: "home" },
      });
      this.detachQueueSource();
      this.originalQueue.push(...entries);
      this._queueRevision++;
      if (this._shuffle) this.rebuildShuffledQueue(true);
      else this.queue.push(...entries);
      log("player", "autoplay appended %d related tracks", entries.length);
      this.emit();
      return this.queueIndex < this.queue.length - 1;
    } catch (relatedError) {
      warn("player", "Could not load related autoplay tracks:", relatedError);
      return false;
    }
  }

  private requestRelatedTracks(): Promise<boolean> {
    if (this._relatedPromise) return this._relatedPromise;
    const pending = this.appendRelatedTracks().finally(() => {
      if (this._relatedPromise === pending) this._relatedPromise = null;
    });
    this._relatedPromise = pending;
    return pending;
  }

  private async advanceQueue(reason: AdvanceReason): Promise<void> {
    if (reason === "ended" && this._repeat === "one" && this._track) {
      this._resumePendingSeek = null;
      this.audio.currentTime = 0;
      this.persistPlaybackResume(true);
      await this.play();
      return;
    }

    const attemptedTokens = new Set<number>();
    let cursor = this.queueIndex;
    let wrapped = false;
    let relatedRequested = false;

    // Traverse iteratively so one or many unavailable entries can never stop
    // the queue or recurse forever under Repeat all.
    while (this.queue.length > 0) {
      if (attemptedTokens.size >= this.queue.length) {
        if (this.queueSourceHasMore()) {
          const appended = await this.requestQueueSourcePage();
          if (appended) continue;
          if (this.queueSourceHasMore()) {
            this.reportQueueSourceBoundaryError();
            return;
          }
        }
        if (
          this._repeat !== "all" &&
          this._autoplayRelated &&
          this._track &&
          !relatedRequested
        ) {
          relatedRequested = true;
          const appended = await this.requestRelatedTracks();
          if (appended) continue;
        }
        break;
      }
      let nextIndex = cursor + 1;
      if (nextIndex >= this.queue.length) {
        if (this.queueSourceHasMore()) {
          const appended = await this.requestQueueSourcePage();
          if (appended) continue;
          if (this.queueSourceHasMore()) {
            this.reportQueueSourceBoundaryError();
            return;
          }
        }
        if (this._repeat === "all" && !wrapped && this.queue.length > 0) {
          nextIndex = 0;
          wrapped = true;
        } else if (
          this._repeat !== "all" &&
          this._autoplayRelated &&
          this._track &&
          !relatedRequested
        ) {
          relatedRequested = true;
          const appended = await this.requestRelatedTracks();
          if (!appended) break;
          continue;
        } else {
          break;
        }
      }

      const nextEntry = this.queue[nextIndex];
      if (!nextEntry) break;
      cursor = nextIndex;
      if (attemptedTokens.has(nextEntry.token)) continue;
      attemptedTokens.add(nextEntry.token);
      this.queueIndex = nextIndex;
      this.maybePrefetchQueueForIndex(nextIndex);

      if (isTrackUnavailable(nextEntry.track)) {
        log(
          "player",
          "skipping unavailable queue[%d/%d] '%s'",
          nextIndex,
          this.queue.length - 1,
          nextEntry.track.title,
        );
        continue;
      }

      log(
        "player",
        "next -> queue[%d/%d] '%s'",
        nextIndex,
        this.queue.length - 1,
        nextEntry.track.title,
      );
      const result = await this.loadTrackInternal(
        nextEntry.track,
        true,
        true,
      );
      if (result === "unavailable") continue;
      return;
    }

    log("player", "next - end of queue (%d tracks)", this.queue.length);
    this.stop();
  }

  private requestAdvance(reason: AdvanceReason): Promise<void> {
    if (this._advancePromise) return this._advancePromise;
    const pending = this.advanceQueue(reason).finally(() => {
      if (this._advancePromise === pending) this._advancePromise = null;
    });
    this._advancePromise = pending;
    return pending;
  }

  getState(): PlayerState {
    const raw = this.audio.duration;
    const duration =
      isFinite(raw) && raw > 0
        ? raw
        : this._track
          ? this._track.duration / 1000
          : 0;
    return {
      track: this._track,
      isPlaying: !this.audio.paused && !this.audio.ended,
      position: duration > 0
        ? (this._softwareAacRecoveryLoadId === this._loadId
          ? this.playbackResumePositionMs() / 1_000
          : this.audio.currentTime) / duration
        : 0,
      duration,
      volume: this.audio.volume,
      isMuted: this.audio.muted,
      isLoading: this._isLoading,
      error: this._error,
      notice: this._notice,
      // Expose these so React components can view the settings live
      scVolMultEnabled: this._scVolMultEnabled,
      scVolumeLevel: this._scVolumeLevel,
      queue: this.queue.map((entry) => entry.track),
      queueIndex: this.queueIndex,
      queueTotal: this.queueDisplayTotal(),
      queueHasMore: this.queueSourceHasMore(),
      queueLoadingMore: Boolean(this._queueSourceSnapshot?.loading),
      queueLoadError: this._queueSourceSnapshot?.error ?? null,
      context: this.currentEntry()?.context ?? DEFAULT_PLAYBACK_CONTEXT,
      shuffle: this._shuffle,
      repeat: this._repeat,
      autoplayRelated: this._autoplayRelated,
      tracksPerLoad: this._tracksPerLoad,
      spotifySearchIntegrationEnabled:
        this._spotifySearchIntegrationEnabled,
      sourceBadgePreferences: { ...this._sourceBadgePreferences },
    };
  }

  subscribe(cb: Listener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  private async startAudio(expectedLoadId = this._loadId): Promise<boolean> {
    const softwareAac = this.softwareAac;
    const isCurrentSource = () => expectedLoadId === this._loadId &&
      (!softwareAac || this.softwareAac === softwareAac);
    try {
      await this.audio.play();
      if (!isCurrentSource()) return false;
      const claim = claimPlayHistoryAttempt(
        this._historyAttemptedLoadId,
        expectedLoadId,
        this._loadId,
        this._track?.urn ?? this._track?.id,
      );
      this._historyAttemptedLoadId = claim.attemptedLoadId;
      const historyTrack = this._track;
      if (claim.trackUrn && historyTrack) {
        if (!recordLocalPlayHistory(historyTrack)) {
          warn("player", "Could not save the track to WaveLink history.");
        }
        void recordTrackPlayHistory(claim.trackUrn).catch((cause) => {
          warn(
            "player",
            "Could not add the track to SoundCloud play history:",
            cause,
          );
        });
      }
      this._notice = null;
      this.emit();
      return true;
    } catch (cause) {
      if (!isCurrentSource()) return false;
      if (this._track && softwareAac && cause instanceof SoftwareAacDecodeError) {
        void this.handleSoftwareAacFailure(this._track, expectedLoadId, softwareAac, cause, true);
        return false;
      }
      const name = cause instanceof DOMException ? cause.name : "";
      if (name === "AbortError") return false;
      if (name === "NotAllowedError") {
        this._notice = "Track loaded. Press Play once more to allow audio in Spotify.";
        warn("player", "playback needs another user gesture:", cause);
      } else {
        this._error =
          cause instanceof Error && cause.message
            ? `Could not start playback: ${cause.message}`
            : "Could not start SoundCloud playback.";
        logError("player", "audio.play() failed:", cause);
      }
      this.emit();
      return false;
    }
  }

  private async loadTrackInternal(
    track: SCTrack,
    autoPlay = true,
    skipUnavailable = false,
  ): Promise<TrackLoadResult> {
    if (autoPlay) this.primeSoftwareAacOutput();
    this.cancelSpotifyCoverRecovery();
    const loadId = ++this._loadId;
    this._playRequestedWhileLoading = false;
    if (this._resumePendingSeek) {
      if (this._resumePendingSeek.trackKey === trackKey(track)) {
        // A retry of the same restored track receives a new load generation.
        this._resumePendingSeek.loadId = loadId;
      } else {
        this._resumePendingSeek = null;
      }
    }
    const previousTrack = this._track;
    // Tear down the old source while _track/currentEntry still describe it.
    // Its synchronous pause event must never save the old position under the
    // metadata of the track we are about to load.
    this.resetMediaSource();
    if (!this._track) this._spotifyBaselineUri = this.spotifyItemUri();
    this.ensureTrackQueued(track);
    log(
      "player",
      "loadTrack → '%s' (urn:%s, autoPlay:%s)",
      track.title,
      track.id,
      autoPlay,
    );
    this._track = track;
    this.prepareArtistProfile(track, loadId);
    this._isLoading = true;
    this._error = null;
    this._notice = null;
    // The old source was stopped before replacing _track above. The new source
    // is attached only if this loadId is still current.
    this.startTimer(); // keep Spotify muted during stream-URL resolution
    this.emit();

    // Mute Spotify's audio immediately — belt-and-suspenders safety.
    this.muteSpotifyAudio(true);

    // Pause Spotify so its track position doesn't advance during SC playback.
    // The _isLoading guard ensures the resulting onplaypause echo is ignored.
    try {
      if (Spicetify.Player.data?.item && Spicetify.Player.isPlaying()) {
        this._suppressSpotifyEventsUntil = Date.now() + 1_000;
        Spicetify.Player.pause();
      }
    } catch {}

    try {
      const attached = await this.attachMedia(track, loadId);
      if (!attached || loadId !== this._loadId) {
        log("player", "loadTrack stale (loadId mismatch), aborting");
        return "stale";
      }
      // Fix: Save Spotify's volume and visually switch slider to SC volume profile
      if (this._scVolMultEnabled) {
        if (this._savedSpotifyVolume === null) {
          try { this._savedSpotifyVolume = Spicetify.Player.getVolume(); } catch { this._savedSpotifyVolume = 0.5; }
        }
        log("player", "loadTrack — separate profiles enabled. savedSpotifyVolume=%.2f, applying scVolumeLevel=%.2f", this._savedSpotifyVolume, this._scVolumeLevel);
        this.setSyncedVolume(this._scVolumeLevel);
        this._lastCheckedVolume = this._scVolumeLevel;
      } else {
        try { this.audio.volume = safeVolume(Spicetify.Player.getVolume()); } catch { this.audio.volume = 0.5; }
        this.audio.muted = this.audio.volume <= 0.001;
        log("player", "loadTrack — shared volume. setting audio.volume to %.2f", this.audio.volume);
      }
      log("player", "audio src set, volume=%.2f", this.audio.volume);

      // On desktop Linux, Chromium exposes this real HTMLAudioElement as the
      // separate MPRIS/"Spotify Web Player" source. Claim it only after the
      // SoundCloud stream is attached, then release it on Spotify handoff.
      this.activateLinuxMediaSession(track);

      const shouldStartPlayback = autoPlay || this._playRequestedWhileLoading;
      this._playRequestedWhileLoading = shouldStartPlayback;
      const startedAfterResumeSeek = this.applyPendingPlaybackResumeSeek();
      if (this._resumePendingSeek) {
        // Metadata is not ready yet. Keep the user's Play intent queued; the
        // metadata/duration handlers seek first and only then start audio.
        this._playRequestedWhileLoading = shouldStartPlayback;
      } else if (!startedAfterResumeSeek && shouldStartPlayback) {
        this._playRequestedWhileLoading = false;
        if (await this.startAudio(loadId)) log("player", "autoplay started");
      } else {
        this._playRequestedWhileLoading = false;
      }

      this.updateNowPlayingBar();
      // Prime time labels immediately so the overlay never shows "0:00/0:00".
      try {
        const pe = q(SEL_POS_TEXT);
        if (pe) pe.setAttribute("data-sc-time", "0:00");
        const de = q(SEL_DUR_TEXT);
        if (de) de.setAttribute("data-sc-time", fmtTime(track.duration / 1000));
      } catch {}
      return "loaded";
    } catch (err) {
      if (loadId !== this._loadId) return "stale";
      logError("player", "loadTrack error:", err);
      if (skipUnavailable && isAutomaticallySkippableMediaError(err)) {
        // Either a canonical blocked response or a resolver-confirmed lack of
        // usable streams means this entry cannot play in WaveLink this session.
        const unavailableReason =
          unavailableReasonForError(err) ?? "no_stream";
        markTrackUnavailable(
          track,
          unavailableReason,
          soundCloudErrorCountryCode(err),
        );
        this.resetMediaSource();
        this._track = previousTrack;
        if (previousTrack) this.prepareArtistProfile(previousTrack, loadId);
        this._error = null;
        this._notice =
          unavailableReason === "no_stream"
            ? `Skipped ${track.title}: no supported SoundCloud stream is available.`
            : `Skipped ${track.title}: ${trackUnavailableLabel(track)}.`;
        this._nativeQueueSignature = "";
        this.emit();
        return "unavailable";
      }
      this.failPlayback(
        err instanceof Error ? err.message : "Failed to load track",
      );
      return "failed";
    } finally {
      if (loadId === this._loadId && this._softwareAacRecoveryLoadId !== loadId) {
        if (!this._resumePendingSeek) {
          this._playRequestedWhileLoading = false;
        }
        this._isLoading = false;
        this.emit();
      }
    }
  }

  async loadTrack(track: SCTrack, autoPlay = true): Promise<void> {
    if (isTrackUnavailable(track)) {
      this._notice = `${track.title}: ${trackUnavailableLabel(track)}.`;
      try {
        Spicetify.showNotification(`WaveLink: ${this._notice}`, true, 5_000);
      } catch {}
      this.emit();
      return;
    }
    await this.loadTrackInternal(track, autoPlay, false);
  }

  setQueue(
    tracks: SCTrack[],
    startIndex = 0,
    context: PlaybackContext = DEFAULT_PLAYBACK_CONTEXT,
  ): number {
    this.detachQueueSource();
    log(
      "player",
      "setQueue — %d tracks, startIndex=%d",
      tracks.length,
      startIndex,
    );
    const entries = this.makeEntries(tracks, context);
    this.originalQueue = entries;
    this._queueRevision++;
    this._relatedPromise = null;

    if (entries.length === 0) {
      this.queue = [];
      this.queueIndex = -1;
      this.emit();
      return this._queueRevision;
    }

    const index = Math.max(0, Math.min(entries.length - 1, startIndex));
    if (this._shuffle) {
      const current = entries[index];
      const upcoming = entries.filter((entry) => entry.token !== current.token);
      this.queue = [
        current,
        ...deterministicShuffle(upcoming, this.originalQueue),
      ];
      this.queueIndex = 0;
    } else {
      this.queue = [...entries];
      this.queueIndex = index;
    }
    this.emit();
    return this._queueRevision;
  }

  /** Start playback from the currently loaded prefix of a shared pager. */
  setQueueFromSource(
    source: PaginatedTrackSource,
    startIndex = 0,
    context: PlaybackContext = DEFAULT_PLAYBACK_CONTEXT,
  ): number {
    const snapshot = source.getSnapshot();
    const revision = this.setQueue(snapshot.tracks, startIndex, context);
    if (snapshot.tracks.length === 0) return revision;
    this.attachQueueSource(source);
    this.maybePrefetchQueueForIndex(this.queueIndex);
    return revision;
  }

  replaceQueueIfRevision(
    expectedRevision: number,
    tracks: SCTrack[],
    context?: PlaybackContext,
  ): boolean {
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision !== this._queueRevision
    ) {
      return false;
    }

    const currentEntry = this.currentEntry();
    const currentTrack = currentEntry?.track ?? this._track;
    if (!currentTrack || tracks.length === 0) return false;

    const previousTracks = this.originalQueue.map((entry) => entry.track);
    if (sameTrackQueue(previousTracks, tracks)) return true;

    const currentIndex = findTrackQueueIndex(
      tracks,
      currentTrack,
      [currentTrack],
      0,
    );
    if (currentIndex < 0) return false;

    this.detachQueueSource();

    const entries = this.makeEntries(
      tracks,
      context ?? currentEntry?.context ?? DEFAULT_PLAYBACK_CONTEXT,
    );
    this.originalQueue = entries;
    this._queueRevision++;
    this._relatedPromise = null;

    if (this._shuffle) {
      const current = entries[currentIndex];
      const upcoming = entries.filter((entry) => entry.token !== current.token);
      this.queue = [
        current,
        ...deterministicShuffle(upcoming, this.originalQueue),
      ];
      this.queueIndex = 0;
    } else {
      this.queue = [...entries];
      this.queueIndex = currentIndex;
    }
    this.emit();
    return true;
  }

  async playQueueIndex(index: number, autoPlay = true): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= this.queue.length) {
      return;
    }
    const track = this.queue[index].track;
    if (isTrackUnavailable(track)) {
      this._notice = `${track.title}: ${trackUnavailableLabel(track)}.`;
      try {
        Spicetify.showNotification(`WaveLink: ${this._notice}`, true, 5_000);
      } catch {}
      this.emit();
      return;
    }
    this.queueIndex = index;
    this.maybePrefetchQueueForIndex(index);
    this.emit();
    await this.loadTrack(track, autoPlay);
  }

  private normalizeQueueInput(
    input: SCTrack | readonly SCTrack[],
  ): SCTrack[] {
    return Array.isArray(input) ? [...input] : [input as SCTrack];
  }

  addToQueue(
    input: SCTrack | readonly SCTrack[],
    context?: PlaybackContext,
  ): void {
    const tracks = this.normalizeQueueInput(input);
    if (tracks.length === 0) return;
    this.detachQueueSource();
    const entries = this.makeEntries(
      tracks,
      context ?? this.currentEntry()?.context ?? DEFAULT_PLAYBACK_CONTEXT,
    );
    this.originalQueue.push(...entries);
    this._queueRevision++;
    this._relatedPromise = null;
    if (this._shuffle) this.rebuildShuffledQueue(true);
    else this.queue.push(...entries);
    this.emit();
  }

  playNext(
    input: SCTrack | readonly SCTrack[],
    context?: PlaybackContext,
  ): void {
    const tracks = this.normalizeQueueInput(input);
    if (tracks.length === 0) return;
    if (!this._track && this.queueIndex < 0) {
      this.setQueue(tracks, 0, context ?? DEFAULT_PLAYBACK_CONTEXT);
      void this.loadTrack(tracks[0]);
      return;
    }
    this.detachQueueSource();
    const entries = this.makeEntries(
      tracks,
      context ?? this.currentEntry()?.context ?? DEFAULT_PLAYBACK_CONTEXT,
    );
    const current = this.currentEntry();
    const canonicalIndex = current
      ? this.originalQueue.findIndex((entry) => entry.token === current.token)
      : -1;
    this.originalQueue.splice(canonicalIndex + 1, 0, ...entries);
    this.queue.splice(this.queueIndex + 1, 0, ...entries);
    this._queueRevision++;
    this._relatedPromise = null;
    this.emit();
  }

  async removeFromQueue(index: number): Promise<void> {
    if (!Number.isInteger(index) || index < 0 || index >= this.queue.length) {
      return;
    }
    this.detachQueueSource();
    const entry = this.queue[index];
    const removingCurrent = index === this.queueIndex;
    const wasPlaying = !this.audio.paused && !this.audio.ended;
    this.queue.splice(index, 1);
    this.originalQueue = this.originalQueue.filter(
      (candidate) => candidate.token !== entry.token,
    );
    this._queueRevision++;
    this._relatedPromise = null;

    if (index < this.queueIndex) this.queueIndex--;
    if (!removingCurrent || !this._track) {
      if (this.queue.length === 0) this.queueIndex = -1;
      else this.queueIndex = Math.min(this.queueIndex, this.queue.length - 1);
      this.emit();
      return;
    }

    if (this.queue.length === 0) {
      this.stop();
      return;
    }
    this.queueIndex = Math.min(index, this.queue.length - 1);
    await this.loadTrack(this.queue[this.queueIndex].track, wasPlaying);
  }

  remove(index: number): Promise<void> {
    return this.removeFromQueue(index);
  }

  reorderQueue(fromIndex: number, toIndex: number): void {
    if (
      !Number.isInteger(fromIndex) ||
      !Number.isInteger(toIndex) ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.queue.length ||
      toIndex >= this.queue.length ||
      fromIndex === toIndex
    ) {
      return;
    }

    this.detachQueueSource();
    const currentToken = this.currentEntry()?.token ?? null;
    const [moved] = this.queue.splice(fromIndex, 1);
    this.queue.splice(toIndex, 0, moved);

    // Mirror the explicit move into the canonical order without replacing the
    // entire canonical queue with a shuffled view.
    this.originalQueue = this.originalQueue.filter(
      (entry) => entry.token !== moved.token,
    );
    const previous = this.queue[toIndex - 1];
    const next = this.queue[toIndex + 1];
    let insertAt = this.originalQueue.length;
    if (next) {
      const nextIndex = this.originalQueue.findIndex(
        (entry) => entry.token === next.token,
      );
      if (nextIndex >= 0) insertAt = nextIndex;
    } else if (previous) {
      const previousIndex = this.originalQueue.findIndex(
        (entry) => entry.token === previous.token,
      );
      if (previousIndex >= 0) insertAt = previousIndex + 1;
    }
    this.originalQueue.splice(insertAt, 0, moved);
    this.queueIndex =
      currentToken === null
        ? -1
        : this.queue.findIndex((entry) => entry.token === currentToken);
    this._queueRevision++;
    this._relatedPromise = null;
    this.emit();
  }

  reorder(fromIndex: number, toIndex: number): void {
    this.reorderQueue(fromIndex, toIndex);
  }

  clearQueue(keepCurrent = true): void {
    this.detachQueueSource();
    const current = keepCurrent && this._track ? this.currentEntry() : null;
    this.originalQueue = current ? [current] : [];
    this.queue = current ? [current] : [];
    this.queueIndex = current ? 0 : -1;
    this._queueRevision++;
    this._relatedPromise = null;
    this.emit();
  }

  setShuffle(enabled: boolean): void {
    if (this._shuffle === enabled) return;
    this._shuffle = enabled;
    if (enabled) this.rebuildShuffledQueue(true);
    else this.restoreOriginalQueueOrder();
    this.persistSetting(STORAGE_KEYS.shuffle, String(enabled));
    this.emit();
  }

  setRepeat(mode: RepeatMode): void {
    if (mode !== "off" && mode !== "all" && mode !== "one") return;
    this._repeat = mode;
    this.persistSetting(STORAGE_KEYS.repeat, mode);
    this.emit();
  }

  setAutoplayRelated(enabled: boolean): void {
    this._autoplayRelated = enabled;
    this.persistSetting(STORAGE_KEYS.autoplayRelated, String(enabled));
    this.emit();
  }

  setTracksPerLoad(value: number): void {
    const normalized = normalizeTracksPerLoad(value);
    if (normalized === this._tracksPerLoad) return;
    this._tracksPerLoad = normalized;
    this.persistSetting(TRACKS_PER_LOAD_STORAGE_KEY, String(normalized));
    dispatchTracksPerLoadChanged(normalized);
    this.emit();
  }

  setSpotifySearchIntegrationEnabled(enabled: boolean): void {
    if (this._spotifySearchIntegrationEnabled === enabled) return;
    this._spotifySearchIntegrationEnabled = enabled;
    this.persistSetting(
      SPOTIFY_SEARCH_INTEGRATION_STORAGE_KEY,
      String(enabled),
    );
    dispatchSpotifySearchIntegrationChanged(enabled);
    this.emit();
  }

  setSourceBadgeEnabled(enabled: boolean): void {
    if (this._sourceBadgePreferences.enabled === enabled) return;
    this._sourceBadgePreferences = {
      ...this._sourceBadgePreferences,
      enabled,
    };
    this.resetSourceBadgeHoverDodge(false);
    this.persistSetting(STORAGE_KEYS.sourceBadgeEnabled, String(enabled));
    this.refreshSourceBadge();
    this.emit();
  }

  setSourceBadgeSide(side: SourceBadgeSide): void {
    if (side !== "left" && side !== "right") return;
    if (this._sourceBadgePreferences.side === side) return;
    this._sourceBadgePreferences = {
      ...this._sourceBadgePreferences,
      side,
    };
    this.resetSourceBadgeHoverDodge(false);
    this.persistSetting(STORAGE_KEYS.sourceBadgeSide, side);
    this.refreshSourceBadge();
    this.emit();
  }

  setSourceBadgeDodgeOnHover(enabled: boolean): void {
    if (this._sourceBadgePreferences.dodgeOnHover === enabled) return;
    this._sourceBadgePreferences = {
      ...this._sourceBadgePreferences,
      dodgeOnHover: enabled,
    };
    this.resetSourceBadgeHoverDodge(false);
    this.persistSetting(
      STORAGE_KEYS.sourceBadgeDodgeOnHover,
      String(enabled),
    );
    this.refreshSourceBadge();
    this.emit();
  }

  setSourceBadgeLinkEnabled(enabled: boolean): void {
    if (this._sourceBadgePreferences.linkEnabled === enabled) return;
    this._sourceBadgePreferences = {
      ...this._sourceBadgePreferences,
      linkEnabled: enabled,
    };
    this.persistSetting(STORAGE_KEYS.sourceBadgeLinkEnabled, String(enabled));
    this.refreshSourceBadge();
    this.emit();
  }

  setSourceBadgeDisplayMode(mode: SourceBadgeDisplayMode): void {
    if (mode !== "icon-text" && mode !== "icon-only") return;
    if (this._sourceBadgePreferences.displayMode === mode) return;
    this._sourceBadgePreferences = {
      ...this._sourceBadgePreferences,
      displayMode: mode,
    };
    this.resetSourceBadgeHoverDodge(false);
    this.persistSetting(STORAGE_KEYS.sourceBadgeDisplayMode, mode);
    this.refreshSourceBadge();
    this.emit();
  }

  setSourceBadgeHideWithFullscreenPlayer(enabled: boolean): void {
    if (
      this._sourceBadgePreferences.hideWithFullscreenPlayer === enabled
    ) {
      return;
    }
    this._sourceBadgePreferences = {
      ...this._sourceBadgePreferences,
      hideWithFullscreenPlayer: enabled,
    };
    this.persistSetting(
      STORAGE_KEYS.sourceBadgeHideWithFullscreenPlayer,
      String(enabled),
    );
    this.refreshSourceBadge();
    this.emit();
  }

  // play() and pause() only touch this.audio — NEVER Spicetify.Player.
  // Spicetify state is exclusively managed by the onplaypause toggle handler.
  // Mixing both causes the handler to receive an echo and toggle in the wrong
  // direction.

  async play(): Promise<void> {
    if (this._isLoading || this._resumePendingSeek) {
      this._playRequestedWhileLoading = true;
      return;
    }
    await this.startAudio();
  }

  pause(): void {
    this._playRequestedWhileLoading = false;
    this.audio.pause();
  }

  toggle(): void {
    if (this._isLoading && this._track) {
      this._playRequestedWhileLoading = true;
      return;
    }
    if (this._error && this._track) {
      void this.loadTrack(this._track);
      return;
    }
    if (this._resumePendingSeek && this._track) {
      this._playRequestedWhileLoading = true;
      return;
    }
    if (this.audio.paused) void this.play();
    else this.pause();
  }

  stop(): void {
    const releasedSpotifyUri = this.spotifyItemUri();
    const releasedSpotifyCover = releasedSpotifyUri && releasedSpotifyUri === this._spotifyBaselineUri
      ? this.captureSpotifyCoverRecovery(releasedSpotifyUri)
      : null;
    this.cancelSpotifyCoverRecovery();
    this._loadId++;
    if (this._spotifySongChangeTimer !== null) {
      window.clearTimeout(this._spotifySongChangeTimer);
      this._spotifySongChangeTimer = null;
    }
    this.resetMediaSource();
    this._track = null;
    this._activeArtistProfile = null;
    this._isLoading = false;
    this._error = null;
    this._notice = null;
    this._suppressSpotifyEventsUntil = 0;
    this._spotifyBaselineUri = null;
    this.detachQueueSource();
    this.originalQueue = [];
    this.queue = [];
    this.queueIndex = -1;
    this._queueRevision++;
    this._relatedPromise = null;
    // Clear only after the media source and track are gone: resetMediaSource()
    // may enqueue a pause event, and that event must not recreate the snapshot
    // that an explicit Stop / Spotify handoff is meant to remove.
    this.clearPlaybackResumeCheckpoint(this._resumeUnloading);
    this.releaseSpotifyControl();
    this.updateSourceBadge(null);
    this.emit();
    if (
      !this._track && releasedSpotifyUri &&
      this.spotifyItemUri() === releasedSpotifyUri
    ) {
      this._spotifyCoverRecoveryCandidate = releasedSpotifyCover;
      this.scheduleSpotifyCoverRecovery(releasedSpotifyUri);
    }
  }

  seek(ratio: number): void {
    const r = Math.max(0, Math.min(1, ratio));
    if (isFinite(this.audio.duration) && this.audio.duration > 0) {
      this._resumePendingSeek = null;
      const t = this.audio.duration * r;
      log(
        "player",
        "seek → %.1f%% (%.1fs / %.1fs)",
        r * 100,
        t,
        this.audio.duration,
      );
      this.audio.currentTime = t;
      this.persistPlaybackResume(true);
      this.linuxMediaSession.syncPosition(true);
    }
  }

  setScVolumeLevel(vol: number): void {
    this._scVolumeLevel = safeVolume(vol, this._scVolumeLevel);
    if (this._track && this._scVolMultEnabled) {
      this.setSyncedVolume(this._scVolumeLevel);
    }
    this.emit();
  }

  setScVolumeEnabled(enabled: boolean): void {
    this._scVolMultEnabled = enabled;
    if (this._track) {
      if (enabled) {
        if (this._savedSpotifyVolume === null) {
          try { this._savedSpotifyVolume = Spicetify.Player.getVolume(); } catch { this._savedSpotifyVolume = 0.5; }
        }
        this.setSyncedVolume(this._scVolumeLevel);
      } else if (this._savedSpotifyVolume !== null) {
        this.restoreSpotifyVolumeProfile();
      }
    }
    this.emit();
  }

  setVolume(vol: number): void {
    const value = safeVolume(vol, this.audio.volume);
    this.audio.volume = value;
    if (value > 0) this.audio.muted = false;
  }

  mute(muted: boolean): void {
    this.audio.muted = muted;
    this.emit();
  }

  // Sets SC audio volume AND moves Spotify's DOM volume slider so that
  // syncSpotifyVolume() (which reads the slider every 250 ms) doesn't
  // immediately override the value the user set via our React slider.
  setSyncedVolume(vol: number): void {
    const v = safeVolume(vol, this._scVolumeLevel);
    log("player", "setSyncedVolume → v=%.2f", v);
    this.audio.volume = v;
    this.audio.muted = v <= 0.001;
    this._isUpdatingSpotifyRange = true;
    try {
      if (
        typeof Spicetify !== "undefined" &&
        Spicetify.Player
      ) {
        Spicetify.Player.setVolume(v);
      }
    } catch (e) {
      logError("player", "Spicetify.Player.setVolume failed:", e);
    }
    setTimeout(() => { 
      this._isUpdatingSpotifyRange = false;
      this._lastCheckedVolume = v;
      log("player", "setSyncedVolume guard released");
    }, 200);
  }

  async next(): Promise<void> {
    return this.requestAdvance("manual");
  }

  async prev(): Promise<void> {
    if (this.audio.currentTime > 3 || this.queueIndex <= 0) {
      log(
        "player",
        "prev — restarting current track (t=%.1fs, idx=%d)",
        this.audio.currentTime,
        this.queueIndex,
      );
      this._resumePendingSeek = null;
      this.audio.currentTime = 0;
      this.persistPlaybackResume(true);
      this.linuxMediaSession.syncPosition(true);
      return;
    }
    const previousIndex = previousAvailableTrackIndex(
      this.queue.map((entry) => entry.track),
      this.queueIndex,
    );
    if (previousIndex === null) {
      this._resumePendingSeek = null;
      this.audio.currentTime = 0;
      this.persistPlaybackResume(true);
      this.linuxMediaSession.syncPosition(true);
      return;
    }
    this.queueIndex = previousIndex;
    this.maybePrefetchQueueForIndex(previousIndex);
    log(
      "player",
      "prev → queue[%d/%d] '%s'",
      this.queueIndex,
      this.queue.length - 1,
      this.queue[this.queueIndex]?.track.title,
    );
    await this.loadTrack(this.queue[this.queueIndex].track);
  }

  destroy(): void {
    // Hot extension teardown is not a user Stop. Preserve the current paused
    // source just like a normal Spotify window close would.
    this._resumeUnloading = true;
    this.cancelSpotifyCoverRecovery();
    this.persistPlaybackResume(true);
    this.detachQueueSource();
    this._resumeInitializationGeneration++;
    this.restoreNativeBar();
    document.removeEventListener(
      "click",
      this._onNativeSpotifyPlaybackClick,
      true,
    );
    document.removeEventListener(
      "contextmenu",
      this._onStaleSpotifyContextMenu,
      true,
    );
    document.removeEventListener(
      "pointerdown",
      this._onSoftwareAacUnlockIntent,
      true,
    );
    document.removeEventListener(
      "keydown",
      this._onSoftwareAacUnlockIntent,
      true,
    );
    document.removeEventListener(
      "click",
      this._onStaleSpotifyMetadataInteraction,
      true,
    );
    document.removeEventListener(
      "auxclick",
      this._onStaleSpotifyMetadataInteraction,
      true,
    );
    document.removeEventListener(
      "contextmenu",
      this._onStaleSpotifyMetadataInteraction,
      true,
    );
    document.removeEventListener(
      "pointermove",
      this._onSourceBadgeDocumentPointerMove,
    );
    this.stopSourceBadgeCinemaObserver();
    window.removeEventListener("blur", this._onSourceBadgeWindowBlur);
    window.removeEventListener("focus", this._onFollowingStatusRefresh);
    document.removeEventListener(
      "visibilitychange",
      this._onFollowingStatusRefresh,
    );
    window.removeEventListener("focus", this._onLikeStatusRefresh);
    document.removeEventListener(
      "visibilitychange",
      this._onLikeStatusRefresh,
    );
    window.removeEventListener("pagehide", this._onResumePageHide);
    window.removeEventListener("pageshow", this._onResumePageShow);
    window.removeEventListener("beforeunload", this._onResumeBeforeUnload);
    document.removeEventListener(
      "visibilitychange",
      this._onResumeVisibilityChange,
    );
    window.removeEventListener("wavelink:settings", this._onSettingsChanged);
    this._unsubscribeLikedTrackStatus?.();
    this._unsubscribeLikedTrackStatus = null;
    this._artistProfileCache.clear();
    this._activeArtistProfile = null;
    this.linuxMediaSession.destroy();
    log("player", "destroy — cleaning up");
    this.stopTimer();
    if (this.badgeTimer !== null) {
      clearInterval(this.badgeTimer);
      this.badgeTimer = null;
    }
    // Restore Spotify's volume profile visually
    this.restoreSpotifyVolumeProfile();
    this.resetMediaSource();
    const softwareAacContext = this.softwareAacContext;
    this.softwareAacContext = null;
    if (softwareAacContext && softwareAacContext.state !== "closed") {
      void softwareAacContext.close().catch(() => undefined);
    }
    this.audio.remove();
    this.muteSpotifyAudio(false);
    this._sourceBadge?.remove();
    this._sourceBadge = null;
    this._sourceBadgeHoverReturnZone = null;
    this._globalControls?.remove();
    this._globalControls = null;
    this._nativeControls?.remove();
    this._nativeControls = null;
    this._nativeControlsHost?.classList.remove(
      "wavelink-native-controls-host",
    );
    this._nativeControlsHost = null;
    if (this._nativeControlsPositionFrame !== null) {
      window.cancelAnimationFrame(this._nativeControlsPositionFrame);
      this._nativeControlsPositionFrame = null;
    }
    this._nativeQueuePopover?.remove();
    this._nativeQueuePopover = null;
    this._nativeQueueOpen = false;
    if (this._nativeQueueScrollFrame !== null) {
      window.cancelAnimationFrame(this._nativeQueueScrollFrame);
      this._nativeQueueScrollFrame = null;
    }
    if (this._nativeDismissBound) {
      document.removeEventListener(
        "pointerdown",
        this._onNativeDocumentPointerDown,
        true,
      );
      document.removeEventListener(
        "keydown",
        this._onNativeDocumentKeyDown,
        true,
      );
      window.removeEventListener("resize", this._onNativeWindowResize);
      this._nativeDismissBound = false;
    }
    document.getElementById("wavelink-global-player-styles")?.remove();
    document.getElementById("wavelink-player-styles")?.remove();
    this._progressOverlay?.remove();
    this._progressOverlay = null;
    this._progressFill = null;
    this._progressThumb = null;
    document.body.classList.remove("sc-active", "sc-playing");
    this._cachedPosEl = null;
    this._cachedDurEl = null;
    this._cachedRangeEl = null;
    this.listeners.clear();
  }
}

// Cross-bundle singleton. The custom app and the startup extension are compiled
// into SEPARATE esbuild bundles, so a plain module-level `new` would create TWO
// players (two <audio> elements, doubled Spotify hooks). Stash the instance on
// window so whichever bundle loads first creates it and the other reuses it.
const _w = window as unknown as { __waveLinkPlayer?: SoundCloudPlayer };
export const player: SoundCloudPlayer =
  _w.__waveLinkPlayer ?? (_w.__waveLinkPlayer = new SoundCloudPlayer());
