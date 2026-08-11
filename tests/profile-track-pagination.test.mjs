import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [apiSource, profileSource, searchSource, playlistSource, collectionSource] =
  await Promise.all([
    readFile(new URL("../src/services/api.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/UserProfileView.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/SearchView.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/PlaylistDetailView.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/TrackCollection.tsx", import.meta.url),
      "utf8",
    ),
  ]);

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return source.slice(start, end);
}

test("profile track endpoints default to configurable 50-track pages", () => {
  const tracks = sourceSlice(
    apiSource,
    "export async function getUserTracks",
    "export async function getUserPlaylists",
  );
  const likes = sourceSlice(
    apiSource,
    "export async function getUserLikedTracks",
    "export interface FollowingStatusOptions",
  );

  assert.match(tracks, /limit = 50/);
  assert.match(tracks, /limit: boundedLimit\(limit\)/);
  assert.match(likes, /limit = 50/);
  assert.match(likes, /limit: boundedLimit\(limit\)/);
  assert.doesNotMatch(tracks, /limit = 200/);
});

test("artist Tracks and Likes tabs share lazy sources with their rendered queues", () => {
  assert.match(profileSource, /const \{ tracksPerLoad \} = usePlayer\(\)/);
  assert.match(
    profileSource,
    /getUserTracks\(profileUrn, tracksPerLoad\)/,
  );
  assert.match(
    profileSource,
    /getUserLikedTracks\(profileUrn, tracksPerLoad\)/,
  );
  assert.match(profileSource, /createPaginatedTrackSource\(\{/);
  assert.match(profileSource, /pageSize: tracksPerLoad/);
  assert.match(profileSource, /loadPage: \(cursor\) => fetchNextPage<SCTrack>\(cursor\)/);
  assert.match(
    profileSource,
    /totalCount:[\s\S]{0,160}profile\.track_count/,
  );
  assert.match(profileSource, /paginationSource=\{activeTrackSource \?\? undefined\}/);
  assert.match(
    profileSource,
    /target: \{ kind: "user", user: profile, profileTab: activeTab \}/,
  );

  // The previous implementation drained up to 2,000 tracks eagerly and then
  // replaced the queue. Source-backed tabs must no longer use that path.
  assert.doesNotMatch(profileSource, /loadProfileTrackBatch/);
  assert.doesNotMatch(profileSource, /getUserTracks\(profileUrn, 200\)/);
  assert.doesNotMatch(profileSource, /resolveQueueTracks=/);
});

test("search and playlist detail use the same configured lazy page size", () => {
  assert.match(searchSource, /const \{ tracksPerLoad \} = usePlayer\(\)/);
  assert.match(searchSource, /searchTracks\(clean, tracksPerLoad\)/);
  assert.match(searchSource, /pageSize: tracksPerLoad/);
  assert.match(searchSource, /loadPage: \(cursor\) => fetchNextPage<SCTrack>\(cursor\)/);
  assert.match(searchSource, /paginationSource=\{trackSource \?\? undefined\}/);

  assert.match(playlistSource, /const \{ tracksPerLoad \} = usePlayer\(\)/);
  assert.match(
    playlistSource,
    /getPlaylistTrackSource\(playlistKey, tracksPerLoad\)/,
  );
  assert.match(playlistSource, /paginationSource=\{trackSource \?\? undefined\}/);
  assert.match(
    playlistSource,
    /player\.setQueueFromSource\(trackSource, availableIndex, context\)/,
  );
});

test("rendered collections request the next page around the final quarter", () => {
  assert.match(
    collectionSource,
    /paginationPrefetchIndex\(\s*safeTracks\.length,\s*paginationSnapshot\.pageSize,\s*\)/,
  );
  assert.match(
    collectionSource,
    /index === paginationTriggerIndex[\s\S]{0,120}<TrackPaginationSentinel source=\{paginationSource\}/,
  );
  assert.match(collectionSource, /new IntersectionObserver\(/);
  assert.match(collectionSource, /root: marker\.closest\("\.wl-main"\)/);
  assert.match(collectionSource, /source\.loadNext\(\)/);
});
