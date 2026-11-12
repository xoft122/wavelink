import {
  SCCollection,
  SCLikedTrack,
  SCMediaSource,
  SCAacRendition,
  SCPlaylist,
  SCStreamItem,
  SCTrack,
  SCUser,
  SoundCloudUrn,
} from "../types/soundcloud";

export const SOUNDCLOUD_API_V2_BASE = "https://api-v2.soundcloud.com";
export const SOUNDCLOUD_API_AUTH_BASE = "https://api-auth.soundcloud.com";
export const SOUNDCLOUD_WEB_LEGACY_BASE = "https://api.soundcloud.com";
export const SPICETIFY_CORS_PROXY_ORIGIN = "https://cors-proxy.spicetify.app";

const ALLOWED_API_HOSTS = new Set([
  "api-v2.soundcloud.com",
  "api-auth.soundcloud.com",
  "api.soundcloud.com",
]);
const ALLOWED_LEGACY_API_PATHS = [
  /^\/e1\/me\/(?:track|playlist)_reposts\/[0-9]{1,32}$/,
];
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const MAX_URL_LENGTH = 16 * 1024;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_QUERY_PARAMETERS = 64;
const DEFAULT_MEDIA_TTL_MS = 2 * 60 * 60 * 1_000;

export interface DirectSoundCloudCredentials {
  accessToken: string;
  webClientId: string;
}

export type DirectCredentialProvider = () =>
  | DirectSoundCloudCredentials
  | null
  | undefined
  | Promise<DirectSoundCloudCredentials | null | undefined>;

/**
 * The rejected credential snapshot is supplied so the owner can avoid
 * clearing a newer credential generation after two concurrent 401s.
 */
export type DirectUnauthorizedHandler = (
  rejectedCredentials: Readonly<DirectSoundCloudCredentials>,
) => void | Promise<void>;

export type DirectHttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

export type DirectQuery = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface DirectRequestOptions {
  method?: DirectHttpMethod;
  query?: DirectQuery;
  body?: unknown;
  timeoutMs?: number;
  credentialProvider?: DirectCredentialProvider;
  onUnauthorized?: DirectUnauthorizedHandler;
}

export type DirectNormalizer<T> = (value: unknown) => T | null;

let configuredCredentialProvider: DirectCredentialProvider | null = null;
let configuredUnauthorizedHandler: DirectUnauthorizedHandler | null = null;

export class DirectSoundCloudError extends Error {
  readonly status: number;
  readonly code: string;
  readonly countryCode?: string;

  constructor(
    message: string,
    status = 0,
    code = "soundcloud_error",
    countryCode?: string,
  ) {
    super(message);
    this.name = "DirectSoundCloudError";
    this.status = status;
    this.code = code;
    if (countryCode) this.countryCode = countryCode;
  }
}

export function configureDirectSoundCloud(
  credentialProvider: DirectCredentialProvider,
  onUnauthorized: DirectUnauthorizedHandler | null = null,
): () => void {
  configuredCredentialProvider = credentialProvider;
  configuredUnauthorizedHandler = onUnauthorized;
  return () => {
    if (configuredCredentialProvider === credentialProvider) {
      configuredCredentialProvider = null;
    }
    if (configuredUnauthorizedHandler === onUnauthorized) {
      configuredUnauthorizedHandler = null;
    }
  };
}

export function setDirectSoundCloudCredentialProvider(
  credentialProvider: DirectCredentialProvider | null,
  onUnauthorized: DirectUnauthorizedHandler | null = null,
): void {
  configuredCredentialProvider = credentialProvider;
  configuredUnauthorizedHandler = onUnauthorized;
}

export function normalizeOAuthAccessToken(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_TOKEN_LENGTH + 32) {
    throw new DirectSoundCloudError(
      "Enter a valid SoundCloud OAuth access token.",
      400,
      "invalid_oauth_token",
    );
  }
  const input = value.trim();
  const token = /^OAuth[\t ]+/i.test(input)
    ? input.replace(/^OAuth[\t ]+/i, "")
    : input;
  if (
    token.length < 8 ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[\x21-\x7e]+$/.test(token)
  ) {
    throw new DirectSoundCloudError(
      "Enter a valid SoundCloud OAuth access token.",
      400,
      "invalid_oauth_token",
    );
  }
  return token;
}

export function normalizeWebClientId(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9]{32}$/.test(value.trim())) {
    throw new DirectSoundCloudError(
      "Enter a valid SoundCloud Web Client ID.",
      400,
      "invalid_web_client_id",
    );
  }
  return value.trim();
}

function normalizedCredentials(
  value: DirectSoundCloudCredentials | null | undefined,
): DirectSoundCloudCredentials {
  if (!value) {
    throw new DirectSoundCloudError(
      "Connect SoundCloud with an OAuth token and Web Client ID first.",
      401,
      "soundcloud_not_connected",
    );
  }
  return {
    accessToken: normalizeOAuthAccessToken(value.accessToken),
    webClientId: normalizeWebClientId(value.webClientId),
  };
}

export function isDirectSoundCloudAvailable(): boolean {
  try {
    return typeof window.fetch === "function";
  } catch {
    return false;
  }
}

function soundCloudProxyUrl(url: URL): string {
  // Spicetify's public proxy is necessary because SoundCloud rejects Spotify's
  // xpui origin at the browser CORS layer. The target itself has already
  // passed the strict SoundCloud host/path allowlist above.
  const proxied = new URL(`${SPICETIFY_CORS_PROXY_ORIGIN}/${url.toString()}`);
  if (
    proxied.origin !== SPICETIFY_CORS_PROXY_ORIGIN ||
    !proxied.pathname.startsWith("/https://") ||
    proxied.username ||
    proxied.password
  ) {
    throw new DirectSoundCloudError(
      "Could not build the Spotify-only SoundCloud request.",
      0,
      "invalid_proxy_url",
    );
  }
  return proxied.toString();
}

