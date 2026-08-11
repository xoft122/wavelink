import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/paginatedTrackSource.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const pagination = await import(
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

test("prefetch threshold starts the default next page around track 38", () => {
  assert.equal(pagination.paginationPrefetchIndex(50, 50), 37);
  assert.equal(pagination.paginationPrefetchIndex(100, 50), 87);
  assert.equal(pagination.paginationPrefetchIndex(2, 50), 0);
  assert.equal(pagination.paginationPrefetchIndex(50, Number.NaN), 37);
});

test("dedupe mode normalizes the first page and keeps totals at least loaded", async () => {
  const duplicate = track(1, "New duplicate metadata");
  const source = pagination.createPaginatedTrackSource({
    initialTracks: [track(1), track(1, "Duplicate")],
    nextHref: "page-2",
    totalCount: 1,
    pageSize: 50,
    mergeMode: "dedupe",
    loadPage: async () => ({
      collection: [duplicate, track(2)],
      next_href: null,
      total_results: 1,
    }),
  });

  assert.equal(source.getSnapshot().tracks.length, 1);
  const result = await source.loadNext();
  assert.deepEqual(
    result.tracks.map((item) => item.urn),
    ["soundcloud:tracks:1", "soundcloud:tracks:2"],
  );
  assert.equal(result.totalCount, 2);
  assert.equal(result.nextHref, null);
});

test("preserve mode retains playlist order and repeated occurrences", async () => {
  const source = pagination.createPaginatedTrackSource({
    initialTracks: [track(1), track(1, "Repeated first page")],
    nextHref: "page-2",
    totalCount: 4,
    pageSize: 2,
    mergeMode: "preserve",
    loadPage: async () => ({
      collection: [track(2), track(1, "Repeated second page")],
      next_href: null,
    }),
  });

  const result = await source.loadNext();
  assert.deepEqual(
    result.tracks.map((item) => item.urn),
    [
      "soundcloud:tracks:1",
      "soundcloud:tracks:1",
      "soundcloud:tracks:2",
      "soundcloud:tracks:1",
    ],
  );
  assert.equal(result.totalCount, 4);
});

test("concurrent requests share one page load and publish immutable snapshots", async () => {
  let resolvePage;
  let calls = 0;
  const source = pagination.createPaginatedTrackSource({
    initialTracks: [track(1)],
    nextHref: "page-2",
    totalCount: 2,
    pageSize: 50,
    loadPage: () => {
      calls += 1;
      return new Promise((resolve) => {
        resolvePage = resolve;
      });
    },
  });
  const revisions = [];
  source.subscribe((snapshot) => revisions.push(snapshot.revision));

  const first = source.loadNext();
  const second = source.loadNext();
  assert.strictEqual(first, second);
  assert.equal(calls, 0, "the transport begins in a microtask");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(source.getSnapshot().loading, true);

  resolvePage({ collection: [track(2)], next_href: null });
  const result = await first;
  assert.equal(result.loading, false);
  assert.deepEqual(revisions, [1, 2]);

  result.tracks.length = 0;
  assert.equal(source.getSnapshot().tracks.length, 2);
});

test("a failed request retains its cursor and can be retried", async () => {
  let calls = 0;
  const source = pagination.createPaginatedTrackSource({
    initialTracks: [track(1)],
    nextHref: "retry-page",
    totalCount: 2,
    pageSize: 50,
    loadPage: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return { collection: [track(2)], next_href: null };
    },
  });

  await assert.rejects(source.loadNext(), /temporary failure/);
  const failed = source.getSnapshot();
  assert.equal(failed.nextHref, "retry-page");
  assert.equal(failed.loading, false);
  assert.equal(failed.error, "temporary failure");

  const recovered = await source.loadNext();
  assert.equal(calls, 2);
  assert.equal(recovered.error, null);
  assert.equal(recovered.tracks.length, 2);
});

test("a repeated or cyclic cursor terminates without another request", async () => {
  let calls = 0;
  const source = pagination.createPaginatedTrackSource({
    initialTracks: [],
    nextHref: "page-a",
    totalCount: 3,
    pageSize: 1,
    loadPage: async (cursor) => {
      calls += 1;
      if (cursor === "page-a") {
        return { collection: [track(1)], next_href: "page-b" };
      }
      return { collection: [track(2)], next_href: "page-a" };
    },
  });

  assert.equal((await source.loadNext()).nextHref, "page-b");
  const completed = await source.loadNext();
  assert.equal(completed.nextHref, null);
  assert.equal(calls, 2);
  await source.loadNext();
  assert.equal(calls, 2);
});

