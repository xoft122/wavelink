export interface LinuxMediaSessionTimeline {
  duration: number;
  position: number;
  playbackRate: number;
  isPlaying: boolean;
}

export interface LinuxMediaSessionTrack {
  key: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
}

export interface LinuxMediaSessionCallbacks {
  play(): void | Promise<void>;
  pause(): void;
  stop(): void;
  next(): void | Promise<void>;
  previous(): void | Promise<void>;
  seekTo(seconds: number): void;
  timeline(): LinuxMediaSessionTimeline;
}

type LinuxMediaSessionAction =
  | "play"
  | "pause"
  | "stop"
  | "nexttrack"
  | "previoustrack"
  | "seekto"
  | "seekforward"
  | "seekbackward";

interface LinuxMediaSessionActionDetails {
  seekTime?: number;
  seekOffset?: number;
  fastSeek?: boolean;
}

type LinuxMediaSessionActionHandler = (
  details: LinuxMediaSessionActionDetails,
) => void;

interface LinuxMediaSessionPort {
  metadata: unknown | null;
  playbackState: "none" | "paused" | "playing";
  setActionHandler(
    action: LinuxMediaSessionAction,
    handler: LinuxMediaSessionActionHandler | null,
  ): void;
  setPositionState(state?: {
    duration: number;
    playbackRate: number;
    position: number;
  }): void;
}

interface LinuxNavigatorPort {
  platform?: string;
  userAgent?: string;
  userAgentData?: { platform?: string };
  mediaSession?: LinuxMediaSessionPort;
}

interface MediaMetadataConstructorPort {
  new (init: {
    title?: string;
    artist?: string;
    album?: string;
    artwork?: Array<{ src: string }>;
  }): unknown;
}

export interface LinuxMediaSessionEnvironment {
  navigator?: LinuxNavigatorPort | null;
  mediaMetadataConstructor?: MediaMetadataConstructorPort | null;
  now?: () => number;
}

const ACTIONS: readonly LinuxMediaSessionAction[] = [
  "play",
  "pause",
  "stop",
  "nexttrack",
  "previoustrack",
  "seekto",
  "seekforward",
  "seekbackward",
];

const POSITION_UPDATE_INTERVAL_MS = 1_000;
const DEFAULT_SEEK_SECONDS = 10;

function defaultNavigator(): LinuxNavigatorPort | null {
  try {
    return typeof navigator === "undefined"
      ? null
      : (navigator as unknown as LinuxNavigatorPort);
  } catch {
    return null;
  }
}

function defaultMediaMetadataConstructor(): MediaMetadataConstructorPort | null {
  try {
    return typeof MediaMetadata === "function"
      ? (MediaMetadata as unknown as MediaMetadataConstructorPort)
      : null;
  } catch {
    return null;
  }
}

/**
 * Chromium exposes an active HTMLMediaElement through MPRIS on desktop Linux.
 * Keep this gate deliberately strict: the same Navigator belongs to Spotify on
 * Windows/macOS, where taking it over would replace Spotify's one OS session.
 */
export function isLinuxDesktopMediaSessionEnvironment(
  environment: LinuxMediaSessionEnvironment = {},
): boolean {
  const navigatorPort =
    environment.navigator === undefined
      ? defaultNavigator()
      : environment.navigator;
  const metadataConstructor =
    environment.mediaMetadataConstructor === undefined
      ? defaultMediaMetadataConstructor()
      : environment.mediaMetadataConstructor;
  if (
    !navigatorPort?.mediaSession ||
    typeof navigatorPort.mediaSession.setActionHandler !== "function" ||
    typeof metadataConstructor !== "function"
  ) {
    return false;
  }

  const userAgent = String(navigatorPort.userAgent ?? "");
  if (/Android/i.test(userAgent)) return false;
  const platform = String(
    navigatorPort.userAgentData?.platform ?? navigatorPort.platform ?? "",
  );
  return /^Linux(?:\b|\s|_)/i.test(platform) || /\bLinux\b/i.test(userAgent);
}

