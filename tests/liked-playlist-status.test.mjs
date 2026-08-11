import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/likedPlaylistStatus.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const likedPlaylists = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function sorted(values) {
  return [...values].sort();
}

test("liked playlist IDs canonicalize numeric IDs and playlist URNs", () => {
  assert.equal(likedPlaylists.canonicalLikedPlaylistId("91"), "91");
  assert.equal(
    likedPlaylists.canonicalLikedPlaylistId("soundcloud:playlists:91"),
    "91",
  );
  assert.equal(
    likedPlaylists.canonicalLikedPlaylistId({
      id: "91",
      urn: "soundcloud:playlists:91",
    }),
    "91",
  );
  for (const invalid of [
    "",
    "soundcloud:tracks:91",
    "soundcloud:users:91",
    "soundcloud:playlists:nope",
  ]) {
    assert.throws(() => likedPlaylists.canonicalLikedPlaylistId(invalid));
  }
});

test("liked playlist membership exhausts every page and deduplicates IDs", async () => {
  const cursors = [];
  const pages = new Map([
    [
      "page-2",
      {
        collection: [
          { urn: "soundcloud:playlists:22" },
          { id: "33" },
        ],
        next_href: "page-3",
      },
    ],
    [
      "page-3",
      {
        collection: [
          { urn: "soundcloud:playlists:11" },
          { urn: "soundcloud:playlists:44" },
        ],
        next_href: null,
      },
    ],
  ]);

  const ids = await likedPlaylists.collectLikedPlaylistIds(
    async () => ({
      collection: [{ id: "11" }],
      next_href: "page-2",
    }),
    async (cursor) => {
      cursors.push(cursor);
      return pages.get(cursor);
    },
  );

  assert.deepEqual(cursors, ["page-2", "page-3"]);
  assert.deepEqual(sorted(ids), ["11", "22", "33", "44"]);
});

test("liked playlist membership rejects incomplete or looping pagination", async () => {
  await assert.rejects(
    likedPlaylists.collectLikedPlaylistIds(
      async () => ({ collection: [{ id: "1" }], next_href: "same" }),
      async () => ({ collection: [{ id: "2" }], next_href: "same" }),
    ),
    /repeated/i,
  );
  await assert.rejects(
    likedPlaylists.collectLikedPlaylistIds(
      async () => ({ collection: [{ id: "1" }], next_href: "page-2" }),
      async () => ({ collection: [{ id: "2" }], next_href: null }),
      1,
    ),
    /safe limit/i,
  );
});

test("playlist detail uses authoritative membership and force-refreshes after SoundCloud", async () => {
  const [apiSource, detailSource] = await Promise.all([
    readFile(new URL("../src/services/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/PlaylistDetailView.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(apiSource, /collectLikedPlaylistIds/);
  assert.match(apiSource, /getLikedPlaylists\(200\)/);
  assert.match(apiSource, /fetchNextPage<SCPlaylist>\(cursor\)/);
  assert.match(apiSource, /normalizeLikedPlaylistCollection\(payload\)/);
  assert.match(apiSource, /"liked-playlist": likedPlaylistEntityNormalizer/);
  assert.match(apiSource, /invalidateLikedPlaylistIds\(\)/);
  assert.match(
    detailSource,
    /isPlaylistLiked\(playlistKey,\s*\{\s*force:\s*playlist\.user_favorite === true,\s*\}\)/,
  );
  assert.match(
    detailSource,
    /isPlaylistLiked\(playlistKey,\s*\{\s*force:\s*true\s*\}\)/,
  );
  assert.doesNotMatch(detailSource, /setLiked\(Boolean\(value\.user_favorite\)\)/);
  assert.match(detailSource, /setDetail\(\{ \.\.\.value, user_favorite: resolvedLiked \}\)/);
  assert.match(detailSource, /setDetail\(\{ \.\.\.value, user_favorite: isLiked \}\)/);
  assert.match(detailSource, /setLiked\(isLiked\)/);
  assert.match(detailSource, /disabled=\{loading \|\| Boolean\(actionBusy\)/);
  assert.match(detailSource, /detailRequestGenerationRef\.current \+= 1/);
});
