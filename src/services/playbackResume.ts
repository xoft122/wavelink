import type {
  SCPlaylist,
  SCTrack,
  SCUser,
  SoundCloudUrn,
} from "../types/soundcloud";
import type { WaveLinkNavigationTarget } from "./navigation";

export const PLAYBACK_RESUME_STORAGE_KEY = "wavelink:playback-resume:v1";
export const MAX_PLAYBACK_RESUME_QUEUE_ENTRIES = 100;

const PLAYBACK_RESUME_VERSION = 1 as const;
const MAX_SERIALIZED_BYTES = 256 * 1024;
const MAX_TRACK_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;
const MAX_STATE_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
const END_RESTART_WINDOW_MS = 3_000;

export interface PlaybackResumeContext {
  label: string;
  target?: WaveLinkNavigationTarget;
}

export interface PlaybackResumeQueueEntry {
  track: SCTrack;
  context: PlaybackResumeContext;
}

export interface PlaybackResumeState {
  version: typeof PLAYBACK_RESUME_VERSION;
  ownerUrn: SoundCloudUrn;
  savedAt: number;
  positionMs: number;
  queue: PlaybackResumeQueueEntry[];
  queueIndex: number;
}

export interface PlaybackResumeSaveInput {
  ownerUrn: unknown;
  positionMs?: number;
  positionSeconds?: number;
  queue: readonly PlaybackResumeQueueEntry[];
  queueIndex: number;
}

interface StorageBackend {
  get(key: string): unknown;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function storageBackends(): StorageBackend[] {
  const backends: StorageBackend[] = [];

  try {
    if (
      typeof Spicetify !== "undefined" &&
      Spicetify.Platform.LocalStorageAPI
    ) {
      const storage = Spicetify.Platform.LocalStorageAPI;
      backends.push({
        get: (key) => storage.getItem(key),
        set: (key, value) => storage.setItem(key, value),
        remove: (key) => storage.clearItem(key),
      });
    }
  } catch {}

  try {
    if (typeof Spicetify !== "undefined" && Spicetify.LocalStorage) {
      backends.push({
        get: (key) => Spicetify.LocalStorage.get(key),
        set: (key, value) => Spicetify.LocalStorage.set(key, value),
        remove: (key) => Spicetify.LocalStorage.remove(key),
      });
    }
  } catch {}

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      backends.push({
        get: (key) => window.localStorage.getItem(key),
        set: (key, value) => window.localStorage.setItem(key, value),
        remove: (key) => window.localStorage.removeItem(key),
      });
    }
  } catch {}

  return backends;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? [...normalized].slice(0, limit).join("") : null;
}

function safeNonNegativeInteger(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), maximum);
}

function canonicalNumericUrn(
  value: unknown,
  entity: "users" | "tracks" | "playlists",
): SoundCloudUrn | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value)
    .trim()
    .match(new RegExp(`^(?:soundcloud:${entity}:)?([0-9]{1,32})$`));
  return match ? `soundcloud:${entity}:${match[1]}` : null;
}

export function canonicalPlaybackResumeOwnerUrn(
  value: unknown,
): SoundCloudUrn | null {
  return canonicalNumericUrn(value, "users");
}

function safeSoundCloudPageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    const pathSegments = url.pathname.split("/").filter(Boolean);
    const containsPrivateShareToken = pathSegments.some((segment) =>
      /^s-[A-Za-z0-9_-]{5,}$/i.test(segment),
    );
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      containsPrivateShareToken ||
      (url.hostname !== "soundcloud.com" &&
        url.hostname !== "www.soundcloud.com")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeSoundCloudImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.hostname !== "sndcdn.com" &&
        !url.hostname.endsWith(".sndcdn.com"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function sanitizeUser(value: unknown): SCUser | null {
  if (!isRecord(value)) return null;
  const urn = canonicalNumericUrn(value.urn ?? value.id, "users");
  const username = safeText(value.username, 300);
  if (!urn || !username) return null;

  return {
    id: urn,
    urn,
    username,
    avatar_url: safeSoundCloudImageUrl(value.avatar_url) ?? "",
    profile_header_url: safeSoundCloudImageUrl(value.profile_header_url),
    permalink_url:
      safeSoundCloudPageUrl(value.permalink_url) ?? "https://soundcloud.com/",
    followers_count: safeNonNegativeInteger(value.followers_count),
    followings_count: safeNonNegativeInteger(value.followings_count),
    track_count: safeNonNegativeInteger(value.track_count),
    playlist_count: safeNonNegativeInteger(value.playlist_count),
    verified: value.verified === true,
    followed_by_user:
      typeof value.followed_by_user === "boolean"
        ? value.followed_by_user
        : undefined,
  };
}

function optionalBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeTrack(value: unknown): SCTrack | null {
  if (!isRecord(value) || value.kind !== "track") return null;
  const urn = canonicalNumericUrn(value.urn ?? value.id, "tracks");
  const title = safeText(value.title, 500);
  const user = sanitizeUser(value.user);
  if (!urn || !title || !user) return null;

  const duration = safeNonNegativeInteger(
    value.duration,
    MAX_TRACK_DURATION_MS,
  );
  const fullDuration = safeNonNegativeInteger(
    value.full_duration,
    MAX_TRACK_DURATION_MS,
  );
  const access =
    value.access === "playable" ||
    value.access === "preview" ||
    value.access === "blocked"
      ? value.access
      : undefined;
  const policy =
    value.policy === "ALLOW" ||
    value.policy === "MONETIZE" ||
    value.policy === "SNIP" ||
    value.policy === "BLOCK"
      ? value.policy
      : undefined;
  const sharing =
    value.sharing === "public" || value.sharing === "private"
      ? value.sharing
      : undefined;
  const publicTrackUrl = safeSoundCloudPageUrl(value.permalink_url);
  const authorizationGeo =
    typeof value.authorization_geo === "string" &&
    /^[A-Za-z]{2}$/.test(value.authorization_geo)
      ? value.authorization_geo.toUpperCase()
      : undefined;

  return {
    id: urn,
    urn,
    title,
    duration,
    full_duration: fullDuration || undefined,
    user,
    artwork_url: safeSoundCloudImageUrl(value.artwork_url),
    // Secret/private share links contain query credentials and are never kept.
    permalink_url:
      sharing === "private"
        ? user.permalink_url
        : publicTrackUrl ?? user.permalink_url,
    kind: "track",
    likes_count: safeNonNegativeInteger(
      value.likes_count ?? value.favoritings_count,
    ),
    playback_count: safeNonNegativeInteger(value.playback_count),
    reposts_count: safeNonNegativeInteger(value.reposts_count),
    comment_count: safeNonNegativeInteger(value.comment_count),
    description: null,
    genre: safeText(value.genre, 500),
    access,
    policy,
    streamable: optionalBoolean(value.streamable),
    has_transcodings: optionalBoolean(value.has_transcodings),
    has_snipped_transcoding: optionalBoolean(value.has_snipped_transcoding),
    has_full_transcoding: optionalBoolean(value.has_full_transcoding),
    full_playable: optionalBoolean(value.full_playable),
    preview_playable: optionalBoolean(value.preview_playable),
    authorization_geo: authorizationGeo,
    sharing,
    user_favorite: optionalBoolean(value.user_favorite),
    reposted_by_user: optionalBoolean(value.reposted_by_user),
  };
}

function sanitizePlaylist(value: unknown): SCPlaylist | null {
  if (!isRecord(value)) return null;
  const urn = canonicalNumericUrn(value.urn ?? value.id, "playlists");
  const title = safeText(value.title, 500);
  const user = sanitizeUser(value.user);
  if (!urn || !title || !user) return null;

  const sharing =
    value.sharing === "public" || value.sharing === "private"
      ? value.sharing
      : undefined;
  const publicPlaylistUrl = safeSoundCloudPageUrl(value.permalink_url);
  const tracksCount = safeNonNegativeInteger(
    value.tracks_count ?? value.track_count,
  );

  return {
    id: urn,
    urn,
    title,
    user,
    artwork_url: safeSoundCloudImageUrl(value.artwork_url),
    tracks: [],
    tracks_count: tracksCount,
    track_count: tracksCount,
    duration: safeNonNegativeInteger(value.duration, MAX_TRACK_DURATION_MS),
    kind: "playlist",
    permalink_url:
      sharing === "private"
        ? user.permalink_url
        : publicPlaylistUrl ?? user.permalink_url,
    likes_count: safeNonNegativeInteger(value.likes_count),
    sharing,
    user_favorite: optionalBoolean(value.user_favorite),
    reposted_by_user: optionalBoolean(value.reposted_by_user),
  };
}

function sanitizeNavigationTarget(
  value: unknown,
): WaveLinkNavigationTarget | undefined {
  if (!isRecord(value)) return undefined;

  if (value.kind === "main") {
    if (
      value.tab !== "home" &&
      value.tab !== "search" &&
      value.tab !== "library" &&
      value.tab !== "settings"
    ) {
      return undefined;
    }
    if (value.tab === "search") {
      const searchTab =
        value.searchTab === "tracks" ||
        value.searchTab === "playlists" ||
        value.searchTab === "users"
          ? value.searchTab
          : undefined;
      // Queries and drafts are deliberately omitted: they can contain copied
      // URLs, client IDs, OAuth values or private-link query credentials.
      return { kind: "main", tab: "search", searchTab };
    }
    if (value.tab === "library") {
      const libraryTab =
        value.libraryTab === "liked-tracks" ||
        value.libraryTab === "playlists" ||
        value.libraryTab === "liked-playlists" ||
        value.libraryTab === "followings"
          ? value.libraryTab
          : undefined;
      return { kind: "main", tab: "library", libraryTab };
    }
    return { kind: "main", tab: value.tab };
  }

  if (value.kind === "user") {
    const user = sanitizeUser(value.user);
    if (!user) return undefined;
    const profileTab =
      value.profileTab === "tracks" ||
      value.profileTab === "playlists" ||
      value.profileTab === "likes"
        ? value.profileTab
        : undefined;
    return { kind: "user", user, profileTab };
  }

  if (value.kind === "playlist") {
    const playlist = sanitizePlaylist(value.playlist);
    return playlist ? { kind: "playlist", playlist } : undefined;
  }

  return undefined;
}

function sanitizeContext(value: unknown): PlaybackResumeContext {
  if (!isRecord(value)) return { label: "SoundCloud" };
  const target = sanitizeNavigationTarget(value.target);
  // Search labels include the raw query in every WaveLink search surface.
  // The target intentionally drops that query above, so the display label
  // must not smuggle a pasted private URL, OAuth value or Client ID back into
  // persistent storage.
  const label =
    target?.kind === "main" && target.tab === "search"
      ? "SoundCloud Search"
      : safeText(value.label, 300) ?? "SoundCloud";
  return target ? { label, target } : { label };
}

function sanitizeQueueEntry(value: unknown): PlaybackResumeQueueEntry | null {
  if (!isRecord(value)) return null;
  const track = sanitizeTrack(value.track);
  if (!track) return null;
  return { track, context: sanitizeContext(value.context) };
}

function safeQueueIndex(value: unknown, length: number): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value < length
    ? value
    : null;
}

