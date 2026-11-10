import {
  SCCollection,
  SCLikedTrack,
  SCMediaSource,
  SCPlaylist,
  SCPlaylistMutation,
  SCSearchResult,
  SCSession,
  SCSettings,
  SCStreamItem,
  SCTrack,
  SCUser,
  SoundCloudUrn,
} from "../types/soundcloud";
import { clearSettings, loadSettings } from "./auth";
import {
  DirectNormalizer,
  type DirectMediaResolveOptions,
  DirectRequestOptions,
  DirectSoundCloudCredentials,
  DirectSoundCloudError,
  SOUNDCLOUD_WEB_LEGACY_BASE,
  createDirectMediaSource,
  directSoundCloudRequest,
  isDirectSoundCloudAvailable,
  normalizeCollection,
  normalizeFeedCollection,
  normalizeFeedItem,
  normalizeLikedTrack,
  normalizeLikedTrackCollection,
  normalizeLikedPlaylistCollection,
  normalizePlaylist,
  normalizePlaylistCollection,
  normalizeTrack,
  normalizeTrackCollection,
  normalizeUser,
  normalizeUserCollection,
  playlistEntityNormalizer,
  likedPlaylistEntityNormalizer,
  sanitizeNextHref,
  setDirectSoundCloudCredentialProvider,
  soundCloudNumericId,
  trackEntityNormalizer,
  userEntityNormalizer,
  verifyDirectCredentials,
} from "./directSoundcloud";
import { log, warn } from "./debug";
import {
  canonicalFollowingUserId,
  collectFollowingUserIds,
  createFollowingStatusCache,
} from "./followingStatus";
import {
  canonicalPlayHistoryTrackUrn,
  publishPlayHistoryRecorded,
} from "./playHistoryStatus";
import {
  canonicalLikedPlaylistId,
  collectLikedPlaylistIds,
} from "./likedPlaylistStatus";
import {
  createPaginatedTrackSource,
  PaginatedTrackSource,
} from "./paginatedTrackSource";
import {
  classifyTrackAvailability,
  getConsumerProductAvailability,
  normalizeConsumerProductAvailability,
  prepareConsumerProductAvailability,
  resetConsumerProductAvailability,
  setConsumerProductAvailability,
} from "./trackAvailability";
import { WAVELINK_VERSION } from "../version";

const SOUNDCLOUD_WEB_APP_VERSION = 1_785_149_423;
const LIKED_TRACK_IDS_TTL_MS = 5 * 60 * 1_000;
const CURSOR_PREFIX = "wavelink-direct:";

let _settings: SCSettings = loadSettings();
let _currentUser: SCUser | null = null;
let _currentUserCredentials: DirectSoundCloudCredentials | null = null;
let _consumerProductGeneration = 0;
let _likedTrackIdsGeneration = 0;
let _likedTrackIdsCache: {
  key: string;
  expiresAt: number;
  ids: ReadonlySet<SoundCloudUrn>;
} | null = null;
let _likedTrackIdsInFlight: {
  key: string;
  generation: number;
  promise: Promise<Set<SoundCloudUrn>>;
} | null = null;

export interface DebugEntry {
  ts: number;
  method: string;
  endpoint: string;
  status: number;
  durationMs: number;
  body: unknown;
}

const _debugLog: DebugEntry[] = [];
const MAX_DEBUG_ENTRIES = 30;

export function getDebugLog(): DebugEntry[] {
  return [..._debugLog];
}

export function clearDebugLog(): void {
  _debugLog.length = 0;
}

function safeDebugBody(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 20).map(safeDebugBody);
  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (/token|secret|authorization|pairing|key|url|client.?id|jwt|e-?mail|consent|ppid|marketing|birth/i.test(key)) {
      out[key] = "[redacted]";
    } else if (key === "collection" && Array.isArray(item)) {
      out[key] = item.slice(0, 20).map(safeDebugBody);
    } else {
      out[key] = safeDebugBody(item);
    }
  }
  return out;
}

function logDebug(entry: DebugEntry): void {
  _debugLog.unshift({ ...entry, body: safeDebugBody(entry.body) });
  if (_debugLog.length > MAX_DEBUG_ENTRIES) _debugLog.pop();
}

function currentCredentials(): DirectSoundCloudCredentials | null {
  _settings = loadSettings();
  if (!_settings.accessToken || !_settings.webClientId) return null;
  return {
    accessToken: _settings.accessToken,
    webClientId: _settings.webClientId,
  };
}

