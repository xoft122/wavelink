import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/queueHydration.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const queueModel = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function track(id, title = `Track ${id}`) {
  return {
    id: `soundcloud:tracks:${id}`,
    urn: `soundcloud:tracks:${id}`,
    title,
    permalink_url: `https://soundcloud.com/artist/track-${id}`,
  };
}

test("a rendered subset maps its selected row into the full queue", () => {
  const all = [track(1), track(2), track(3), track(4)];
  assert.equal(
    queueModel.findTrackQueueIndex(all, all[1], all.slice(0, 2), 1),
    1,
  );
  assert.equal(
    queueModel.findTrackQueueIndex(all, all[3], all.slice(2), 1),
    3,
    "exact references also support a non-prefix rendered subset",
  );
});

test("canonical fallback preserves repeated track occurrences", () => {
  const first = track(5, "First occurrence");
  const second = track(5, "Second occurrence");
  const queue = [first, track(6), second];
  const rendered = [track(5, "Clone one"), track(5, "Clone two")];

  assert.equal(
    queueModel.findTrackQueueIndex(queue, rendered[1], rendered, 1),
    2,
  );
  assert.equal(
    queueModel.findTrackQueueIndex(queue, track(99), rendered, 0),
    -1,
  );
});

test("queue equality accepts normalized clones but not order or length changes", () => {
  const original = [track(1), track(2)];
  assert.equal(
    queueModel.sameTrackQueue(original, [track(1), track(2)]),
    true,
  );
  assert.equal(
    queueModel.sameTrackQueue(original, [track(2), track(1)]),
    false,
  );
  assert.equal(
    queueModel.sameTrackQueue(original, [track(1), track(2), track(3)]),
    false,
  );
});

test("compact history stays finite while lazy collections share their queue source", async () => {
  const [homeSource, collectionSource, playerSource] = await Promise.all([
    readFile(new URL("../src/components/HomeView.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/TrackCollection.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  ]);

  assert.match(homeSource, /tracks=\{visibleHistory\}/);
  assert.match(homeSource, /queueTracks=\{activeHistory\}/);
  assert.match(collectionSource, /queueTracks\?: SCTrack\[\]/);
  assert.match(
    collectionSource,
    /paginationSource\?: PaginatedTrackSource/,
  );
  assert.match(collectionSource, /findTrackQueueIndex\(/);
  assert.match(
    collectionSource,
    /paginationSource\s*\? player\.setQueueFromSource\(/,
  );
  assert.match(
    collectionSource,
    /: player\.setQueue\(safeQueueTracks, playbackIndex, context\)/,
  );
  assert.match(
    collectionSource,
    /if \(!paginationSource && resolveQueueTracks\)/,
  );

  // Legacy async replacement remains only for finite callers such as compact
  // local history. Playlist/profile/search queues hydrate through the source.
  assert.match(collectionSource, /player\.replaceQueueIfRevision\(/);

  const replacementStart = playerSource.indexOf(
    "replaceQueueIfRevision(",
  );
  const replacementEnd = playerSource.indexOf(
    "async playQueueIndex",
    replacementStart,
  );
  const replacement = playerSource.slice(replacementStart, replacementEnd);
  assert.ok(replacementStart >= 0 && replacementEnd > replacementStart);
  assert.match(replacement, /expectedRevision !== this\._queueRevision/);
  assert.match(replacement, /findTrackQueueIndex\(/);
  assert.match(replacement, /this\._queueRevision\+\+/);
  assert.doesNotMatch(replacement, /loadTrack\(/);
});
