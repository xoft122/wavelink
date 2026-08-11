import type { SCTrack } from "../types/soundcloud";

export const TRACK_UNAVAILABLE_COUNTRY_LABEL =
  "Not available in your country";
export const TRACK_UNAVAILABLE_PLAYBACK_LABEL =
  "Not available for playback";

export type TrackRepeatMode = "off" | "all" | "one";
export type TrackUnavailableReason =
  | "country"
  | "blocked"
  | "no_stream";
export type TrackPlaybackCapability =
  | "full"
  | "preview"
  | "none"
  | "unknown";

type TrackAvailabilitySignals = Partial<
  Pick<
    SCTrack,
    | "id"
    | "urn"
    | "access"
    | "policy"
    | "streamable"
    | "has_transcodings"
    | "has_snipped_transcoding"
    | "has_full_transcoding"
    | "full_playable"
    | "preview_playable"
    | "authorization_geo"
  >
>;

export interface TrackAvailability {
  unavailable: boolean;
  reason: TrackUnavailableReason | null;
  playback: TrackPlaybackCapability;
}

interface RuntimeUnavailableEntry {
  reason: TrackUnavailableReason;
  countryCode?: string;
}

interface ConsumerProductContext {
  version: 1;
  available: boolean | undefined;
  credentialKey: string | null;
  revision: number;
}

const SESSION_CACHE_SYMBOL = Symbol.for(
  "wavelink.track-availability.unavailable-entries.v2",
);
const PRODUCT_CONTEXT_SYMBOL = Symbol.for(
  "wavelink.track-availability.consumer-product.v1",
);
const moduleUnavailableEntries = new Map<string, RuntimeUnavailableEntry>();
const moduleProductContext: ConsumerProductContext = {
  version: 1,
  available: undefined,
  credentialKey: null,
  revision: 0,
};

function canonicalTrackKey(
  track: Pick<TrackAvailabilitySignals, "id" | "urn"> | null | undefined,
): string | null {
  const raw = track?.urn || track?.id;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key ? key.toLowerCase() : null;
}

function safeCountryCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : undefined;
}

/**
 * Share resolver-confirmed failures between WaveLink's separately bundled
 * startup extension and custom app. The cache is document/session-only.
 */
function sessionUnavailableEntries(): Map<string, RuntimeUnavailableEntry> {
  if (typeof window === "undefined") return moduleUnavailableEntries;
  const scope = window as unknown as Record<PropertyKey, unknown>;
  const existing = scope[SESSION_CACHE_SYMBOL];
  if (existing instanceof Map) {
    return existing as Map<string, RuntimeUnavailableEntry>;
  }
  try {
    Object.defineProperty(scope, SESSION_CACHE_SYMBOL, {
      configurable: true,
      value: moduleUnavailableEntries,
    });
  } catch {
    // A locked-down host object still gets correct per-bundle behaviour.
  }
  return moduleUnavailableEntries;
}

/** Consumer subscription availability shared by both WaveLink bundles. */
function consumerProductContext(): ConsumerProductContext {
  if (typeof window === "undefined") return moduleProductContext;
  const scope = window as unknown as Record<PropertyKey, unknown>;
  const existing = scope[PRODUCT_CONTEXT_SYMBOL];
  if (
    existing &&
    typeof existing === "object" &&
    (existing as ConsumerProductContext).version === 1
  ) {
    return existing as ConsumerProductContext;
  }
  try {
    Object.defineProperty(scope, PRODUCT_CONTEXT_SYMBOL, {
      configurable: true,
      value: moduleProductContext,
    });
  } catch {
    // Keep the module-local fallback in restricted host environments.
  }
  return moduleProductContext;
}

export function getConsumerProductAvailability(
  credentialKey?: string,
): boolean | undefined {
  const context = consumerProductContext();
  return credentialKey === undefined || context.credentialKey === credentialKey
    ? context.available
    : undefined;
}

export function setConsumerProductAvailability(
  available: boolean | undefined,
  credentialKey?: string,
): void {
  const context = consumerProductContext();
  const nextKey =
    credentialKey === undefined ? context.credentialKey : credentialKey;
  if (
    context.available === available &&
    context.credentialKey === nextKey
  ) {
    return;
  }
  context.credentialKey = nextKey;
  context.available = available;
  context.revision += 1;
}

export function resetConsumerProductAvailability(): void {
  const context = consumerProductContext();
  if (context.available === undefined && context.credentialKey === null) return;
  context.available = undefined;
  context.credentialKey = null;
  context.revision += 1;
}

