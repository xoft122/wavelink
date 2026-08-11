import type { SCTrack, SCUser, SoundCloudUrn } from "../types/soundcloud";

import { canonicalPlayHistoryTrackUrn } from "./playHistoryStatus";

export const LOCAL_PLAY_HISTORY_KEY = "wavelink:local-play-history:v1";
export const LOCAL_PLAY_HISTORY_CHANGED_EVENT =
  "wavelink:local-play-history-changed";
export const MAX_LOCAL_PLAY_HISTORY_ENTRIES = 100;

const LOCAL_PLAY_HISTORY_VERSION = 1 as const;
const MAX_STORED_HISTORY_LENGTH = 512_000;
const MAX_TRACK_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;

export interface LocalPlayHistoryEntry {
  playedAt: number;
  track: SCTrack;
}

interface LocalPlayHistoryStore {
  version: typeof LOCAL_PLAY_HISTORY_VERSION;
  entries: LocalPlayHistoryEntry[];
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

function persistStore(store: LocalPlayHistoryStore): boolean {
  const serialized = JSON.stringify(store);
  if (serialized.length > MAX_STORED_HISTORY_LENGTH) return false;

  const backends = storageBackends();
  let selected: StorageBackend | null = null;
  for (const backend of backends) {
    try {
      backend.set(LOCAL_PLAY_HISTORY_KEY, serialized);
      selected = backend;
      break;
    } catch {}
  }

  if (!selected) return false;

  // Keep one authoritative copy. Platform storage is scoped to the current
  // Spotify account and is preferred whenever this Spicetify build exposes it.
  for (const backend of backends) {
    if (backend === selected) continue;
    try {
      backend.remove(LOCAL_PLAY_HISTORY_KEY);
    } catch {}
  }

  // Legacy Spicetify storage can wrap the same browser storage object. Restore
  // the selected value in case cleanup through an alias removed it too.
  try {
    selected.set(LOCAL_PLAY_HISTORY_KEY, serialized);
  } catch {
    return false;
  }
  return true;
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

function safeNonNegativeNumber(
  value: unknown,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.min(Math.floor(parsed), maximum);
}

function canonicalUserUrn(value: unknown): SoundCloudUrn | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const match = String(value)
    .trim()
    .match(/^(?:soundcloud:users:)?([0-9]{1,32})$/);
  return match ? `soundcloud:users:${match[1]}` : null;
}

function safeSoundCloudPageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.hostname !== "soundcloud.com" &&
        !url.hostname.endsWith(".soundcloud.com"))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function safeSoundCloudImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
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
  const urn = canonicalUserUrn(value.urn ?? value.id);
  if (!urn) return null;

  return {
    id: urn,
    urn,
    username: safeText(value.username, 300) ?? "SoundCloud user",
    avatar_url: safeSoundCloudImageUrl(value.avatar_url) ?? "",
    permalink_url:
      safeSoundCloudPageUrl(value.permalink_url) ?? "https://soundcloud.com/",
    city: safeText(value.city, 300),
    country: safeText(value.country, 300),
    description: safeText(value.description, 5_000),
    followers_count: safeNonNegativeNumber(value.followers_count),
    followings_count: safeNonNegativeNumber(value.followings_count),
    track_count: safeNonNegativeNumber(value.track_count),
    playlist_count: safeNonNegativeNumber(value.playlist_count),
    verified: value.verified === true,
    followed_by_user:
      typeof value.followed_by_user === "boolean"
        ? value.followed_by_user
        : undefined,
  };
}