function cleanDisplayText(value: string, fallback: string): string {
  const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeOffset(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export class LinuxMediaSessionBridge {
  private readonly navigatorPort: LinuxNavigatorPort | null;
  private readonly metadataConstructor: MediaMetadataConstructorPort | null;
  private readonly mediaSession: LinuxMediaSessionPort | null;
  private readonly callbacks: LinuxMediaSessionCallbacks;
  private readonly now: () => number;
  private readonly enabled: boolean;
  private readonly registeredActions = new Set<LinuxMediaSessionAction>();

  private owned = false;
  private destroyed = false;
  private generation = 0;
  private metadataSignature = "";
  private lastPositionUpdateAt = 0;
  private positionStateActive = false;

  constructor(
    callbacks: LinuxMediaSessionCallbacks,
    environment: LinuxMediaSessionEnvironment = {},
  ) {
    this.callbacks = callbacks;
    this.navigatorPort =
      environment.navigator === undefined
        ? defaultNavigator()
        : environment.navigator;
    this.metadataConstructor =
      environment.mediaMetadataConstructor === undefined
        ? defaultMediaMetadataConstructor()
        : environment.mediaMetadataConstructor;
    this.now = environment.now ?? Date.now;
    this.enabled = isLinuxDesktopMediaSessionEnvironment({
      navigator: this.navigatorPort,
      mediaMetadataConstructor: this.metadataConstructor,
    });
    this.mediaSession = this.enabled
      ? (this.navigatorPort?.mediaSession ?? null)
      : null;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  get isOwned(): boolean {
    return this.owned;
  }

  activate(track: LinuxMediaSessionTrack): boolean {
    if (!this.enabled || this.destroyed || !this.mediaSession) return false;
    if (!this.owned) {
      this.owned = true;
      // The Navigator has one MediaSession. Clear any position left by the
      // previous browser-owned item before publishing WaveLink metadata.
      try {
        this.mediaSession.setPositionState();
      } catch {}
      this.positionStateActive = false;
      this.installActionHandlers(++this.generation);
    }

    const metadata = {
      title: cleanDisplayText(track.title, "Unknown track"),
      artist: cleanDisplayText(track.artist, "SoundCloud"),
      album: cleanDisplayText(
        track.album ?? "WaveLink · SoundCloud",
        "WaveLink · SoundCloud",
      ),
      artworkUrl: track.artworkUrl?.trim() ?? "",
      key: track.key,
    };
    const signature = JSON.stringify(metadata);
    if (signature !== this.metadataSignature && this.metadataConstructor) {
      const init: {
        title: string;
        artist: string;
        album: string;
        artwork?: Array<{ src: string }>;
      } = {
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
      };
      if (metadata.artworkUrl) {
        init.artwork = [{ src: metadata.artworkUrl }];
      }
      try {
        this.mediaSession.metadata = new this.metadataConstructor(init);
        this.metadataSignature = signature;
      } catch {
        // A shell/CEF may reject a particular artwork scheme. Keep the useful
        // text metadata instead of losing the whole Linux media session.
        try {
          delete init.artwork;
          this.mediaSession.metadata = new this.metadataConstructor(init);
          this.metadataSignature = signature;
        } catch {
          try {
            this.mediaSession.metadata = null;
          } catch {}
        }
      }
    }
    this.syncPlayback();
    return true;
  }

  syncPlayback(): void {
    if (!this.owned || !this.mediaSession) return;
    const timeline = this.readTimeline();
    try {
      this.mediaSession.playbackState = timeline.isPlaying
        ? "playing"
        : "paused";
    } catch {}
    this.syncPosition(true);
  }

  syncPosition(force = false): void {
    if (!this.owned || !this.mediaSession) return;
    const now = this.now();
    if (
      !force &&
      now - this.lastPositionUpdateAt < POSITION_UPDATE_INTERVAL_MS
    ) {
      return;
    }
    const timeline = this.readTimeline();
    if (!(timeline.duration > 0)) {
      if (this.positionStateActive) {
        try {
          this.mediaSession.setPositionState();
        } catch {}
        this.positionStateActive = false;
      }
      return;
    }
    try {
      this.mediaSession.setPositionState({
        duration: timeline.duration,
        playbackRate: timeline.playbackRate,
        position: timeline.position,
      });
      this.positionStateActive = true;
      this.lastPositionUpdateAt = now;
    } catch {}
  }

  release(): void {
    if (!this.enabled || !this.owned || !this.mediaSession) return;
    this.owned = false;
    ++this.generation;
    for (const action of this.registeredActions) {
      try {
        this.mediaSession.setActionHandler(action, null);
      } catch {}
    }
    this.registeredActions.clear();
    try {
      this.mediaSession.playbackState = "none";
    } catch {}
    try {
      this.mediaSession.setPositionState();
    } catch {}
    try {
      this.mediaSession.metadata = null;
    } catch {}
    this.positionStateActive = false;
    this.metadataSignature = "";
    this.lastPositionUpdateAt = 0;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.release();
    this.destroyed = true;
  }

  private installActionHandlers(generation: number): void {
    if (!this.mediaSession) return;
    const guarded = (
      callback: (details: LinuxMediaSessionActionDetails) => void,
    ): LinuxMediaSessionActionHandler => (details) => {
      if (!this.owned || generation !== this.generation) return;
      try {
        callback(details ?? {});
      } catch {}
    };
    const handlers: Record<
      LinuxMediaSessionAction,
      LinuxMediaSessionActionHandler
    > = {
      play: guarded(() => this.invoke(() => this.callbacks.play())),
      pause: guarded(() => this.callbacks.pause()),
      stop: guarded(() => this.callbacks.stop()),
      nexttrack: guarded(() => this.invoke(() => this.callbacks.next())),
      previoustrack: guarded(() =>
        this.invoke(() => this.callbacks.previous())
      ),
      seekto: guarded((details) => {
        if (Number.isFinite(details.seekTime)) {
          this.seekTo(details.seekTime as number);
        }
      }),
      seekforward: guarded((details) => {
        const timeline = this.readTimeline();
        const offset = nonNegativeOffset(
          details.seekOffset,
          DEFAULT_SEEK_SECONDS,
        );
        this.seekTo(timeline.position + offset);
      }),
      seekbackward: guarded((details) => {
        const timeline = this.readTimeline();
        const offset = nonNegativeOffset(
          details.seekOffset,
          DEFAULT_SEEK_SECONDS,
        );
        this.seekTo(timeline.position - offset);
      }),
    };
    for (const action of ACTIONS) {
      try {
        this.mediaSession.setActionHandler(action, handlers[action]);
        this.registeredActions.add(action);
      } catch {
        // Individual actions vary between Spotify CEF/Chromium versions.
      }
    }
  }

  private seekTo(seconds: number): void {
    const timeline = this.readTimeline();
    if (!(timeline.duration > 0) || !Number.isFinite(seconds)) return;
    const target = Math.max(0, Math.min(timeline.duration, seconds));
    this.callbacks.seekTo(target);
    this.lastPositionUpdateAt = 0;
    this.syncPosition(true);
  }

  private invoke(callback: () => void | Promise<void>): void {
    try {
      const result = callback();
      if (result && typeof (result as Promise<void>).then === "function") {
        void Promise.resolve(result).catch(() => {});
      }
    } catch {}
  }

  private readTimeline(): LinuxMediaSessionTimeline {
    let source: LinuxMediaSessionTimeline;
    try {
      source = this.callbacks.timeline();
    } catch {
      source = {
        duration: 0,
        position: 0,
        playbackRate: 1,
        isPlaying: false,
      };
    }
    const duration = finitePositive(Number(source.duration), 0);
    const rawPosition = Number(source.position);
    const position = duration > 0
      ? Math.max(
          0,
          Math.min(duration, Number.isFinite(rawPosition) ? rawPosition : 0),
        )
      : 0;
    return {
      duration,
      position,
      playbackRate: finitePositive(Number(source.playbackRate), 1),
      isPlaying: source.isPlaying === true,
    };
  }
}

export function createLinuxMediaSessionBridge(
  callbacks: LinuxMediaSessionCallbacks,
  environment: LinuxMediaSessionEnvironment = {},
): LinuxMediaSessionBridge {
  return new LinuxMediaSessionBridge(callbacks, environment);
}