/**
 * Select the active credential generation without exposing the credentials.
 * A bundle receiving the same settings event preserves a product bit already
 * hydrated by the other WaveLink bundle.
 */
export function prepareConsumerProductAvailability(
  credentialKey: string | null,
): void {
  const context = consumerProductContext();
  if (context.credentialKey === credentialKey) return;
  context.credentialKey = credentialKey;
  context.available = undefined;
  context.revision += 1;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * Reduce SoundCloud's billing quotation to one non-sensitive tri-state bit.
 * Partial/error payloads stay unknown so a transient endpoint failure can
 * never turn every SNIP preview into a false regional block.
 */
export function normalizeConsumerProductAvailability(
  value: unknown,
): boolean | undefined {
  if (!isRecord(value)) return undefined;
  const plans = Array.isArray(value.plans) ? value.plans : undefined;
  const active = isRecord(value.active_subscription)
    ? value.active_subscription
    : undefined;
  const packageValue = isRecord(active?.package)
    ? active.package
    : undefined;
  const product = String(packageValue?.product ?? "")
    .trim()
    .toLowerCase();
  const tier = String(packageValue?.tier ?? "").trim().toLowerCase();
  const plan = String(packageValue?.plan ?? "").trim().toLowerCase();
  const eligible =
    typeof active?.is_eligible === "boolean"
      ? active.is_eligible
      : typeof value.is_eligible === "boolean"
        ? value.is_eligible
        : undefined;

  if (plans && plans.length > 0) return true;
  if (eligible === true) return true;
  if (
    product === "consumer-subscription" &&
    ((tier && tier !== "free") || (plan && plan !== "free"))
  ) {
    return true;
  }
  if (
    plans?.length === 0 &&
    eligible === false &&
    product === "consumer-subscription" &&
    (tier === "free" || plan === "free")
  ) {
    return false;
  }
  return undefined;
}

function fullPlaybackSignal(track: TrackAvailabilitySignals): boolean | undefined {
  if (typeof track.full_playable === "boolean") return track.full_playable;
  if (track.has_full_transcoding === true) return true;
  if (
    track.access === "playable" &&
    String(track.policy ?? "").trim().toUpperCase() !== "SNIP"
  ) {
    return true;
  }
  if (
    track.access === "preview" ||
    track.access === "blocked" ||
    String(track.policy ?? "").trim().toUpperCase() === "SNIP" ||
    track.streamable === false ||
    track.has_snipped_transcoding === true
  ) {
    return false;
  }
  return undefined;
}

function previewPlaybackSignal(
  track: TrackAvailabilitySignals,
): boolean | undefined {
  if (typeof track.preview_playable === "boolean") {
    return track.preview_playable;
  }
  if (
    track.access === "preview" ||
    track.has_snipped_transcoding === true
  ) {
    return true;
  }
  if (track.has_transcodings === false) return false;
  return undefined;
}

function isSnippetized(track: TrackAvailabilitySignals): boolean {
  return (
    String(track.policy ?? "").trim().toUpperCase() === "SNIP" ||
    track.has_snipped_transcoding === true
  );
}

/**
 * Mirrors the SoundCloud web-client rule:
 * snippetized + not fully playable + consumer product unavailable.
 */
export function classifyTrackAvailability(
  track: TrackAvailabilitySignals | null | undefined,
): TrackAvailability {
  if (!track) {
    return { unavailable: false, reason: null, playback: "unknown" };
  }
  const key = canonicalTrackKey(track);
  const runtime = key ? sessionUnavailableEntries().get(key) : undefined;
  if (runtime) {
    return { unavailable: true, reason: runtime.reason, playback: "none" };
  }

  const policy = String(track.policy ?? "").trim().toUpperCase();
  if (track.access === "blocked" || policy === "BLOCK") {
    return { unavailable: true, reason: "blocked", playback: "none" };
  }
  if (track.has_transcodings === false) {
    return { unavailable: true, reason: "no_stream", playback: "none" };
  }

  const fullPlayable = fullPlaybackSignal(track);
  const previewPlayable = previewPlaybackSignal(track);
  if (fullPlayable === true) {
    return { unavailable: false, reason: null, playback: "full" };
  }
  if (
    isSnippetized(track) &&
    fullPlayable === false &&
    getConsumerProductAvailability() === false
  ) {
    return { unavailable: true, reason: "country", playback: "none" };
  }
  if (previewPlayable === true || isSnippetized(track)) {
    return { unavailable: false, reason: null, playback: "preview" };
  }
  return { unavailable: false, reason: null, playback: "unknown" };
}

export function isTrackUnavailable(
  track: TrackAvailabilitySignals | null | undefined,
): boolean {
  return classifyTrackAvailability(track).unavailable;
}

/**
 * Remember a resolver-confirmed failure without changing SoundCloud metadata.
 * The reason keeps generic stream failures from receiving a false geo label.
 */
export function markTrackUnavailable<T extends SCTrack>(
  track: T,
  reason: TrackUnavailableReason = "no_stream",
  countryCode?: string,
): T {
  const key = canonicalTrackKey(track);
  if (key) {
    sessionUnavailableEntries().set(key, {
      reason,
      countryCode: safeCountryCode(countryCode),
    });
  }
  return track;
}

function soundCloudErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function soundCloudErrorCountryCode(
  error: unknown,
): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  return safeCountryCode((error as { countryCode?: unknown }).countryCode);
}

