import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [playerSource, hookSource, collectionSource] = await Promise.all([
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/hooks/usePlayer.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../src/components/TrackCollection.tsx", import.meta.url),
    "utf8",
  ),
]);

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(
    end > start,
    `Missing source marker after ${startMarker}: ${endMarker}`,
  );
  return source.slice(start, end);
}

test("the player projects a paginated source without pretending unloaded rows are loaded", () => {
  const state = sourceSlice(
    playerSource,
    "export interface PlayerState",
    "type Listener",
  );
  for (const field of [
    "queueTotal: number",
    "queueHasMore: boolean",
    "queueLoadingMore: boolean",
    "queueLoadError: string | null",
  ]) {
    assert.match(state, new RegExp(field.replace(/[|]/g, "\\$&")));
  }

  const setFromSource = sourceSlice(
    playerSource,
    "setQueueFromSource(",
    "replaceQueueIfRevision(",
  );
  assert.match(setFromSource, /source\.getSnapshot\(\)/);
  assert.match(setFromSource, /this\.setQueue\(snapshot\.tracks/);
  assert.match(setFromSource, /this\.attachQueueSource\(source\)/);
  assert.match(setFromSource, /this\.maybePrefetchQueueForIndex/);

  const accept = sourceSlice(
    playerSource,
    "private acceptQueueSourceSnapshot",
    "private attachQueueSource",
  );
  assert.match(accept, /generation !== this\._queueSourceGeneration/);
  assert.match(accept, /queueSourcePrefixMatches\(snapshot\)/);
  assert.match(accept, /snapshot\.tracks\.slice\(previousLoadedCount\)/);
  assert.match(accept, /this\.originalQueue\.push\(\.\.\.entries\)/);
  assert.match(accept, /this\.rebuildShuffledQueue\(true\)/);
  assert.match(accept, /this\.queue\.push\(\.\.\.entries\)/);

  const total = sourceSlice(
    playerSource,
    "private queueDisplayTotal",
    "/**\n   * Stop listening",
  );
  assert.match(total, /this\._queueSourceSnapshot\?\.totalCount/);
  assert.match(total, /Math\.max\(this\.queue\.length/);

  const getState = sourceSlice(playerSource, "getState():", "subscribe(cb:");
  assert.match(getState, /queueTotal:\s*this\.queueDisplayTotal\(\)/);
  assert.match(getState, /queueHasMore:\s*this\.queueSourceHasMore\(\)/);
  assert.match(
    getState,
    /queueLoadingMore:\s*Boolean\(this\._queueSourceSnapshot\?\.loading\)/,
  );
  assert.match(
    getState,
    /queueLoadError:\s*this\._queueSourceSnapshot\?\.error\s*\?\?\s*null/,
  );
});

test("playback and queue scrolling request the next page at the shared 25 percent threshold", () => {
  const prefetch = sourceSlice(
    playerSource,
    "private maybePrefetchQueueForIndex",
    "private reportQueueSourceBoundaryError",
  );
  assert.match(prefetch, /paginationPrefetchIndex\(/);
  assert.match(prefetch, /this\._queueSourceLoadedCount/);
  assert.match(prefetch, /snapshot\.pageSize/);
  assert.match(
    prefetch,
    /index\s*>=\s*threshold[\s\S]*?this\.requestQueueSourcePage\(\)/,
  );

  const scroll = sourceSlice(
    playerSource,
    "private readonly _onNativeQueueScroll",
    "/**\n   * Spotify does not emit songchange",
  );
  assert.match(scroll, /requestAnimationFrame/);
  assert.match(scroll, /data-wl-queue-index/);
  assert.match(scroll, /item\.offsetTop/);
  assert.match(scroll, /item\.offsetHeight/);
  assert.match(scroll, /this\.maybePrefetchQueueForIndex\(lastVisibleIndex\)/);

  const playQueueIndex = sourceSlice(
    playerSource,
    "async playQueueIndex",
    "private normalizeQueueInput",
  );
  assert.match(
    playQueueIndex,
    /this\.queueIndex = index;[\s\S]*?this\.maybePrefetchQueueForIndex\(index\)/,
  );

  assert.match(collectionSource, /paginationPrefetchIndex\(/);
  assert.match(collectionSource, /IntersectionObserver/);
  assert.match(collectionSource, /source\.loadNext\(\)/);
});

test("the hard queue boundary hydrates before repeat, related radio, or stop", () => {
  const advance = sourceSlice(
    playerSource,
    "private async advanceQueue",
    "private requestAdvance",
  );
  assert.match(advance, /this\.queueSourceHasMore\(\)/);
  assert.match(
    advance,
    /const appended = await this\.requestQueueSourcePage\(\)/,
  );
  assert.match(advance, /this\.reportQueueSourceBoundaryError\(\)/);

  const boundary = advance.indexOf("if (nextIndex >= this.queue.length)");
  const pageRequest = advance.indexOf(
    "await this.requestQueueSourcePage()",
    boundary,
  );
  const repeatWrap = advance.indexOf('this._repeat === "all"', boundary);
  const related = advance.indexOf("this.requestRelatedTracks()", boundary);
  assert.ok(boundary >= 0 && pageRequest > boundary);
  assert.ok(
    pageRequest < repeatWrap && pageRequest < related,
    "an unfinished collection must be hydrated before end-of-queue policy",
  );
  assert.match(
    advance,
    /this\.queueIndex = nextIndex;[\s\S]*?this\.maybePrefetchQueueForIndex\(nextIndex\)/,
  );
});

test("the native queue shows the exact total while rendering only loaded tracks", () => {
  const controls = sourceSlice(
    playerSource,
    "private updateNativeControls",
    "private renderNativeQueue",
  );
  assert.match(controls, /const queueTotal = this\.queueDisplayTotal\(\)/);
  assert.match(controls, /count\.textContent = queueTotal/);

  const render = sourceSlice(
    playerSource,
    "private renderNativeQueue",
    "private hookProgressBar",
  );
  assert.match(render, /const queueTotal = this\.queueDisplayTotal\(\)/);
  assert.match(render, /const previousScrollTop = list\.scrollTop/);
  assert.match(render, /this\.queue\.forEach\(\(entry, index\)/);
  assert.match(render, /item\.dataset\.wlQueueIndex = String\(index\)/);
  assert.match(render, /sourceSnapshot\?\.loading/);
  assert.match(render, /sourceSnapshot\?\.error && sourceSnapshot\.nextHref/);
  assert.match(render, /this\.requestQueueSourcePage\(\)/);
  assert.match(render, /list\.scrollTop = previousScrollTop/);
});

test("manual structural mutations detach the source so stale pages cannot refill a new queue", () => {
  const methods = [
    ["setQueue(", "/** Start playback"],
    ["addToQueue(", "playNext("],
    ["playNext(", "async removeFromQueue"],
    ["async removeFromQueue", "remove(index:"],
    ["reorderQueue(", "reorder(fromIndex:"],
    ["clearQueue(", "setShuffle("],
    ["stop():", "seek(ratio:"],
    ["destroy():", "// Cross-bundle singleton"],
  ];
  for (const [start, end] of methods) {
    const method = sourceSlice(playerSource, start, end);
    assert.match(method, /this\.detachQueueSource\(\)/, start);
  }

  const detach = sourceSlice(
    playerSource,
    "private detachQueueSource",
    "private queueSourcePrefixMatches",
  );
  assert.match(detach, /this\._queueSourceGeneration \+= 1/);
  assert.match(detach, /this\._queueSource = null/);
  assert.match(detach, /unsubscribe\?\.\(\)/);
});

test("the player hook exposes lazy queues and the persisted batch-size setting", () => {
  assert.match(hookSource, /setQueueFromSource:/);
  assert.match(hookSource, /player\.setQueueFromSource\(source, idx, context\)/);
  assert.match(hookSource, /setTracksPerLoad:/);
  assert.match(hookSource, /player\.setTracksPerLoad\(value\)/);

  const initialize = sourceSlice(
    playerSource,
    "private waitForSpicetify",
    "private bindAudioEvents",
  );
  assert.match(initialize, /this\._tracksPerLoad = readTracksPerLoad\(\)/);

  const setter = sourceSlice(
    playerSource,
    "setTracksPerLoad(",
    "setSpotifySearchIntegrationEnabled(",
  );
  assert.match(setter, /normalizeTracksPerLoad\(value\)/);
  assert.match(setter, /TRACKS_PER_LOAD_STORAGE_KEY/);
  assert.match(setter, /dispatchTracksPerLoadChanged\(normalized\)/);
  assert.match(setter, /this\.emit\(\)/);
});