function parseApiUrl(value: string | URL, pagination = false): URL {
  const raw = value instanceof URL ? value.toString() : value;
  if (
    typeof raw !== "string" ||
    raw.length < 1 ||
    raw.length > MAX_URL_LENGTH ||
    raw.includes("\\")
  ) {
    throw new DirectSoundCloudError(
      "Invalid SoundCloud API URL.",
      400,
      pagination ? "invalid_pagination_url" : "invalid_api_url",
    );
  }

  let url: URL;
  try {
    if (raw.startsWith("/")) {
      if (raw.startsWith("//")) throw new TypeError("Protocol-relative URL");
      url = new URL(raw, SOUNDCLOUD_API_V2_BASE);
    } else {
      url = new URL(raw);
    }
  } catch {
    throw new DirectSoundCloudError(
      "Invalid SoundCloud API URL.",
      400,
      pagination ? "invalid_pagination_url" : "invalid_api_url",
    );
  }

  const validHost = pagination
    ? url.hostname === "api-v2.soundcloud.com"
    : ALLOWED_API_HOSTS.has(url.hostname);
  const validPath =
    url.hostname !== "api.soundcloud.com" ||
    ALLOWED_LEGACY_API_PATHS.some((pattern) => pattern.test(url.pathname));
  if (
    url.protocol !== "https:" ||
    !validHost ||
    !validPath ||
    Boolean(url.port || url.username || url.password || url.hash)
  ) {
    throw new DirectSoundCloudError(
      "Blocked SoundCloud API URL.",
      400,
      pagination ? "invalid_pagination_url" : "blocked_api_url",
    );
  }
  return url;
}

/**
 * Validate an API URL and strip any credential-like query values. The caller's
 * current Web Client ID is re-injected immediately before transport.
 */
export function validateDirectApiUrl(value: string | URL): URL {
  const url = parseApiUrl(value);
  url.searchParams.delete("client_id");
  url.searchParams.delete("oauth_token");
  return url;
}

export function sanitizeNextHref(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new DirectSoundCloudError(
      "Invalid SoundCloud pagination URL.",
      502,
      "invalid_pagination_url",
    );
  }
  const url = parseApiUrl(value, true);
  url.searchParams.delete("client_id");
  url.searchParams.delete("oauth_token");
  return url.toString();
}

function addQuery(url: URL, query: DirectQuery | undefined): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (key === "client_id" || key === "oauth_token") continue;
    const encoded = String(value);
    if (key.length > 256 || encoded.length > 4_096) {
      throw new DirectSoundCloudError(
        "Invalid SoundCloud query parameter.",
        400,
        "invalid_query",
      );
    }
    url.searchParams.set(key, encoded);
  }
}

function requestQuery(url: URL): Record<string, string> {
  const result: Record<string, string> = {};
  let count = 0;
  for (const key of new Set(url.searchParams.keys())) {
    const values = url.searchParams.getAll(key);
    count += values.length;
    if (
      count > MAX_QUERY_PARAMETERS ||
      values.length !== 1 ||
      key.length > 256 ||
      values[0].length > 4_096
    ) {
      throw new DirectSoundCloudError(
        "Invalid SoundCloud query parameters.",
        400,
        "invalid_query",
      );
    }
    result[key] = values[0];
  }
  return result;
}

function numericStatus(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const source = value as Record<string, unknown>;
  for (const candidate of [
    source.status,
    source.statusCode,
    source.httpStatus,
    isRecord(source.response) ? source.response.status : undefined,
  ]) {
    const status = Number(candidate);
    if (Number.isInteger(status) && status >= 100 && status <= 599) {
      return status;
    }
  }
  return 0;
}

function mappedError(status: number, timedOut = false): DirectSoundCloudError {
  if (timedOut) {
    return new DirectSoundCloudError(
      "SoundCloud did not respond in time.",
      0,
      "soundcloud_timeout",
    );
  }
  switch (status) {
    case 400:
    case 422:
      return new DirectSoundCloudError(
        "SoundCloud rejected the request.",
        status,
        "soundcloud_bad_request",
      );
    case 401:
      return new DirectSoundCloudError(
        "The SoundCloud OAuth token is no longer valid.",
        status,
        "soundcloud_login_required",
      );
    case 403:
      return new DirectSoundCloudError(
        "SoundCloud denied this operation.",
        status,
        "soundcloud_forbidden",
      );
    case 404:
      return new DirectSoundCloudError(
        "The SoundCloud resource was not found.",
        status,
        "soundcloud_not_found",
      );
    case 429:
      return new DirectSoundCloudError(
        "SoundCloud rate limit reached. Try again shortly.",
        status,
        "soundcloud_rate_limited",
      );
    case 503:
    case 504:
      return new DirectSoundCloudError(
        "SoundCloud is temporarily unavailable.",
        status,
        "soundcloud_unavailable",
      );
    default:
      return new DirectSoundCloudError(
        status
          ? `SoundCloud returned HTTP ${status}.`
          : "Unable to reach SoundCloud through Spotify.",
        status,
        status ? "soundcloud_error" : "soundcloud_unreachable",
      );
  }
}

async function notifyUnauthorized(
  handler: DirectUnauthorizedHandler | null | undefined,
  credentials: DirectSoundCloudCredentials,
): Promise<void> {
  if (!handler) return;
  try {
    await handler(Object.freeze({ ...credentials }));
  } catch {
    // Credential cleanup is best effort. Never replace the useful upstream
    // 401 with a local persistence error.
  }
}