function cropAndSanitizeQueue(
  value: unknown,
  indexValue: unknown,
): { queue: PlaybackResumeQueueEntry[]; queueIndex: number } | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const sourceIndex = safeQueueIndex(indexValue, value.length);
  if (sourceIndex === null) return null;

  const windowLength = Math.min(
    value.length,
    MAX_PLAYBACK_RESUME_QUEUE_ENTRIES,
  );
  const start = Math.max(
    0,
    Math.min(
      sourceIndex - Math.floor(windowLength / 2),
      value.length - windowLength,
    ),
  );
  const queue: PlaybackResumeQueueEntry[] = [];
  let queueIndex = -1;
  for (let sourceOffset = start; sourceOffset < start + windowLength; sourceOffset += 1) {
    const entry = sanitizeQueueEntry(value[sourceOffset]);
    if (!entry) {
      if (sourceOffset === sourceIndex) return null;
      continue;
    }
    if (sourceOffset === sourceIndex) queueIndex = queue.length;
    queue.push(entry);
  }

  return queueIndex >= 0 ? { queue, queueIndex } : null;
}

function normalizedPositionMs(value: unknown, durationMs: number): number {
  const parsed = Number(value);
  const position =
    Number.isFinite(parsed) && parsed >= 0
      ? Math.min(Math.floor(parsed), MAX_TRACK_DURATION_MS)
      : 0;
  if (durationMs <= 0) return position;
  const clamped = Math.min(position, durationMs);
  return clamped >= Math.max(0, durationMs - END_RESTART_WINDOW_MS)
    ? 0
    : clamped;
}

/** Convert a stored millisecond offset into a safe HTMLAudioElement offset. */
export function resumePositionSeconds(
  positionMs: unknown,
  durationMs: unknown,
): number {
  const duration = safeNonNegativeInteger(durationMs, MAX_TRACK_DURATION_MS);
  return normalizedPositionMs(positionMs, duration) / 1_000;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) length += 1;
    else if (code <= 0x7ff) length += 2;
    else if (
      code >= 0xd800 &&
      code <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      length += 4;
      index += 1;
    } else length += 3;
  }
  return length;
}