function sameDirectCredentials(
  left: Readonly<DirectSoundCloudCredentials> | null,
  right: Readonly<DirectSoundCloudCredentials> | null,
): boolean {
  return Boolean(
    left &&
      right &&
      left.accessToken === right.accessToken &&
      left.webClientId === right.webClientId,
  );
}

function consumerProductCredentialKey(
  credentials: Readonly<DirectSoundCloudCredentials>,
): string {
  // This is a non-reversible, in-memory generation tag, not an auth check.
  // Two independent 32-bit accumulators make accidental stale-state
  // collisions negligible without putting OAuth material on `window`.
  const value = `${credentials.accessToken.length}:${credentials.accessToken}|${credentials.webClientId}`;
  let left = 0x811c9dc5;
  let right = 0x9e3779b9;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 0x01000193);
    right = Math.imul(right ^ code, 0x85ebca6b);
  }
  return `${(left >>> 0).toString(16).padStart(8, "0")}${(right >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

async function clearRejectedCredentials(
  rejected: Readonly<DirectSoundCloudCredentials>,
): Promise<void> {
  const current = loadSettings();
  if (!sameDirectCredentials(current, rejected)) {
    return;
  }
  clearSettings();
  _settings = loadSettings();
  _currentUser = null;
  _currentUserCredentials = null;
  _consumerProductGeneration += 1;
  resetConsumerProductAvailability();
  invalidateLikedTrackIds();
  invalidateLikedPlaylistIds();
  invalidateFollowingUserIds();
}

setDirectSoundCloudCredentialProvider(currentCredentials, clearRejectedCredentials);

export function updateApiSettings(settings: Partial<SCSettings>): void {
  const previous = _settings;
  _settings = { ..._settings, ...settings };
  const credentialsChanged =
    previous.accessToken !== _settings.accessToken ||
    previous.webClientId !== _settings.webClientId;
  if (credentialsChanged) {
    const nextCredentials =
      _settings.accessToken && _settings.webClientId
        ? {
            accessToken: _settings.accessToken,
            webClientId: _settings.webClientId,
          }
        : null;
    prepareConsumerProductAvailability(
      nextCredentials
        ? consumerProductCredentialKey(nextCredentials)
        : null,
    );
    // `authenticateWebSession` verifies the pair before it is persisted. Keep
    // that just-hydrated account/product context when the exact pair is saved.
    const preservesVerifiedConnect = sameDirectCredentials(
      _currentUserCredentials,
      _settings,
    );
    if (!preservesVerifiedConnect) {
      _currentUser = null;
      _currentUserCredentials = null;
      _consumerProductGeneration += 1;
    }
    invalidateLikedTrackIds();
    invalidateLikedPlaylistIds();
    invalidateFollowingUserIds();
  }
}

export function isDirectTransportAvailable(): boolean {
  return isDirectSoundCloudAvailable();
}

async function request<T>(
  pathOrUrl: string | URL,
  options: DirectRequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const endpoint = typeof pathOrUrl === "string" ? pathOrUrl : pathOrUrl.pathname;
  const started = performance.now();
  log("api", "%s %s", method, endpoint.split("?", 1)[0]);
  try {
    const result = await directSoundCloudRequest<T>(pathOrUrl, options);
    logDebug({
      ts: Date.now(),
      method,
      endpoint: endpoint.split("?", 1)[0],
      status: 200,
      durationMs: Math.round(performance.now() - started),
      body: result,
    });
    return result;
  } catch (cause) {
    const error = cause instanceof DirectSoundCloudError ? cause : null;
    logDebug({
      ts: Date.now(),
      method,
      endpoint: endpoint.split("?", 1)[0],
      status: error?.status ?? 0,
      durationMs: Math.round(performance.now() - started),
      body: { error: { code: error?.code ?? "soundcloud_error", message: error?.message } },
    });
    throw cause;
  }
}

function sessionFor(user: SCUser): SCSession {
  return {
    version: WAVELINK_VERSION,
    ready: true,
    mode: "account",
    configured: true,
    authenticated: true,
    setupUrl: "",
    callbackUrl: "",
    user,
    authMode: "manual_token_v2",
    capabilities: {
      publicEmbed: false,
      apiSearch: true,
      accountLibrary: true,
      accountActions: true,
      rawPlayback: true,
    },
  };
}

async function hydrateConsumerProductAvailability(
  credentials: DirectSoundCloudCredentials,
): Promise<void> {
  const credentialKey = consumerProductCredentialKey(credentials);
  if (
    sameDirectCredentials(_currentUserCredentials, credentials) &&
    getConsumerProductAvailability(credentialKey) !== undefined
  ) {
    return;
  }
  const generation = _consumerProductGeneration;
  try {
    // This optional billing-capability request is deliberately kept out of
    // the generic debug request logger. Only its reduced boolean is retained.
    const payload = await directSoundCloudRequest<unknown>(
      "/payments/quotations/consumer-subscription",
      {
        query: {
          app_version: SOUNDCLOUD_WEB_APP_VERSION,
          app_locale: "en",
        },
        timeoutMs: 8_000,
        credentialProvider: () => credentials,
        // `/me` is the authentication authority. A quotation-specific 401
        // must not erase otherwise working account credentials.
        onUnauthorized: () => undefined,
      },
    );
    if (generation !== _consumerProductGeneration) return;
    setConsumerProductAvailability(
      normalizeConsumerProductAvailability(payload),
      credentialKey,
    );
  } catch (cause) {
    if (generation !== _consumerProductGeneration) return;
    setConsumerProductAvailability(undefined);
    warn(
      "api",
      "consumer product availability is unknown:",
      cause instanceof DirectSoundCloudError ? cause.code : "request_failed",
    );
  }
}

export async function authenticateWebSession(
  accessToken: string,
  webClientId: string,
): Promise<SCSession> {
  const credentials = { accessToken, webClientId };
  if (!sameDirectCredentials(_currentUserCredentials, credentials)) {
    _consumerProductGeneration += 1;
    prepareConsumerProductAvailability(
      consumerProductCredentialKey(credentials),
    );
  }
  const { user } = await verifyDirectCredentials(credentials);
  _currentUser = user;
  _currentUserCredentials = credentials;
  await hydrateConsumerProductAvailability(credentials);
  return sessionFor(user);
}

export async function getSession(): Promise<SCSession> {
  const credentials = currentCredentials();
  if (!credentials) {
    throw new DirectSoundCloudError(
      "Enter your SoundCloud OAuth token and Web Client ID.",
      401,
      "soundcloud_not_connected",
    );
  }
  const { user } = await verifyDirectCredentials(
    credentials,
    clearRejectedCredentials,
  );
  if (!sameDirectCredentials(currentCredentials(), credentials)) {
    throw new DirectSoundCloudError(
      "SoundCloud credentials changed while the account session was loading.",
      409,
      "stale_soundcloud_session",
    );
  }
  _currentUser = user;
  _currentUserCredentials = credentials;
  await hydrateConsumerProductAvailability(credentials);
  return sessionFor(user);
}

export async function getMe(): Promise<SCUser> {
  const credentials = currentCredentials();
  if (
    _currentUser &&
    sameDirectCredentials(_currentUserCredentials, credentials)
  ) {
    return _currentUser;
  }
  _currentUser = null;
  _currentUserCredentials = null;
  return (await getSession()).user as SCUser;
}

async function ownUserId(): Promise<string> {
  return soundCloudNumericId((await getMe()).urn, "user");
}

function boundedLimit(value: number, fallback = 50): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(200, Math.floor(value)));
}

type CursorKind =
  | "track"
  | "playlist"
  | "user"
  | "feed"
  | "liked-track"
  | "liked-playlist";

function tagCursor<T>(page: SCCollection<T>, kind: CursorKind): SCCollection<T> {
  const next = page.next_href ? sanitizeNextHref(page.next_href) : null;
  return {
    ...page,
    next_href: next
      ? `${CURSOR_PREFIX}${kind}:${encodeURIComponent(next)}`
      : null,
  };
}

function parseCursor(value: string): { kind: CursorKind; href: string } {
  if (!value.startsWith(CURSOR_PREFIX) || value.length > 24 * 1024) {
    throw new DirectSoundCloudError(
      "Invalid pagination cursor.",
      400,
      "invalid_cursor",
    );
  }
  const payload = value.slice(CURSOR_PREFIX.length);
  const separator = payload.indexOf(":");
  const kind = payload.slice(0, separator) as CursorKind;
  if (
    separator < 1 ||
    ![
      "track",
      "playlist",
      "user",
      "feed",
      "liked-track",
      "liked-playlist",
    ].includes(kind)
  ) {
    throw new DirectSoundCloudError("Invalid pagination cursor.", 400, "invalid_cursor");
  }
  let href: string;
  try {
    href = decodeURIComponent(payload.slice(separator + 1));
  } catch {
    throw new DirectSoundCloudError("Invalid pagination cursor.", 400, "invalid_cursor");
  }
  const safe = sanitizeNextHref(href);
  if (!safe) throw new DirectSoundCloudError("Invalid pagination cursor.", 400, "invalid_cursor");
  return { kind, href: safe };
}

function normalizePageByKind<T>(payload: unknown, kind: CursorKind): SCCollection<T> {
  if (kind === "feed") {
    return tagCursor(
      normalizeFeedCollection(payload),
      "feed",
    ) as SCCollection<T>;
  }
  const normalizers: Record<CursorKind, DirectNormalizer<unknown>> = {
    track: trackEntityNormalizer,
    playlist: playlistEntityNormalizer,
    user: userEntityNormalizer,
    feed: normalizeFeedItem,
    "liked-track": normalizeLikedTrack,
    "liked-playlist": likedPlaylistEntityNormalizer,
  };
  return tagCursor(
    normalizeCollection(payload, normalizers[kind]) as SCCollection<T>,
    kind,
  );
}

export async function fetchNextPage<T>(nextHref: string): Promise<SCCollection<T>> {
  const { kind, href } = parseCursor(nextHref);
  return normalizePageByKind<T>(await request<unknown>(href), kind);
}

export async function searchTracks(query: string, limit = 20): Promise<SCSearchResult> {
  const payload = await request<unknown>("/search/tracks", {
    query: { q: query.trim(), limit: boundedLimit(limit, 20), linked_partitioning: true },
  });
  return tagCursor(normalizeTrackCollection(payload), "track");
}

export async function searchPlaylists(
  query: string,
  limit = 20,
): Promise<SCCollection<SCPlaylist>> {
  const payload = await request<unknown>("/search/playlists", {
    query: { q: query.trim(), limit: boundedLimit(limit, 20), linked_partitioning: true },
  });
  return tagCursor(normalizePlaylistCollection(payload), "playlist");
}

export async function searchUsers(
  query: string,
  limit = 20,
): Promise<SCCollection<SCUser>> {
  const payload = await request<unknown>("/search/users", {
    query: { q: query.trim(), limit: boundedLimit(limit, 20), linked_partitioning: true },
  });
  return tagCursor(normalizeUserCollection(payload), "user");
}

export async function getTrack(urn: SoundCloudUrn): Promise<SCTrack> {
  const id = soundCloudNumericId(urn, "track");
  const track = normalizeTrack(await request<unknown>(`/tracks/${id}`));
  if (!track) throw new DirectSoundCloudError("SoundCloud returned invalid track metadata.", 502, "invalid_track");
  return track;
}

export async function getRelatedTracks(
  urn: SoundCloudUrn,
  limit = 30,
): Promise<SCCollection<SCTrack>> {
  const id = soundCloudNumericId(urn, "track");
  const payload = await request<unknown>(`/tracks/${id}/related`, {
    query: { limit: boundedLimit(limit, 30), linked_partitioning: true },
  });
  return tagCursor(normalizeTrackCollection(payload), "track");
}

export async function createMediaSession(
  track: SCTrack,
  options: Pick<DirectMediaResolveOptions, "preferStandardAac" | "excludeAacRendition"> = {},
): Promise<SCMediaSource> {
  const started = performance.now();
  try {
    const availability = classifyTrackAvailability(track);
    if (availability.reason === "country") {
      throw new DirectSoundCloudError(
        "This preview requires a SoundCloud consumer product that is unavailable in your country.",
        403,
        "track_region_blocked",
        track.authorization_geo,
      );
    }
    const source = await createDirectMediaSource(track, {
      ...options,
      consumerProductAvailable: getConsumerProductAvailability(),
    });
    logDebug({
      ts: Date.now(),
      method: "GET",
      endpoint: "/media/resolve",
      status: 200,
      durationMs: Math.round(performance.now() - started),
      body: {
        kind: source.kind,
        codec: source.codec,
        ...(source.codec === "aac" ? { aacRendition: source.aacRendition } : {}),
        access: source.access,
        expiresAt: source.expiresAt,
      },
    });
    return source;
  } catch (cause) {
    const error = cause instanceof DirectSoundCloudError ? cause : null;
    logDebug({
      ts: Date.now(),
      method: "GET",
      endpoint: "/media/resolve",
      status: error?.status ?? 0,
      durationMs: Math.round(performance.now() - started),
      body: { error: { code: error?.code ?? "media_error", message: error?.message } },
    });
    throw cause;
  }
}

export async function getFeed(limit = 30): Promise<SCCollection<SCStreamItem>> {
  const payload = await request<unknown>("/stream", {
    query: { limit: boundedLimit(limit, 30), linked_partitioning: true },
  });
  return tagCursor(normalizeFeedCollection(payload), "feed");
}

export async function getRecentlyPlayed(limit = 25): Promise<SCCollection<SCTrack>> {
  const payload = await request<unknown>("/me/play-history/tracks", {
    // SoundCloud's private web history endpoint rejects the collection-style
    // limit parameter. Keep its default page intact and cap only after parsing.
    query: { linked_partitioning: true },
  });
  const page = tagCursor(normalizeTrackCollection(payload), "track");
  return { ...page, collection: page.collection.slice(0, Math.max(0, limit)) };
}

export async function recordTrackPlayHistory(
  urn: SoundCloudUrn,
): Promise<void> {
  const canonicalUrn = canonicalPlayHistoryTrackUrn(urn);
  if (!canonicalUrn) {
    throw new DirectSoundCloudError(
      "Invalid SoundCloud track ID.",
      400,
      "invalid_track_urn",
    );
  }
  await request<unknown>("/me/play-history", {
    method: "POST",
    query: {
      app_version: SOUNDCLOUD_WEB_APP_VERSION,
      app_locale: "en",
    },
    body: { track_urn: canonicalUrn },
    // This private, best-effort mutation must not sign the user out if its
    // endpoint-specific policy changes while /me and playback still work.
    onUnauthorized: () => undefined,
  });
  publishPlayHistoryRecorded(canonicalUrn);
}

export async function getFollowings(limit = 50): Promise<SCCollection<SCUser>> {
  const payload = await request<unknown>(`/users/${await ownUserId()}/followings`, {
    query: { limit: boundedLimit(limit), linked_partitioning: true },
  });
  const page = tagCursor(normalizeUserCollection(payload), "user");
  return {
    ...page,
    collection: page.collection.map((user) => ({
      ...user,
      followed_by_user: true,
    })),
  };
}

export async function getFollowers(limit = 50): Promise<SCCollection<SCUser>> {
  const payload = await request<unknown>(`/users/${await ownUserId()}/followers`, {
    query: { limit: boundedLimit(limit), linked_partitioning: true },
  });
  return tagCursor(normalizeUserCollection(payload), "user");
}

export async function getLikedTracks(limit = 50): Promise<SCCollection<SCLikedTrack>> {
  const payload = await request<unknown>(`/users/${await ownUserId()}/track_likes`, {
    query: { limit: boundedLimit(limit), linked_partitioning: true },
  });
  return tagCursor(normalizeLikedTrackCollection(payload), "liked-track");
}

export async function getLikedPlaylists(
  limit = 50,
): Promise<SCCollection<SCPlaylist>> {
  const payload = await request<unknown>(`/users/${await ownUserId()}/playlist_likes`, {
    query: { limit: boundedLimit(limit), linked_partitioning: true, representation: "full" },
  });
  return tagCursor(normalizeLikedPlaylistCollection(payload), "liked-playlist");
}

export async function getPlaylists(limit = 20): Promise<SCCollection<SCPlaylist>> {
  const payload = await request<unknown>(`/users/${await ownUserId()}/playlists`, {
    query: { limit: boundedLimit(limit, 20), linked_partitioning: true, representation: "full" },
  });
  return tagCursor(normalizePlaylistCollection(payload), "playlist");
}

function rawRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const PLAYLIST_TRACK_SOURCE_MAX_REFS = 500;
const PLAYLIST_TRACK_SOURCE_BULK_SIZE = 50;
let playlistTrackSourceSerial = 0;

interface PlaylistTrackReference {
  numericId: string | null;
  embedded: SCTrack | null;
}

export interface PlaylistTrackSourceResult {
  playlist: SCPlaylist;
  source: PaginatedTrackSource;
}

function playlistTrackReferences(raw: unknown): PlaylistTrackReference[] {
  const record = rawRecord(raw);
  const items = Array.isArray(record?.tracks)
    ? record.tracks.slice(0, PLAYLIST_TRACK_SOURCE_MAX_REFS)
    : [];
  return items.map((value) => {
    const item = rawRecord(value);
    const rawId = item?.id ?? item?.urn;
    let numericId: string | null = null;
    try {
      numericId = soundCloudNumericId(String(rawId ?? ""), "track");
    } catch {
      // A complete embedded track can still be used when its ID is malformed.
    }
    return { numericId, embedded: normalizeTrack(value) };
  });
}

async function hydratePlaylistTrackReferencePage(
  references: readonly PlaylistTrackReference[],
): Promise<SCTrack[]> {
  const ids = [
    ...new Set(
      references
        .map((reference) => reference.numericId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += PLAYLIST_TRACK_SOURCE_BULK_SIZE) {
    batches.push(ids.slice(offset, offset + PLAYLIST_TRACK_SOURCE_BULK_SIZE));
  }

  const hydratedById = new Map<string, SCTrack>();
  await Promise.all(
    batches.map(async (batch) => {
      const payload = await request<unknown>("/tracks", {
        query: { ids: batch.join(",") },
      });
      for (const track of normalizeTrackCollection(payload).collection) {
        try {
          const id = soundCloudNumericId(track.urn || track.id, "track");
          if (batch.includes(id) && !hydratedById.has(id)) {
            hydratedById.set(id, track);
          }
        } catch {
          // Ignore an unrelated or malformed item in the bulk response.
        }
      }
    }),
  );

  const tracks: SCTrack[] = [];
  for (const reference of references) {
    const hydrated = reference.numericId
      ? hydratedById.get(reference.numericId)
      : null;
    const track = hydrated ?? reference.embedded;
    if (track) tracks.push(track);
  }
  return tracks;
}

/**
 * Load playlist metadata once and expose its embedded track references through
 * a lazy, order-preserving bulk pager. Only the first configured page is
 * hydrated before this function resolves.
 */
export async function getPlaylistTrackSource(
  urn: SoundCloudUrn,
  pageSize = 50,
): Promise<PlaylistTrackSourceResult> {
  const id = soundCloudNumericId(urn, "playlist");
  const raw = await request<unknown>(`/playlists/${id}`, {
    query: { representation: "full" },
  });
  const playlist = normalizePlaylist(raw);
  if (!playlist) {
    throw new DirectSoundCloudError(
      "SoundCloud returned invalid playlist metadata.",
      502,
      "invalid_playlist",
    );
  }

  const size = boundedLimit(pageSize);
  const references = playlistTrackReferences(raw);
  const totalCount = Math.max(playlist.tracks_count, references.length);
  const sourceId = ++playlistTrackSourceSerial;
  const offsets = new Map<string, number>();
  const cursorFor = (offset: number): string | null => {
    if (offset >= references.length) return null;
    const cursor = `wavelink-playlist-tracks:${sourceId}:${offset}`;
    offsets.set(cursor, offset);
    return cursor;
  };

  const firstEnd = Math.min(size, references.length);
  const initialTracks = await hydratePlaylistTrackReferencePage(
    references.slice(0, firstEnd),
  );
  const source = createPaginatedTrackSource({
    initialTracks,
    nextHref: cursorFor(firstEnd),
    totalCount,
    pageSize: size,
    mergeMode: "preserve",
    loadPage: async (cursor) => {
      const offset = offsets.get(cursor);
      if (offset === undefined) {
        throw new DirectSoundCloudError(
          "Invalid playlist track pagination cursor.",
          400,
          "invalid_cursor",
        );
      }
      const end = Math.min(offset + size, references.length);
      return {
        collection: await hydratePlaylistTrackReferencePage(
          references.slice(offset, end),
        ),
        next_href: cursorFor(end),
        total_results: totalCount,
      };
    },
  });

  return {
    playlist: { ...playlist, tracks: initialTracks },
    source,
  };
}

async function hydratePlaylistTracks(raw: unknown): Promise<SCTrack[]> {
  const record = rawRecord(raw);
  const items = Array.isArray(record?.tracks) ? record.tracks.slice(0, 500) : [];
  const output: Array<SCTrack | null> = new Array(items.length).fill(null);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor++;
      const embedded = normalizeTrack(items[index]);
      if (embedded) {
        output[index] = embedded;
        continue;
      }
      const item = rawRecord(items[index]);
      const rawId = item?.id ?? item?.urn;
      try {
        const id = soundCloudNumericId(String(rawId ?? ""), "track");
        output[index] = normalizeTrack(await request<unknown>(`/tracks/${id}`));
      } catch (cause) {
        warn("api", "Could not hydrate playlist track:", cause);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, items.length) }, () => worker()));
  return output.filter((track): track is SCTrack => track !== null);
}

export async function getPlaylist(
  urn: SoundCloudUrn,
): Promise<SCPlaylist & { tracks: SCTrack[] }> {
  const id = soundCloudNumericId(urn, "playlist");
  const raw = await request<unknown>(`/playlists/${id}`, {
    query: { representation: "full" },
  });
  const playlist = normalizePlaylist(raw);
  if (!playlist) throw new DirectSoundCloudError("SoundCloud returned invalid playlist metadata.", 502, "invalid_playlist");
  const tracks = await hydratePlaylistTracks(raw);
  return { ...playlist, tracks: tracks.length ? tracks : playlist.tracks };
}

export async function getPlaylistTracks(
  urn: SoundCloudUrn,
): Promise<SCCollection<SCTrack>> {
  const playlist = await getPlaylist(urn);
  return { collection: playlist.tracks, next_href: null };
}

export async function getUser(urn: SoundCloudUrn): Promise<SCUser> {
  const id = soundCloudNumericId(urn, "user");
  const user = normalizeUser(await request<unknown>(`/users/${id}`, {
    query: {
      app_version: SOUNDCLOUD_WEB_APP_VERSION,
      app_locale: "en",
    },
  }));
  if (!user) throw new DirectSoundCloudError("SoundCloud returned invalid user metadata.", 502, "invalid_user");
  return user;
}

export async function getUserTracks(
  urn: SoundCloudUrn,
  limit = 50,
): Promise<SCCollection<SCTrack>> {
  const id = soundCloudNumericId(urn, "user");
  return tagCursor(
    normalizeTrackCollection(
      await request<unknown>(`/users/${id}/tracks`, {
        query: {
          limit: boundedLimit(limit),
          linked_partitioning: true,
        },
      }),
    ),
    "track",
  );
}

export async function getUserPlaylists(
  urn: SoundCloudUrn,
): Promise<SCCollection<SCPlaylist>> {
  const id = soundCloudNumericId(urn, "user");
  return tagCursor(
    normalizePlaylistCollection(
      await request<unknown>(`/users/${id}/playlists`, {
        query: { linked_partitioning: true, representation: "full" },
      }),
    ),
    "playlist",
  );
}

export async function getUserLikedTracks(
  urn: SoundCloudUrn,
  limit = 50,
): Promise<SCCollection<SCTrack>> {
  const id = soundCloudNumericId(urn, "user");
  return tagCursor(
    normalizeTrackCollection(
      await request<unknown>(`/users/${id}/track_likes`, {
        query: { limit: boundedLimit(limit), linked_partitioning: true },
      }),
    ),
    "track",
  );
}

export interface FollowingStatusOptions {
  force?: boolean;
}

export async function getFollowingUserIds(
  options: FollowingStatusOptions = {},
): Promise<Set<string>> {
  return _followingUserIdsCache.get(credentialCacheKey(), options);
}

export async function isFollowingUser(
  urn: SoundCloudUrn,
  options: FollowingStatusOptions = {},
): Promise<boolean> {
  const id = canonicalFollowingUserId(urn);
  return (await getFollowingUserIds(options)).has(id);
}

export async function unlikeTrack(urn: SoundCloudUrn): Promise<void> {
  await request(`/users/${await ownUserId()}/track_likes/${soundCloudNumericId(urn, "track")}`, { method: "DELETE" });
  invalidateLikedTrackIds();
}

export async function unlikePlaylist(urn: SoundCloudUrn): Promise<void> {
  await request(`/users/${await ownUserId()}/playlist_likes/${soundCloudNumericId(urn, "playlist")}`, { method: "DELETE" });
  invalidateLikedPlaylistIds();
}

function playlistBody(input: SCPlaylistMutation): Record<string, unknown> {
  const playlist: Record<string, unknown> = {};
  if (input.title !== undefined) playlist.title = input.title;
  if (input.description !== undefined) playlist.description = input.description;
  if (input.sharing !== undefined) playlist.sharing = input.sharing;
  if (input.trackUrns !== undefined) {
    playlist.tracks = input.trackUrns.map((urn) => {
      const id = soundCloudNumericId(urn, "track");
      const numeric = Number(id);
      return { id: Number.isSafeInteger(numeric) ? numeric : id };
    });
  }
  return { playlist };
}

export async function createPlaylist(
  input: SCPlaylistMutation & { title: string },
): Promise<SCPlaylist> {
  const playlist = normalizePlaylist(
    await request<unknown>("/playlists", { method: "POST", body: playlistBody(input) }),
  );
  if (!playlist) throw new DirectSoundCloudError("SoundCloud returned invalid playlist metadata.", 502, "invalid_playlist");
  return playlist;
}

export async function updatePlaylist(
  urn: SoundCloudUrn,
  input: SCPlaylistMutation,
): Promise<SCPlaylist> {
  const id = soundCloudNumericId(urn, "playlist");
  const playlist = normalizePlaylist(
    await request<unknown>(`/playlists/${id}`, { method: "PUT", body: playlistBody(input) }),
  );
  if (!playlist) throw new DirectSoundCloudError("SoundCloud returned invalid playlist metadata.", 502, "invalid_playlist");
  return playlist;
}

async function setRepost(
  kind: "track" | "playlist",
  urn: SoundCloudUrn,
  reposted: boolean,
): Promise<void> {
  const id = soundCloudNumericId(urn, kind);
  await request(`${SOUNDCLOUD_WEB_LEGACY_BASE}/e1/me/${kind}_reposts/${id}`, {
    method: reposted ? "PUT" : "DELETE",
  });
}

export async function repostTrack(urn: SoundCloudUrn): Promise<void> {
  await setRepost("track", urn, true);
}
export async function unrepostTrack(urn: SoundCloudUrn): Promise<void> {
  await setRepost("track", urn, false);
}
export async function repostPlaylist(urn: SoundCloudUrn): Promise<void> {
  await setRepost("playlist", urn, true);
}
export async function unrepostPlaylist(urn: SoundCloudUrn): Promise<void> {
  await setRepost("playlist", urn, false);
}

export function invalidateLikedTrackIds(): void {
  _likedTrackIdsGeneration += 1;
  _likedTrackIdsCache = null;
  _likedTrackIdsInFlight = null;
}

const _followingUserIdsCache = createFollowingStatusCache(
  async () =>
    collectFollowingUserIds(
      () => getFollowings(200),
      (cursor) => fetchNextPage<SCUser>(cursor),
    ),
  60_000,
);

const _likedPlaylistIdsCache = createFollowingStatusCache(
  async () =>
    collectLikedPlaylistIds(
      () => getLikedPlaylists(200),
      (cursor) => fetchNextPage<SCPlaylist>(cursor),
    ),
  60_000,
);

export function invalidateLikedPlaylistIds(): void {
  _likedPlaylistIdsCache.invalidate();
}

export interface LikedPlaylistIdsOptions {
  force?: boolean;
}

export async function getLikedPlaylistIds(
  options: LikedPlaylistIdsOptions = {},
): Promise<Set<string>> {
  return _likedPlaylistIdsCache.get(credentialCacheKey(), options);
}

export async function isPlaylistLiked(
  urn: SoundCloudUrn,
  options: LikedPlaylistIdsOptions = {},
): Promise<boolean> {
  const id = canonicalLikedPlaylistId(urn);
  return (await getLikedPlaylistIds(options)).has(id);
}

export function invalidateFollowingUserIds(): void {
  _followingUserIdsCache.invalidate();
}

function credentialCacheKey(): string {
  const settings = loadSettings();
  let hash = 0x811c9dc5;
  for (const char of `${settings.webClientId}\u0000${settings.accessToken}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