export function unavailableReasonForError(
  error: unknown,
): TrackUnavailableReason | null {
  switch (soundCloudErrorCode(error)) {
    case "track_region_blocked":
      return "country";
    case "track_blocked":
      return "blocked";
    case "stream_unavailable":
      return "no_stream";
    default:
      return null;
  }
}

export function isCountryBlockedError(error: unknown): boolean {
  return soundCloudErrorCode(error) === "track_region_blocked";
}

export function isAutomaticallySkippableMediaError(error: unknown): boolean {
  return unavailableReasonForError(error) !== null;
}

function countryName(code: string): string | null {
  try {
    const intl = Intl as unknown as {
      DisplayNames?: new (
        locales: string[],
        options: { type: "region" },
      ) => { of(value: string): string | undefined };
    };
    const name = intl.DisplayNames
      ? new intl.DisplayNames(["en"], { type: "region" }).of(code)
      : undefined;
    return name && name !== code ? name : null;
  } catch {
    return null;
  }
}

export function trackUnavailableLabel(
  track: TrackAvailabilitySignals | null | undefined,
): string {
  const availability = classifyTrackAvailability(track);
  if (availability.reason !== "country") {
    return TRACK_UNAVAILABLE_PLAYBACK_LABEL;
  }
  const key = canonicalTrackKey(track);
  const runtimeCode = key
    ? sessionUnavailableEntries().get(key)?.countryCode
    : undefined;
  const code = safeCountryCode(runtimeCode ?? track?.authorization_geo);
  const name = code ? countryName(code) : null;
  return name
    ? `Not available in ${name}`
    : TRACK_UNAVAILABLE_COUNTRY_LABEL;
}

function isAvailableQueueCandidate(
  track: SCTrack | null | undefined,
  attemptedKeys?: ReadonlySet<string>,
): boolean {
  if (!track || isTrackUnavailable(track)) return false;
  const key = canonicalTrackKey(track);
  return !key || !attemptedKeys?.has(key);
}

/**
 * Select the next explicit playable entry while examining at most one full
 * queue. Repeat-all may wrap once; repeat-one affects automatic end handling
 * only, so its queue preview behaves like repeat-off.
 */
export function nextAvailableTrackIndex(
  tracks: readonly SCTrack[],
  currentIndex: number,
  repeat: TrackRepeatMode,
  attemptedKeys?: ReadonlySet<string>,
): number | null {
  const length = tracks.length;
  if (length === 0) return null;

  const validCurrent =
    Number.isInteger(currentIndex) &&
    currentIndex >= 0 &&
    currentIndex < length;
  if (Number.isInteger(currentIndex) && currentIndex >= length) return null;
  const base = validCurrent ? currentIndex : -1;
  const mayWrap = repeat === "all";
  for (let offset = 1; offset <= length; offset++) {
    const rawIndex = base + offset;
    if (!mayWrap && rawIndex >= length) break;
    const index = ((rawIndex % length) + length) % length;
    if (isAvailableQueueCandidate(tracks[index], attemptedKeys)) return index;
  }
  return null;
}

/** Select the nearest earlier playable entry without wrapping. */
export function previousAvailableTrackIndex(
  tracks: readonly SCTrack[],
  currentIndex: number,
): number | null {
  if (
    tracks.length === 0 ||
    !Number.isInteger(currentIndex) ||
    currentIndex <= 0
  ) {
    return null;
  }
  for (
    let index = Math.min(currentIndex - 1, tracks.length - 1);
    index >= 0;
    index--
  ) {
    if (isAvailableQueueCandidate(tracks[index])) return index;
  }
  return null;
}
