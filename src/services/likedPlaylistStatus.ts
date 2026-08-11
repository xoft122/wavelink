export interface LikedPlaylistIdentity {
  id?: unknown;
  urn?: unknown;
}

export interface LikedPlaylistPage {
  collection: readonly LikedPlaylistIdentity[];
  next_href?: string | null;
}

const DEFAULT_MAX_PAGES = 250;
const PLAYLIST_ID_PATTERN = /^(?:soundcloud:playlists:)?([0-9]{1,32})$/;

export function canonicalLikedPlaylistId(value: unknown): string {
  const candidate =
    value && typeof value === "object" && !Array.isArray(value)
      ? ((value as LikedPlaylistIdentity).urn ??
        (value as LikedPlaylistIdentity).id)
      : value;
  const text =
    typeof candidate === "number" && Number.isSafeInteger(candidate)
      ? String(candidate)
      : typeof candidate === "string"
        ? candidate
        : "";
  const match = PLAYLIST_ID_PATTERN.exec(text.trim());
  if (!match) throw new Error("Invalid SoundCloud playlist ID.");
  return match[1];
}

export async function collectLikedPlaylistIds(
  loadFirst: () => Promise<LikedPlaylistPage>,
  loadNext: (cursor: string) => Promise<LikedPlaylistPage>,
  maxPages = DEFAULT_MAX_PAGES,
): Promise<Set<string>> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
    throw new Error("Invalid liked-playlist page limit.");
  }

  const ids = new Set<string>();
  const seenCursors = new Set<string>();
  let page = await loadFirst();
  let pageCount = 0;

  while (true) {
    pageCount += 1;
    for (const playlist of page.collection ?? []) {
      ids.add(canonicalLikedPlaylistId(playlist));
    }

    const cursor =
      typeof page.next_href === "string" && page.next_href
        ? page.next_href
        : null;
    if (!cursor) return ids;
    if (seenCursors.has(cursor)) {
      throw new Error("SoundCloud returned a repeated liked-playlist cursor.");
    }
    if (pageCount >= maxPages) {
      throw new Error("SoundCloud liked-playlist pagination exceeded its safe limit.");
    }
    seenCursors.add(cursor);
    page = await loadNext(cursor);
  }
}
