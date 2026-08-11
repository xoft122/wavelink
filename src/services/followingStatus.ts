export interface FollowingUserIdentity {
  id?: unknown;
  urn?: unknown;
}

export interface FollowingPage {
  collection: readonly FollowingUserIdentity[];
  next_href?: string | null;
}

export interface FollowingStatusCache {
  get: (key: string, options?: { force?: boolean }) => Promise<Set<string>>;
  invalidate: () => void;
}

const DEFAULT_MAX_PAGES = 250;
const DEFAULT_CACHE_TTL_MS = 60_000;
const USER_ID_PATTERN = /^(?:soundcloud:users:)?([0-9]{1,32})$/;

/**
 * Reduce either a numeric SoundCloud user ID or its canonical URN to the same
 * stable cache key. Invalid resource kinds must never be treated as a user.
 */
export function canonicalFollowingUserId(value: unknown): string {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? ((value as FollowingUserIdentity).urn ??
        (value as FollowingUserIdentity).id)
      : value;
  const text =
    typeof candidate === "number" && Number.isSafeInteger(candidate)
      ? String(candidate)
      : typeof candidate === "string"
        ? candidate
        : "";
  const match = USER_ID_PATTERN.exec(text);
  if (!match) throw new Error("Invalid SoundCloud user ID.");
  return match[1];
}

/**
 * Load the complete following collection before concluding that a user is not
 * present. A repeated cursor, unfinished page limit, or failed later page is an
 * error: caching a partial collection would produce false Follow labels.
 */
export async function collectFollowingUserIds(
  loadFirst: () => Promise<FollowingPage>,
  loadNext: (cursor: string) => Promise<FollowingPage>,
  maxPages = DEFAULT_MAX_PAGES,
): Promise<Set<string>> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error("Invalid following page limit.");
  }

  const ids = new Set<string>();
  const seenCursors = new Set<string>();
  let page = await loadFirst();
  let pageCount = 0;

  while (true) {
    pageCount += 1;
    for (const user of page.collection ?? []) {
      ids.add(canonicalFollowingUserId(user));
    }

    const cursor =
      typeof page.next_href === "string" && page.next_href
        ? page.next_href
        : null;
    if (!cursor) return ids;
    if (seenCursors.has(cursor)) {
      throw new Error("SoundCloud returned a repeated following cursor.");
    }
    if (pageCount >= maxPages) {
      throw new Error("SoundCloud following pagination exceeded its safe limit.");
    }
    seenCursors.add(cursor);
    page = await loadNext(cursor);
  }
}

/**
 * Credential-scoped, generation-safe cache. Forced refreshes and invalidation
 * prevent an older request from replacing fresher state when it completes.
 */
export function createFollowingStatusCache(
  loader: (key: string) => Promise<ReadonlySet<string>>,
  ttlMs = DEFAULT_CACHE_TTL_MS,
): FollowingStatusCache {
  const safeTtl = Number.isFinite(ttlMs) ? Math.max(0, ttlMs) : 0;
  let generation = 0;
  let cached: {
    key: string;
    expiresAt: number;
    ids: ReadonlySet<string>;
  } | null = null;
  let inFlight: {
    key: string;
    generation: number;
    forced: boolean;
    promise: Promise<Set<string>>;
  } | null = null;

  const invalidate = () => {
    generation += 1;
    cached = null;
    inFlight = null;
  };

  const get = async (
    key: string,
    options: { force?: boolean } = {},
  ): Promise<Set<string>> => {
    if (!key) throw new Error("Missing following cache key.");

    if (
      (cached && cached.key !== key) ||
      (inFlight && inFlight.key !== key)
    ) {
      invalidate();
    }

    const force = options.force === true;
    const now = Date.now();
    if (
      !force &&
      cached?.key === key &&
      cached.expiresAt > now
    ) {
      return new Set(cached.ids);
    }
    if (
      inFlight?.key === key &&
      (!force || inFlight.forced)
    ) {
      return new Set(await inFlight.promise);
    }

    if (force) {
      generation += 1;
      cached = null;
      inFlight = null;
    }
    const requestGeneration = generation;
    const promise = loader(key).then((loaded) => {
      const snapshot = new Set(loaded);
      if (generation === requestGeneration) {
        cached = {
          key,
          expiresAt: Date.now() + safeTtl,
          ids: snapshot,
        };
      }
      return snapshot;
    });
    const request = {
      key,
      generation: requestGeneration,
      forced: force,
      promise,
    };
    inFlight = request;

    try {
      return new Set(await promise);
    } finally {
      if (inFlight === request) inFlight = null;
    }
  };

  return { get, invalidate };
}
