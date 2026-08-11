import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(
  new URL("../src/services/api.ts", import.meta.url),
  "utf8",
);

function sourceSlice(startMarker, endMarker) {
  const start = apiSource.indexOf(startMarker);
  const end = apiSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);
  return apiSource.slice(start, end);
}

test("playlist track source performs one metadata request and lazy bulk pages", () => {
  const implementation = sourceSlice(
    "export async function getPlaylistTrackSource",
    "async function hydratePlaylistTracks",
  );
  const metadataRequests = implementation.match(
    /request<unknown>\(`\/playlists\/\$\{id\}`/g,
  );

  assert.equal(metadataRequests?.length, 1);
  assert.match(implementation, /query: \{ representation: "full" \}/);
  assert.match(
    implementation,
    /hydratePlaylistTrackReferencePage\(\s*references\.slice\(0, firstEnd\)/,
  );
  assert.match(implementation, /mergeMode: "preserve"/);
  assert.match(implementation, /loadPage: async \(cursor\)/);
  assert.match(
    implementation,
    /references\.slice\(offset, end\)/,
  );
  assert.match(implementation, /total_results: totalCount/);
});

test("playlist hydration uses bounded ids batches and restores reference order", () => {
  const implementation = sourceSlice(
    "async function hydratePlaylistTrackReferencePage",
    "/**\n * Load playlist metadata once",
  );

  assert.match(
    implementation,
    /offset \+= PLAYLIST_TRACK_SOURCE_BULK_SIZE/,
  );
  assert.match(implementation, /request<unknown>\("\/tracks"/);
  assert.match(implementation, /query: \{ ids: batch\.join\(","\) \}/);
  assert.match(implementation, /for \(const reference of references\)/);
  assert.match(
    implementation,
    /hydratedById\.get\(reference\.numericId\)/,
  );
  assert.match(implementation, /const track = hydrated \?\? reference\.embedded/);
});

test("profile track endpoints expose configurable bounded defaults", () => {
  const tracks = sourceSlice(
    "export async function getUserTracks",
    "export async function getUserPlaylists",
  );
  const likes = sourceSlice(
    "export async function getUserLikedTracks",
    "export interface FollowingStatusOptions",
  );

  assert.match(tracks, /limit = 50/);
  assert.match(tracks, /limit: boundedLimit\(limit\)/);
  assert.match(likes, /limit = 50/);
  assert.match(likes, /limit: boundedLimit\(limit\)/);
});