export interface LikedTrackIdsOptions {
  force?: boolean;
}

export async function getLikedTrackIds(
  options: LikedTrackIdsOptions = {},
): Promise<Set<SoundCloudUrn>> {
  if (options.force) invalidateLikedTrackIds();
  const key = credentialCacheKey();
  const now = Date.now();
  if (_likedTrackIdsCache?.key === key && _likedTrackIdsCache.expiresAt > now) {
    return new Set(_likedTrackIdsCache.ids);
  }
  if (_likedTrackIdsInFlight?.key === key) {
    return new Set(await _likedTrackIdsInFlight.promise);
  }
  const generation = _likedTrackIdsGeneration;
  const promise = collectLikedTrackIds().then((ids) => {
    if (generation === _likedTrackIdsGeneration) {
      _likedTrackIdsCache = {
        key,
        expiresAt: Date.now() + LIKED_TRACK_IDS_TTL_MS,
        ids: new Set(ids),
      };
    }
    return ids;
  });
  _likedTrackIdsInFlight = { key, generation, promise };
  try {
    return new Set(await promise);
  } finally {
    if (_likedTrackIdsInFlight?.generation === generation) {
      _likedTrackIdsInFlight = null;
    }
  }
}

async function collectLikedTrackIds(): Promise<Set<SoundCloudUrn>> {
  const result = new Set<SoundCloudUrn>();
  let page = await getLikedTracks(200);
  const seen = new Set<string>();
  while (true) {
    for (const item of page.collection) result.add(item.track.urn || item.track.id);
    if (!page.next_href || seen.has(page.next_href) || seen.size >= 250) break;
    seen.add(page.next_href);
    try {
      page = await fetchNextPage<SCLikedTrack>(page.next_href);
    } catch (cause) {
      warn("api", "Could not finish liked-track pagination:", cause);
      break;
    }
  }
  return result;
}

// Compatibility alias for code that previously caught BridgeError.
export { DirectSoundCloudError as BridgeError };