function clearBackends(backends = storageBackends()): void {
  for (const backend of backends) {
    try {
      backend.remove(PLAYBACK_RESUME_STORAGE_KEY);
    } catch {}
  }
}

function persistState(state: PlaybackResumeState): boolean {
  const serialized = JSON.stringify(state);
  if (utf8ByteLength(serialized) > MAX_SERIALIZED_BYTES) return false;

  const backends = storageBackends();
  let selected: StorageBackend | null = null;
  for (const backend of backends) {
    try {
      backend.set(PLAYBACK_RESUME_STORAGE_KEY, serialized);
      selected = backend;
      break;
    } catch {}
  }
  if (!selected) return false;

  // Keep one authoritative account-scoped copy in priority order.
  for (const backend of backends) {
    if (backend === selected) continue;
    try {
      backend.remove(PLAYBACK_RESUME_STORAGE_KEY);
    } catch {}
  }
  // Legacy and browser wrappers can alias the same store. Reassert the chosen
  // copy after cleanup so alias removal cannot accidentally erase it.
  try {
    selected.set(PLAYBACK_RESUME_STORAGE_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}

function strictTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function parseState(
  raw: unknown,
  expectedOwnerUrn: SoundCloudUrn,
  now: number,
): PlaybackResumeState | null {
  if (
    typeof raw !== "string" ||
    !raw ||
    utf8ByteLength(raw) > MAX_SERIALIZED_BYTES
  ) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== PLAYBACK_RESUME_VERSION) {
      return null;
    }
    const ownerUrn = canonicalPlaybackResumeOwnerUrn(value.ownerUrn);
    const savedAt = strictTimestamp(value.savedAt);
    if (
      !ownerUrn ||
      ownerUrn !== value.ownerUrn ||
      ownerUrn !== expectedOwnerUrn ||
      savedAt === null ||
      savedAt > now + MAX_FUTURE_SKEW_MS ||
      savedAt < now - MAX_STATE_AGE_MS
    ) {
      return null;
    }

    const normalizedQueue = cropAndSanitizeQueue(value.queue, value.queueIndex);
    if (!normalizedQueue) return null;
    const duration = normalizedQueue.queue[normalizedQueue.queueIndex].track.duration;
    const positionMs = normalizedPositionMs(value.positionMs, duration);
    return {
      version: PLAYBACK_RESUME_VERSION,
      ownerUrn,
      savedAt,
      positionMs,
      ...normalizedQueue,
    };
  } catch {
    return null;
  }
}

export function savePlaybackResumeState(
  input: PlaybackResumeSaveInput,
  now = Date.now(),
): boolean {
  const ownerUrn = canonicalPlaybackResumeOwnerUrn(input.ownerUrn);
  const savedAt = strictTimestamp(now);
  const normalizedQueue = cropAndSanitizeQueue(input.queue, input.queueIndex);
  if (!ownerUrn || savedAt === null || !normalizedQueue) return false;

  const rawPositionMs =
    input.positionMs !== undefined
      ? input.positionMs
      : Number(input.positionSeconds) * 1_000;
  const duration = normalizedQueue.queue[normalizedQueue.queueIndex].track.duration;
  const state: PlaybackResumeState = {
    version: PLAYBACK_RESUME_VERSION,
    ownerUrn,
    savedAt,
    positionMs: normalizedPositionMs(rawPositionMs, duration),
    ...normalizedQueue,
  };
  return persistState(state);
}

export function loadPlaybackResumeState(
  ownerUrnValue: unknown,
  now = Date.now(),
): PlaybackResumeState | null {
  const ownerUrn = canonicalPlaybackResumeOwnerUrn(ownerUrnValue);
  const safeNow = strictTimestamp(now);
  const backends = storageBackends();
  if (!ownerUrn || safeNow === null) {
    clearBackends(backends);
    return null;
  }

  for (const backend of backends) {
    let raw: unknown;
    try {
      raw = backend.get(PLAYBACK_RESUME_STORAGE_KEY);
    } catch {
      continue;
    }
    if (raw === null || raw === undefined) continue;

    // The first readable non-empty backend is authoritative. Falling through
    // to a lower-priority stale copy after corruption or an account mismatch
    // could restore another account's playback state.
    const state = parseState(raw, ownerUrn, safeNow);
    if (!state) {
      clearBackends(backends);
      return null;
    }
    // Normalize/migrate the valid copy to the preferred writable backend.
    persistState(state);
    return state;
  }
  return null;
}

export function clearPlaybackResumeState(): void {
  clearBackends();
}