export async function directSoundCloudRequest<T = unknown>(
  pathOrUrl: string | URL,
  options: DirectRequestOptions = {},
): Promise<T> {
  const provider = options.credentialProvider ?? configuredCredentialProvider;
  if (!provider) {
    throw new DirectSoundCloudError(
      "Connect SoundCloud with an OAuth token and Web Client ID first.",
      401,
      "soundcloud_not_connected",
    );
  }
  const credentials = normalizedCredentials(await provider());
  const url = validateDirectApiUrl(pathOrUrl);
  addQuery(url, options.query);
  // Always overwrite a stale or attacker-supplied value with the credential
  // provider's current, token-bound client ID.
  url.searchParams.set("client_id", credentials.webClientId);

  const method = options.method ?? "GET";
  if ((method === "GET" || method === "DELETE") && options.body !== undefined) {
    throw new DirectSoundCloudError(
      `${method} requests cannot contain a JSON body.`,
      400,
      "invalid_request_body",
    );
  }
  const timeoutMs = Math.max(
    1_000,
    Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
  );
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  requestQuery(url);
  const headers: Record<string, string> = {
    Accept: "application/json; charset=utf-8",
    Authorization: `OAuth ${credentials.accessToken}`,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json;charset=UTF-8";
  }

  try {
    const response = await window.fetch(soundCloudProxyUrl(url), {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    const status = response.status;
    if (status === 401) {
      await notifyUnauthorized(
        options.onUnauthorized ?? configuredUnauthorizedHandler,
        credentials,
      );
      throw mappedError(401);
    }
    if (Number.isFinite(status) && status >= 400) throw mappedError(status);
    if (status === 204) return null as T;
    const text = await response.text();
    if (!text.trim()) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new DirectSoundCloudError(
        "SoundCloud returned an invalid response.",
        502,
        "invalid_soundcloud_response",
      );
    }
  } catch (error) {
    if (error instanceof DirectSoundCloudError) throw error;
    const status = numericStatus(error);
    if (status === 401) {
      await notifyUnauthorized(
        options.onUnauthorized ?? configuredUnauthorizedHandler,
        credentials,
      );
    }
    throw mappedError(status, controller.signal.aborted);
  } finally {
    window.clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function safeText(value: unknown, limit: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized ? [...normalized].slice(0, limit).join("") : null;
}

function safeNonNegativeNumber(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.min(number, Number.MAX_SAFE_INTEGER)
    : 0;
}

function safeOptionalNonNegativeNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? Math.min(number, Number.MAX_SAFE_INTEGER)
    : undefined;
}

function safeSoundCloudPageUrl(value: unknown): string {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        !url.port &&
        !url.username &&
        !url.password &&
        (url.hostname === "soundcloud.com" ||
          url.hostname.endsWith(".soundcloud.com"))
      ) {
        return url.toString();
      }
    } catch {
      // Fall through to the canonical public origin.
    }
  }
  return "https://soundcloud.com/";
}

function safeSoundCloudImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      (url.hostname === "sndcdn.com" || url.hostname.endsWith(".sndcdn.com"))
    ) {
      return url.toString();
    }
  } catch {
    // Invalid upstream artwork is omitted.
  }
  return null;
}

function profileHeaderUrl(value: Record<string, unknown>): string | null {
  if (!isRecord(value.visuals) || value.visuals.enabled === false) return null;
  if (!Array.isArray(value.visuals.visuals)) return null;

  const candidates = value.visuals.visuals
    .slice(0, 32)
    .filter(isRecord)
    .sort((left, right) => {
      const leftTime = safeNonNegativeNumber(left.entry_time);
      const rightTime = safeNonNegativeNumber(right.entry_time);
      return leftTime - rightTime;
    });
  for (const visual of candidates) {
    const url = safeSoundCloudImageUrl(visual.visual_url);
    if (url) return url;
  }
  return null;
}

function canonicalUrn(
  resource: Record<string, unknown>,
  pluralKind: "users" | "tracks" | "playlists",
): string | null {
  const expected = new RegExp(`^soundcloud:${pluralKind}:[0-9]{1,32}$`);
  if (typeof resource.urn === "string" && expected.test(resource.urn)) {
    return resource.urn;
  }
  if (typeof resource.id === "string" && expected.test(resource.id)) {
    return resource.id;
  }
  const numericId = String(resource.id ?? "");
  return /^[0-9]{1,32}$/.test(numericId)
    ? `soundcloud:${pluralKind}:${numericId}`
    : null;
}