function sanitizeTrack(value: unknown): SCTrack | null {
  if (!isRecord(value)) return null;
  const urn = canonicalPlayHistoryTrackUrn(value.urn ?? value.id);
  const user = sanitizeUser(value.user);
  if (!urn || !user) return null;

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

  return {
    id: urn,
    urn,
    title: safeText(value.title, 500) ?? "Untitled track",
    duration: safeNonNegativeNumber(value.duration, MAX_TRACK_DURATION_MS),
    user,
    artwork_url: safeSoundCloudImageUrl(value.artwork_url),
    // Never persist a private/secret track link. Its uploader profile remains
    // a useful and safe destination while playback resolves from the URN.
    permalink_url:
      sharing === "private"
        ? user.permalink_url
        : publicTrackUrl ?? user.permalink_url,
    kind: "track",
    likes_count: safeNonNegativeNumber(
      value.likes_count ?? value.favoritings_count,
    ),
    playback_count: safeNonNegativeNumber(value.playback_count),
    reposts_count: safeNonNegativeNumber(value.reposts_count),
    comment_count: safeNonNegativeNumber(value.comment_count),
    description: safeText(value.description, 5_000),
    genre: safeText(value.genre, 500),
    access,
    policy,
    streamable:
      typeof value.streamable === "boolean" ? value.streamable : undefined,
    has_transcodings:
      typeof value.has_transcodings === "boolean"
        ? value.has_transcodings
        : undefined,
    sharing,
    user_favorite: value.user_favorite === true,
    reposted_by_user: value.reposted_by_user === true,
  };
}

function safePlayedAt(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseStore(value: unknown): LocalPlayHistoryEntry[] | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > MAX_STORED_HISTORY_LENGTH
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      parsed.version !== LOCAL_PLAY_HISTORY_VERSION ||
      !Array.isArray(parsed.entries)
    ) {
      return null;
    }

    const entries: LocalPlayHistoryEntry[] = [];
    const seen = new Set<SoundCloudUrn>();
    for (const candidate of parsed.entries) {
      if (!isRecord(candidate)) continue;
      const playedAt = safePlayedAt(candidate.playedAt);
      const track = sanitizeTrack(candidate.track);
      if (playedAt === null || !track || seen.has(track.urn)) continue;
      seen.add(track.urn);
      entries.push({ playedAt, track });
      if (entries.length >= MAX_LOCAL_PLAY_HISTORY_ENTRIES) break;
    }
    return entries;
  } catch {
    return null;
  }
}

export function loadLocalPlayHistory(): LocalPlayHistoryEntry[] {
  for (const backend of storageBackends()) {
    try {
      const entries = parseStore(backend.get(LOCAL_PLAY_HISTORY_KEY));
      if (entries) return entries;
    } catch {}
  }
  return [];
}

export function recordLocalPlayHistory(
  track: SCTrack,
  playedAt = Date.now(),
): boolean {
  const safeTrack = sanitizeTrack(track);
  const safeTimestamp = safePlayedAt(playedAt);
  if (!safeTrack || safeTimestamp === null) return false;

  const previous = loadLocalPlayHistory();
  const entries = [
    { playedAt: safeTimestamp, track: safeTrack },
    ...previous.filter((entry) => entry.track.urn !== safeTrack.urn),
  ].slice(0, MAX_LOCAL_PLAY_HISTORY_ENTRIES);

  if (
    !persistStore({
      version: LOCAL_PLAY_HISTORY_VERSION,
      entries,
    })
  ) {
    return false;
  }

  try {
    window.dispatchEvent(new Event(LOCAL_PLAY_HISTORY_CHANGED_EVENT));
  } catch {}
  return true;
}

export function removeLocalPlayHistoryTrack(
  trackUrn: unknown,
  playedAt: unknown,
): boolean {
  const canonicalUrn = canonicalPlayHistoryTrackUrn(trackUrn);
  const safeTimestamp = safePlayedAt(playedAt);
  if (!canonicalUrn || safeTimestamp === null) return false;

  const previous = loadLocalPlayHistory();
  const entries = previous.filter(
    (entry) =>
      entry.track.urn !== canonicalUrn || entry.playedAt !== safeTimestamp,
  );
  if (entries.length === previous.length) return false;

  if (
    !persistStore({
      version: LOCAL_PLAY_HISTORY_VERSION,
      entries,
    })
  ) {
    return false;
  }

  try {
    window.dispatchEvent(new Event(LOCAL_PLAY_HISTORY_CHANGED_EVENT));
  } catch {}
  return true;
}

export function subscribeLocalPlayHistoryChanged(
  handler: () => void,
  target: EventTarget = window,
): () => void {
  target.addEventListener(LOCAL_PLAY_HISTORY_CHANGED_EVENT, handler);
  return () =>
    target.removeEventListener(LOCAL_PLAY_HISTORY_CHANGED_EVENT, handler);
}
