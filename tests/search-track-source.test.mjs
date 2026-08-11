import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import ts from "typescript";

const require = createRequire(import.meta.url);

function track(id) {
  return {
    id: `soundcloud:tracks:${id}`,
    urn: `soundcloud:tracks:${id}`,
    title: `Track ${id}`,
    permalink_url: `https://soundcloud.com/artist/track-${id}`,
  };
}

function clearSourceModuleCache() {
  for (const filename of Object.keys(require.cache)) {
    if (/[\\/]src[\\/]/.test(filename)) delete require.cache[filename];
  }
}

async function withSearchSource(run) {
  const previousTsLoader = require.extensions[".ts"];
  try {
    require.extensions[".ts"] = (module, filename) => {
      const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
        fileName: filename,
      }).outputText;
      module._compile(compiled, filename);
    };
    clearSourceModuleCache();
    await run(require("../src/services/searchTrackSource.ts"));
  } finally {
    clearSourceModuleCache();
    if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
    else delete require.extensions[".ts"];
  }
}

test("search pagination hard-trims results to 300 with a configurable page size", async () => {
  await withSearchSource(async ({
    createSearchTrackSource,
    SEARCH_TRACK_RESULT_LIMIT,
  }) => {
    let calls = 0;
    const source = createSearchTrackSource({
      initialPage: {
        collection: Array.from({ length: 125 }, (_, index) => track(index + 1)),
        next_href: "page-2",
        total_results: 12_000,
      },
      pageSize: 125,
      loadPage: async () => {
        calls += 1;
        return {
          collection: Array.from(
            { length: 200 },
            (_, index) => track(index + 126),
          ),
          next_href: "page-3",
          total_results: 12_000,
        };
      },
    });

    assert.equal(SEARCH_TRACK_RESULT_LIMIT, 300);
    assert.equal(source.getSnapshot().pageSize, 125);
    assert.equal(source.getSnapshot().totalCount, 300);

    const completed = await source.loadNext();
    assert.equal(calls, 1);
    assert.equal(completed.tracks.length, 300);
    assert.equal(completed.totalCount, 300);
    assert.equal(completed.tracks.at(-1).urn, "soundcloud:tracks:300");
    assert.equal(completed.nextHref, null);
    await source.loadNext();
    assert.equal(calls, 1, "the upstream cursor is never requested past 300");
  });
});

test("the 300-result budget counts raw rows and terminal totals stay exact after dedupe", async () => {
  await withSearchSource(async ({ createSearchTrackSource }) => {
    let calls = 0;
    const source = createSearchTrackSource({
      initialPage: {
        collection: [
          ...Array.from({ length: 75 }, (_, index) => track(index + 1)),
          track(1),
          track(2),
        ],
        next_href: "page-2",
        total_results: 12_000,
      },
      pageSize: 77,
      loadPage: async () => {
        calls += 1;
        const firstId = calls === 1 ? 76 : calls === 2 ? 153 : 230;
        return {
          collection: Array.from(
            { length: 77 },
            (_, index) => track(firstId + index),
          ),
          next_href: `page-${calls + 2}`,
          total_results: 12_000,
        };
      },
    });

    await source.loadNext();
    await source.loadNext();
    const completed = await source.loadNext();

    assert.equal(calls, 3);
    assert.equal(completed.nextHref, null);
    assert.equal(completed.error, null);
    assert.equal(completed.tracks.length, 298);
    assert.equal(completed.totalCount, 298);
    assert.equal(completed.tracks.at(-1).urn, "soundcloud:tracks:298");
    await source.loadNext();
    assert.equal(calls, 3, "the raw 300-row budget must stop another request");
  });
});

test("a later search-page failure becomes a clean terminal snapshot", async () => {
  await withSearchSource(async ({ createSearchTrackSource }) => {
    let calls = 0;
    const source = createSearchTrackSource({
      initialPage: {
        collection: Array.from({ length: 50 }, (_, index) => track(index + 1)),
        next_href: "deep-page",
        total_results: 900,
      },
      pageSize: 50,
      loadPage: async () => {
        calls += 1;
        throw new Error("SoundCloud rejected the deep search cursor");
      },
    });

    const completed = await source.loadNext();
    assert.equal(calls, 1);
    assert.equal(completed.tracks.length, 50);
    assert.equal(completed.nextHref, null);
    assert.equal(completed.loading, false);
    assert.equal(completed.error, null);
    assert.equal(completed.totalCount, 50);
  });
});

test("a page failure before any search result remains visible and retryable", async () => {
  await withSearchSource(async ({ createSearchTrackSource }) => {
    const source = createSearchTrackSource({
      initialPage: {
        collection: [],
        next_href: "first-result-page",
        total_results: 20,
      },
      pageSize: 10,
      loadPage: async () => {
        throw new Error("initial result page failed");
      },
    });

    await assert.rejects(source.loadNext(), /initial result page failed/);
    assert.equal(source.getSnapshot().nextHref, "first-result-page");
    assert.equal(source.getSnapshot().error, "initial result page failed");
  });
});

test("a new track query drops the old view source before its initial request", () => {
  const searchView = readFileSync(
    new URL("../src/components/SearchView.tsx", import.meta.url),
    "utf8",
  );
  const start = searchView.indexOf("const runSearch");
  const request = searchView.indexOf("await searchTracks", start);
  const clear = searchView.indexOf("setTrackSource(null)", start);

  assert.ok(start >= 0 && clear > start && request > clear);
  assert.match(
    searchView,
    /tracks:\s*\{\s*items:\s*\[\],\s*nextHref:\s*null,\s*query:\s*clean,\s*error:\s*null/s,
  );
  assert.match(
    searchView,
    /activeTab === "tracks" && trackSource && trackSnapshot/,
  );
});