export function normalizeUser(value: unknown): SCUser | null {
  if (!isRecord(value)) return null;
  const urn = canonicalUrn(value, "users");
  if (!urn) return null;
  return {
    urn,
    id: urn,
    username: safeText(value.username, 300) ?? "SoundCloud user",
    permalink_url: safeSoundCloudPageUrl(value.permalink_url),
    avatar_url: safeSoundCloudImageUrl(value.avatar_url) ?? "",
    profile_header_url: profileHeaderUrl(value),
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

function normalizedTrackPolicy(value: unknown): SCTrack["policy"] {
  return value === "ALLOW" ||
    value === "MONETIZE" ||
    value === "SNIP" ||
    value === "BLOCK"
    ? value
    : undefined;
}

interface NormalizedTranscodingSignals {
  hasTranscodings: boolean | undefined;
  hasSnippedTranscoding: boolean | undefined;
  hasFullTranscoding: boolean | undefined;
}

function normalizedTranscodingSignals(
  value: Record<string, unknown>,
): NormalizedTranscodingSignals {
  if (!isRecord(value.media) || !Array.isArray(value.media.transcodings)) {
    return {
      hasTranscodings: undefined,
      hasSnippedTranscoding: undefined,
      hasFullTranscoding: undefined,
    };
  }
  const transcodings = value.media.transcodings.slice(0, 64).filter(isRecord);
  if (value.media.transcodings.length === 0) {
    return {
      hasTranscodings: false,
      hasSnippedTranscoding: false,
      hasFullTranscoding: false,
    };
  }
  const hasSnipped = transcodings.some(
    (transcoding) => transcoding.snipped === true,
  );
  const hasFull = transcodings.some(
    (transcoding) => transcoding.snipped === false,
  );
  const allExplicitSnipped =
    transcodings.length > 0 &&
    transcodings.every((transcoding) => transcoding.snipped === true);
  return {
    hasTranscodings: true,
    hasSnippedTranscoding: hasSnipped
      ? true
      : transcodings.length > 0 &&
          transcodings.every(
            (transcoding) => typeof transcoding.snipped === "boolean",
          )
        ? false
        : undefined,
    hasFullTranscoding: hasFull
      ? true
      : allExplicitSnipped
        ? false
        : undefined,
  };
}

function authorizationGeo(value: unknown): string | undefined {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 2_048 ||
    !/^[A-Za-z0-9_.~-]+$/.test(value)
  ) {
    return undefined;
  }
  const parts = value.split(".");
  if (parts.length !== 3 || parts[1].length > 1_024) return undefined;
  const payload = parts[1];
  if (!/^[A-Za-z0-9_-]+$/.test(payload)) return undefined;
  try {
    const padded = payload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const decoder =
      typeof globalThis.atob === "function"
        ? globalThis.atob.bind(globalThis)
        : null;
    if (!decoder) return undefined;
    const decoded = JSON.parse(decoder(padded)) as unknown;
    if (!isRecord(decoded) || typeof decoded.geo !== "string") {
      return undefined;
    }
    const code = decoded.geo.trim().toUpperCase();
    return /^[A-Z]{2}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeTrack(value: unknown): SCTrack | null {
  if (!isRecord(value)) return null;
  const urn = canonicalUrn(value, "tracks");
  const user = normalizeUser(value.user);
  if (!urn || !user) return null;
  const access =
    value.access === "playable" ||
    value.access === "preview" ||
    value.access === "blocked"
      ? value.access
      : undefined;
  const sharing =
    value.sharing === "public" || value.sharing === "private"
      ? value.sharing
      : undefined;
  const policy = normalizedTrackPolicy(value.policy);
  const transcodingSignals = normalizedTranscodingSignals(value);
  const fullPlayable: boolean | undefined =
    transcodingSignals.hasFullTranscoding === true
      ? true
      : transcodingSignals.hasTranscodings === false
        ? false
        : access === "playable" && policy !== "SNIP"
          ? true
          : access === "preview" ||
              access === "blocked" ||
              policy === "SNIP" ||
              value.streamable === false ||
              transcodingSignals.hasSnippedTranscoding === true
            ? false
            : undefined;
  const previewPlayable: boolean | undefined =
    transcodingSignals.hasTranscodings === false
      ? false
      : access === "preview" ||
          transcodingSignals.hasSnippedTranscoding === true ||
          (policy === "SNIP" &&
            transcodingSignals.hasTranscodings === true)
        ? true
        : undefined;
  return {
    urn,
    id: urn,
    kind: "track",
    title: safeText(value.title, 500) ?? "Untitled track",
    duration: safeNonNegativeNumber(value.duration),
    full_duration: safeOptionalNonNegativeNumber(value.full_duration),
    likes_count: safeNonNegativeNumber(
      value.likes_count ?? value.favoritings_count,
    ),
    playback_count: safeNonNegativeNumber(value.playback_count),
    reposts_count: safeNonNegativeNumber(value.reposts_count),
    comment_count: safeNonNegativeNumber(value.comment_count),
    permalink_url: safeSoundCloudPageUrl(value.permalink_url),
    artwork_url: safeSoundCloudImageUrl(value.artwork_url),
    user,
    description: safeText(value.description, 5_000),
    genre: safeText(value.genre, 500),
    access,
    policy,
    streamable:
      typeof value.streamable === "boolean" ? value.streamable : undefined,
    has_transcodings: transcodingSignals.hasTranscodings,
    has_snipped_transcoding: transcodingSignals.hasSnippedTranscoding,
    has_full_transcoding: transcodingSignals.hasFullTranscoding,
    full_playable: fullPlayable,
    preview_playable: previewPlayable,
    authorization_geo: authorizationGeo(value.track_authorization),
    sharing,
    user_favorite: value.user_favorite === true,
    reposted_by_user: value.reposted_by_user === true,
  };
}

export function normalizePlaylist(value: unknown): SCPlaylist | null {
  if (!isRecord(value)) return null;
  const urn = canonicalUrn(value, "playlists");
  const user = normalizeUser(value.user);
  if (!urn || !user) return null;
  const trackCount = safeNonNegativeNumber(
    value.track_count ?? value.tracks_count,
  );
  const sharing =
    value.sharing === "public" || value.sharing === "private"
      ? value.sharing
      : undefined;
  return {
    urn,
    id: urn,
    kind: "playlist",
    title: safeText(value.title, 500) ?? "Untitled playlist",
    user,
    artwork_url: safeSoundCloudImageUrl(value.artwork_url),
    tracks: Array.isArray(value.tracks)
      ? value.tracks
          .map((track) => normalizeTrack(track))
          .filter((track): track is SCTrack => track !== null)
      : [],
    tracks_count: trackCount,
    track_count: trackCount,
    duration: safeNonNegativeNumber(value.duration),
    permalink_url: safeSoundCloudPageUrl(value.permalink_url),
    description: safeText(value.description, 5_000),
    likes_count: safeNonNegativeNumber(value.likes_count),
    sharing,
    user_favorite:
      typeof value.user_favorite === "boolean"
        ? value.user_favorite
        : undefined,
    reposted_by_user: value.reposted_by_user === true,
  };
}

export function normalizeFeedItem(value: unknown): SCStreamItem | null {
  if (!isRecord(value)) return null;
  const origin = value.origin ?? value.track ?? value.playlist;
  if (!isRecord(origin)) return null;
  const isPlaylist =
    value.playlist !== undefined ||
    origin.kind === "playlist" ||
    String(value.type ?? "").startsWith("playlist");
  const type = safeText(value.type, 200) ?? (isPlaylist ? "playlist" : "track");
  const createdAt = safeText(value.created_at, 200) ?? "";
  const uuid = safeText(value.uuid, 300) ?? undefined;
  if (isPlaylist) {
    const playlist = normalizePlaylist(origin);
    return playlist
      ? { type, created_at: createdAt, uuid, playlist }
      : null;
  }
  const track = normalizeTrack(origin);
  return track ? { type, created_at: createdAt, uuid, track } : null;
}

function feedItemIdentity(item: SCStreamItem): string | null {
  if (item.track) {
    const identity = item.track.urn || item.track.id;
    return identity ? `track:${identity}` : null;
  }
  if (item.playlist) {
    const identity = item.playlist.urn || item.playlist.id;
    return identity ? `playlist:${identity}` : null;
  }
  return null;
}

/**
 * SoundCloud's stream can expose the same activity twice (for example as an
 * upload and a repost) while pointing at one canonical entity. Keep the first
 * occurrence because stream responses are ordered newest-first.
 */
export function dedupeFeedItems(
  items: readonly SCStreamItem[],
): SCStreamItem[] {
  const seen = new Set<string>();
  const result: SCStreamItem[] = [];
  for (const item of items) {
    const identity = feedItemIdentity(item);
    if (identity && seen.has(identity)) continue;
    if (identity) seen.add(identity);
    result.push(item);
  }
  return result;
}

export function normalizeLikedTrack(value: unknown): SCLikedTrack | null {
  const source = isRecord(value) ? value : {};
  const rawTrack = source.track ?? source.origin ?? value;
  const track = normalizeTrack(rawTrack);
  if (!track) return null;
  const rawTrackRecord = isRecord(rawTrack) ? rawTrack : null;
  return {
    track,
    created_at:
      safeText(source.created_at ?? rawTrackRecord?.created_at, 200) ?? null,
  };
}

export function normalizeCollection<T>(
  payload: unknown,
  normalizer: DirectNormalizer<T>,
): SCCollection<T> {
  const source = isRecord(payload) ? payload : null;
  const rawCollection = Array.isArray(payload)
    ? payload
    : Array.isArray(source?.collection)
      ? source.collection
      : [];
  const collection = rawCollection
    .map((item) => normalizer(item))
    .filter((item): item is T => item !== null);
  const result: SCCollection<T> = {
    collection,
    next_href: sanitizeNextHref(source?.next_href),
  };
  const queryUrn = safeText(source?.query_urn, 500);
  if (queryUrn) result.query_urn = queryUrn;
  const totalResults = Number(source?.total_results);
  if (Number.isFinite(totalResults) && totalResults >= 0) {
    result.total_results = Math.min(totalResults, Number.MAX_SAFE_INTEGER);
  }
  return result;
}

export const trackEntityNormalizer: DirectNormalizer<SCTrack> = (value) => {
  const source = isRecord(value) ? value : null;
  return normalizeTrack(source?.track ?? source?.origin ?? value);
};

export const playlistEntityNormalizer: DirectNormalizer<SCPlaylist> = (
  value,
) => {
  const source = isRecord(value) ? value : null;
  return normalizePlaylist(source?.playlist ?? source?.origin ?? value);
};

export const likedPlaylistEntityNormalizer: DirectNormalizer<SCPlaylist> = (
  value,
) => {
  const playlist = playlistEntityNormalizer(value);
  return playlist ? { ...playlist, user_favorite: true } : null;
};

export const userEntityNormalizer: DirectNormalizer<SCUser> = normalizeUser;

export function normalizeTrackCollection(payload: unknown): SCCollection<SCTrack> {
  return normalizeCollection(payload, trackEntityNormalizer);
}

export function normalizePlaylistCollection(
  payload: unknown,
): SCCollection<SCPlaylist> {
  return normalizeCollection(payload, playlistEntityNormalizer);
}

export function normalizeLikedPlaylistCollection(
  payload: unknown,
): SCCollection<SCPlaylist> {
  return normalizeCollection(payload, likedPlaylistEntityNormalizer);
}

export function normalizeUserCollection(payload: unknown): SCCollection<SCUser> {
  return normalizeCollection(payload, userEntityNormalizer);
}

export function normalizeFeedCollection(
  payload: unknown,
): SCCollection<SCStreamItem> {
  const page = normalizeCollection(payload, normalizeFeedItem);
  return {
    ...page,
    collection: dedupeFeedItems(page.collection),
  };
}

export function normalizeLikedTrackCollection(
  payload: unknown,
): SCCollection<SCLikedTrack> {
  return normalizeCollection(payload, normalizeLikedTrack);
}

export async function fetchDirectNextPage<T>(
  nextHref: string,
  normalizer: DirectNormalizer<T>,
  options: Omit<DirectRequestOptions, "method" | "query" | "body"> = {},
): Promise<SCCollection<T>> {
  const safeHref = sanitizeNextHref(nextHref);
  if (!safeHref) {
    throw new DirectSoundCloudError(
      "Invalid SoundCloud pagination URL.",
      400,
      "invalid_pagination_url",
    );
  }
  const payload = await directSoundCloudRequest<unknown>(safeHref, options);
  return normalizeCollection(payload, normalizer);
}

export function soundCloudNumericId(
  value: SoundCloudUrn,
  kind: "user" | "track" | "playlist" = "track",
): string {
  const plural = `${kind}s`;
  const input = String(value);
  const match = new RegExp(`^soundcloud:${plural}:([0-9]{1,32})$`).exec(input);
  if (match) return match[1];
  if (/^[0-9]{1,32}$/.test(input)) return input;
  throw new DirectSoundCloudError(
    `Invalid SoundCloud ${kind} identifier.`,
    400,
    "invalid_soundcloud_urn",
  );
}

export async function getDirectProfile(
  options: Omit<DirectRequestOptions, "method" | "query" | "body"> = {},
): Promise<SCUser> {
  const payload = await directSoundCloudRequest<unknown>("/me", options);
  const user = normalizeUser(payload);
  if (!user) {
    throw new DirectSoundCloudError(
      "SoundCloud returned an invalid account profile.",
      502,
      "invalid_profile",
    );
  }
  return user;
}

export async function verifyDirectCredentials(
  credentials: DirectSoundCloudCredentials,
  onUnauthorized: DirectUnauthorizedHandler | null = null,
): Promise<{ user: SCUser; userId: string }> {
  const normalized = normalizedCredentials(credentials);
  const user = await getDirectProfile({
    credentialProvider: () => normalized,
    onUnauthorized: onUnauthorized ?? undefined,
  });
  return {
    user,
    userId: soundCloudNumericId(user.urn, "user"),
  };
}

interface RawTranscoding {
  url?: unknown;
  preset?: unknown;
  quality?: unknown;
  format?: unknown;
  duration?: unknown;
  snipped?: unknown;
}

export interface DirectTrackStreams {
  http_mp3_128_url?: string;
  preview_mp3_128_url?: string;
  hls_aac_160_url?: string;
  hls_aac_96_url?: string;
  hls_mp3_128_url?: string;
}

export interface DirectMediaResolveOptions
  extends Omit<DirectRequestOptions, "method" | "query" | "body"> {
  consumerProductAvailable?: boolean;
  /** Do not retry the same rendition after a decoder failure. */
  excludeAacRendition?: SCAacRendition;
}

function isHighQualityAac(value: RawTranscoding): boolean {
  const preset = String(value.preset ?? "").trim().toLowerCase();
  // Current SoundCloud values are `aac_160k` with quality `sq` and
  // `aac_96k` with quality `lq`. The bitrate encoded in the preset is more
  // precise than the broad quality tier, so it must be checked first.
  if (/(?:^|[_-])160(?:k|kbps)?(?:$|[_-])/.test(preset)) return true;
  if (/(?:^|[_-])96(?:k|kbps)?(?:$|[_-])/.test(preset)) return false;

  const quality = String(value.quality ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (/^(?:hq|high|high_quality|premium|160(?:k|kbps)?)$/.test(quality)) {
    return true;
  }
  if (
    /^(?:sq|standard|standard_quality|low|low_quality|lq|96(?:k|kbps)?)$/.test(
      quality,
    )
  ) {
    return false;
  }

  return (
    /(?:^|[_-])(?:hq|high|160)(?:k|kbps)?(?:$|[_-])/.test(preset) ||
    /^aac[_-]1(?:$|[_-])/.test(preset)
  );
}

function transcodingRank(value: RawTranscoding): number {
  const format = isRecord(value.format) ? value.format : {};
  const protocol = String(format.protocol ?? "").toLowerCase();
  const isHls = protocol === "hls" || protocol === "hls-aes";
  const codec = transcodingCodec(value);
  if (protocol === "progressive" && codec === "mp3") return 600;
  if (isHls && codec === "aac") return isHighQualityAac(value) ? 520 : 500;
  if (isHls && codec === "mp3") return 400;
  return -1;
}

function transcodingCodec(value: RawTranscoding): "aac" | "mp3" | null {
  const format = isRecord(value.format) ? value.format : {};
  const mime = String(format.mime_type ?? "").trim().toLowerCase();
  const mimeEssence = mime.split(";", 1)[0].trim();
  const preset = String(value.preset ?? "").trim().toLowerCase();
  if (
    mimeEssence === "audio/mp4" ||
    mimeEssence === "audio/aac" ||
    mime.includes("mp4a") ||
    /^aac(?:_|$)/.test(preset)
  ) {
    return "aac";
  }
  if (mimeEssence === "audio/mpeg" || /^mp3(?:_|$)/.test(preset)) {
    return "mp3";
  }
  // `audio/mpegurl` describes an HLS manifest, not an MPEG audio codec.
  // SoundCloud currently exposes an `abr_*` entry with this MIME value; it
  // must not be mislabeled as legacy MP3 and fed to an incompatible MSE path.
  return null;
}

function streamField(
  value: RawTranscoding,
): keyof DirectTrackStreams | null {
  const format = isRecord(value.format) ? value.format : {};
  const protocol = String(format.protocol ?? "").toLowerCase();
  const codec = transcodingCodec(value);
  const preset = String(value.preset ?? "").toLowerCase();
  if (protocol === "hls" || protocol === "hls-aes") {
    if (codec === "aac") {
      return isHighQualityAac(value)
        ? "hls_aac_160_url"
        : "hls_aac_96_url";
    }
    return codec === "mp3" ? "hls_mp3_128_url" : null;
  }
  if (protocol === "progressive" && codec === "mp3") {
    return value.snipped === true || preset.includes("preview")
      ? "preview_mp3_128_url"
      : "http_mp3_128_url";
  }
  return null;
}

function validateTranscodingUrl(value: unknown, trackId: string): URL {
  const url = validateDirectApiUrl(String(value ?? ""));
  const match = /^\/media\/soundcloud:tracks:([0-9]{1,32})\/[A-Za-z0-9_-]{8,128}\/stream\/(?:hls|progressive)$/.exec(
    url.pathname,
  );
  if (url.hostname !== "api-v2.soundcloud.com" || match?.[1] !== trackId) {
    throw new DirectSoundCloudError(
      "Blocked SoundCloud transcoding URL.",
      502,
      "blocked_transcoding_url",
    );
  }
  return url;
}

function validateMediaUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) {
    throw new DirectSoundCloudError(
      "Invalid SoundCloud media URL.",
      502,
      "invalid_media_url",
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new DirectSoundCloudError(
      "Invalid SoundCloud media URL.",
      502,
      "invalid_media_url",
    );
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    !(
      url.hostname === "sndcdn.com" ||
      url.hostname.endsWith(".sndcdn.com") ||
      url.hostname === "playback.media-streaming.soundcloud.cloud"
    )
  ) {
    throw new DirectSoundCloudError(
      "Blocked SoundCloud media URL.",
      502,
      "blocked_media_url",
    );
  }
  return url;
}

/**
 * Route an already-signed SoundCloud media asset through Spicetify's public
 * CORS relay. hls.js loads manifests, keys and fragments with XHR, so every
 * nested request needs the same relay as the JSON API. Validation happens
 * before the target is embedded in the relay URL; this must never become a
 * general-purpose proxy primitive.
 */
export function soundCloudMediaProxyUrl(value: string | URL): string {
  const target = validateMediaUrl(value instanceof URL ? value.toString() : value);
  const proxied = new URL(`${SPICETIFY_CORS_PROXY_ORIGIN}/${target.toString()}`);
  if (
    proxied.origin !== SPICETIFY_CORS_PROXY_ORIGIN ||
    !proxied.pathname.startsWith("/https://") ||
    proxied.username ||
    proxied.password
  ) {
    throw new DirectSoundCloudError(
      "Could not build the Spotify-only SoundCloud media request.",
      0,
      "invalid_media_proxy_url",
    );
  }
  return proxied.toString();
}

/** Configure one hls.js XHR without allowing cookies or ambient credentials. */
export function configureSoundCloudMediaXhr(
  xhr: Pick<XMLHttpRequest, "open" | "withCredentials">,
  value: string | URL,
): void {
  const relayUrl = soundCloudMediaProxyUrl(value);
  xhr.open("GET", relayUrl, true);
  xhr.withCredentials = false;
}

function rawTrackId(value: Record<string, unknown>): string | null {
  const urnMatch =
    typeof value.urn === "string"
      ? /^soundcloud:tracks:([0-9]{1,32})$/.exec(value.urn)
      : null;
  if (urnMatch) return urnMatch[1];
  if (typeof value.id === "string" && /^[0-9]{1,32}$/.test(value.id)) {
    return value.id;
  }
  if (Number.isSafeInteger(value.id) && Number(value.id) >= 0) {
    return String(value.id);
  }
  return null;
}

async function resolveStreamsFromTrack(
  rawTrack: Record<string, unknown>,
  expectedTrackId: string,
  options: Omit<DirectRequestOptions, "method" | "query" | "body">,
  consumerProductAvailable?: boolean,
  excludeAacRendition?: SCAacRendition,
): Promise<DirectTrackStreams> {
  const policy =
    typeof rawTrack.policy === "string"
      ? rawTrack.policy.trim().toUpperCase()
      : "";
  if (
    rawTrack.access === "blocked" ||
    policy === "BLOCK"
  ) {
    throw new DirectSoundCloudError(
      "This track is blocked for off-platform playback.",
      403,
      "track_blocked",
    );
  }
  const media = isRecord(rawTrack.media) ? rawTrack.media : null;
  const transcodings = Array.isArray(media?.transcodings)
    ? media.transcodings.slice(0, 32).filter(isRecord)
    : [];
  if (transcodings.length < 1 || transcodings.length > 32) {
    throw new DirectSoundCloudError(
      "No supported SoundCloud stream is available.",
      502,
      "stream_unavailable",
    );
  }
  const trackAuthorization = rawTrack.track_authorization;
  if (
    trackAuthorization !== undefined &&
    trackAuthorization !== null &&
    (typeof trackAuthorization !== "string" ||
      trackAuthorization.length < 1 ||
      trackAuthorization.length > 2_048 ||
      !/^[\x21-\x7e]+$/.test(trackAuthorization))
  ) {
    throw new DirectSoundCloudError(
      "SoundCloud returned invalid playback authorization.",
      502,
      "invalid_track_authorization",
    );
  }
  const snippetized =
    policy === "SNIP" ||
    transcodings.some((transcoding) => transcoding?.snipped === true);
  const hasFullTranscoding = transcodings.some(
    (transcoding) => transcoding?.snipped === false,
  );
  const fullPlayable =
    hasFullTranscoding ||
    (rawTrack.access === "playable" && policy !== "SNIP");
  if (
    snippetized &&
    !fullPlayable &&
    consumerProductAvailable === false
  ) {
    throw new DirectSoundCloudError(
      "This preview requires a SoundCloud consumer product that is unavailable in your country.",
      403,
      "track_region_blocked",
      authorizationGeo(trackAuthorization),
    );
  }

  const candidates = transcodings
    .map((transcoding) => ({
      transcoding,
      rank: transcodingRank(transcoding),
      field: streamField(transcoding),
      fullness:
        transcoding.snipped === false
          ? 2
          : transcoding.snipped === true
            ? 0
            : 1,
    }))
    .filter(
      (candidate): candidate is {
        transcoding: Record<string, unknown>;
        rank: number;
        field: keyof DirectTrackStreams;
        fullness: number;
      } => candidate.rank >= 0 && candidate.field !== null &&
        !(excludeAacRendition === 160 && candidate.field === "hls_aac_160_url") &&
        !(excludeAacRendition === 96 && candidate.field === "hls_aac_96_url"),
    )
    .sort(
      (left, right) =>
        right.fullness - left.fullness || right.rank - left.rank,
    );

  const streams: DirectTrackStreams = {};
  for (const { transcoding, field } of candidates) {
    // Candidates are ranked highest first. Keep the first valid URL for each
    // stream class so a later, lower-ranked candidate can never replace it.
    if (streams[field] !== undefined) continue;
    let url: URL;
    try {
      url = validateTranscodingUrl(transcoding.url, expectedTrackId);
    } catch {
      continue;
    }
    const query: DirectQuery = {};
    if (typeof trackAuthorization === "string") {
      query.track_authorization = trackAuthorization;
    }
    try {
      const payload = await directSoundCloudRequest<unknown>(url, {
        ...options,
        query,
      });
      const mediaUrl = validateMediaUrl(
        isRecord(payload) ? payload.url : undefined,
      ).toString();
      streams[field] = mediaUrl;
      // Candidates are already sorted in playback preference order. Return
      // after the first valid URL so a lower-priority legacy transcoding can
      // neither replace nor prevent a usable modern stream. SoundCloud
      // removed progressive MP3 from its streaming API and now directs
      // clients to prefer AAC HLS, retaining MP3 HLS only as a catalog
      // migration fallback.
      return streams;
    } catch (error) {
      if (
        error instanceof DirectSoundCloudError &&
        [400, 403, 404, 422].includes(error.status)
      ) {
        continue;
      }
      throw error;
    }
  }
  if (Object.keys(streams).length > 0) return streams;
  throw new DirectSoundCloudError(
    "No supported SoundCloud stream is available.",
    502,
    "stream_unavailable",
  );
}

export async function resolveDirectTrackStreams(
  urn: SoundCloudUrn,
  options: DirectMediaResolveOptions = {},
): Promise<{ track: unknown; streams: DirectTrackStreams }> {
  const {
    consumerProductAvailable,
    excludeAacRendition,
    ...requestOptions
  } = options;
  const trackId = soundCloudNumericId(urn, "track");
  const track = await directSoundCloudRequest<unknown>(
    `/tracks/${trackId}`,
    requestOptions,
  );
  if (!isRecord(track) || rawTrackId(track) !== trackId) {
    throw new DirectSoundCloudError(
      "SoundCloud returned invalid track metadata.",
      502,
      "invalid_track",
    );
  }
  const streams = await resolveStreamsFromTrack(
    track,
    trackId,
    requestOptions,
    consumerProductAvailable,
    excludeAacRendition,
  );
  return { track, streams };
}

function mediaUrlExpiry(url: URL, now: number): number {
  const expiries: number[] = [];
  const queryExpiry = Number(url.searchParams.get("Expires"));
  if (Number.isFinite(queryExpiry) && queryExpiry > 0) {
    expiries.push(queryExpiry * 1_000);
  }
  const policy = url.searchParams.get("Policy");
  if (policy) {
    try {
      const normalized = policy
        .replace(/-/g, "+")
        .replace(/_/g, "=")
        .replace(/~/g, "/");
      const padded = normalized.padEnd(
        normalized.length + ((4 - (normalized.length % 4)) % 4),
        "=",
      );
      const decoded = JSON.parse(window.atob(padded)) as unknown;
      const statement = isRecord(decoded) && Array.isArray(decoded.Statement)
        ? decoded.Statement[0]
        : null;
      const condition = isRecord(statement) ? statement.Condition : null;
      const dateLessThan = isRecord(condition) ? condition.DateLessThan : null;
      const epoch = isRecord(dateLessThan)
        ? Number(dateLessThan["AWS:EpochTime"])
        : 0;
      if (Number.isFinite(epoch) && epoch > 0) expiries.push(epoch * 1_000);
    } catch {
      // Optional CloudFront policy parsing only tightens the local expiry.
    }
  }
  return Math.floor(
    expiries.length
      ? Math.min(now + DEFAULT_MEDIA_TTL_MS, ...expiries)
      : now + DEFAULT_MEDIA_TTL_MS,
  );
}

export async function resolveDirectMediaSource(
  trackOrUrn: SCTrack | SoundCloudUrn,
  options: DirectMediaResolveOptions = {},
): Promise<SCMediaSource> {
  if (
    typeof trackOrUrn !== "string" &&
    (trackOrUrn.access === "blocked" || trackOrUrn.policy === "BLOCK")
  ) {
    throw new DirectSoundCloudError(
      "This track is blocked for off-platform playback.",
      403,
      "track_blocked",
    );
  }
  const urn =
    typeof trackOrUrn === "string"
      ? trackOrUrn
      : trackOrUrn.urn || trackOrUrn.id;
  const { track, streams } = await resolveDirectTrackStreams(urn, options);
  if (!isRecord(track)) {
    throw new DirectSoundCloudError(
      "SoundCloud returned invalid track metadata.",
      502,
      "invalid_track",
    );
  }
  const policy =
    typeof track.policy === "string"
      ? track.policy.trim().toUpperCase()
      : "";
  const rawTranscodings =
    isRecord(track.media) && Array.isArray(track.media.transcodings)
      ? (track.media.transcodings as RawTranscoding[])
      : [];
  const hasSnippedTranscoding = rawTranscodings.some(
    (transcoding) => transcoding?.snipped === true,
  );
  const hasFullTranscoding = rawTranscodings.some(
    (transcoding) => transcoding?.snipped === false,
  );
  const snippetized =
    track.access === "preview" ||
    policy === "SNIP" ||
    (hasSnippedTranscoding && !hasFullTranscoding);
  const access: "playable" | "preview" =
    snippetized
      ? "preview"
      : track.access === "playable" ||
          track.streamable === true ||
          hasFullTranscoding
        ? "playable"
        : (() => {
            throw new DirectSoundCloudError(
              "This track is blocked for off-platform playback.",
              403,
              "track_blocked",
            );
          })();
  const progressive =
    streams.http_mp3_128_url ??
    (access === "preview" ? streams.preview_mp3_128_url : undefined);
  const hls =
    // SoundCloud's current streaming contract is AAC HLS first and legacy
    // MP3 HLS second. The selected codec travels with the URL so the player
    // can use its bundled software AAC path when Spotify's CEF omits AAC MSE.
    streams.hls_aac_160_url ??
    streams.hls_aac_96_url ??
    streams.hls_mp3_128_url ??
    undefined;
  const selected = progressive ?? hls;
  if (!selected) {
    throw new DirectSoundCloudError(
      "No supported SoundCloud stream is available.",
      502,
      "stream_unavailable",
    );
  }
  const mediaUrl = validateMediaUrl(selected);
  const now = Date.now();
  const expiresAt = mediaUrlExpiry(mediaUrl, now);
  if (expiresAt <= now + 5_000) {
    throw new DirectSoundCloudError(
      "SoundCloud returned an expired media URL.",
      502,
      "expired_media_url",
    );
  }
  const media = { url: mediaUrl.toString(), expiresAt, access };
  if (progressive) return { ...media, kind: "progressive", codec: "mp3" };
  if (streams.hls_aac_160_url || streams.hls_aac_96_url) {
    return {
      ...media,
      kind: "hls",
      codec: "aac",
      aacRendition: streams.hls_aac_160_url ? 160 : 96,
    };
  }
  return { ...media, kind: "hls", codec: "mp3" };
}

export const createDirectMediaSource = resolveDirectMediaSource;
