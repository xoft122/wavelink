import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

if (typeof globalThis.CustomEvent !== "function") {
  globalThis.CustomEvent = class CustomEventPolyfill extends Event {
    constructor(type, init = {}) {
      super(type);
      this.detail = init.detail;
    }
  };
}

const source = await readFile(
  new URL("../src/services/likedTrackStatus.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const likeStatus = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("like-status details canonicalize SoundCloud track IDs", () => {
  assert.equal(
    likeStatus.canonicalLikedTrackId("55"),
    "soundcloud:tracks:55",
  );
  assert.equal(
    likeStatus.canonicalLikedTrackId("soundcloud:tracks:55"),
    "soundcloud:tracks:55",
  );
  assert.deepEqual(
    likeStatus.parseLikedTrackStatusDetail({
      trackId: "55",
      liked: true,
    }),
    { trackId: "soundcloud:tracks:55", liked: true },
  );

  for (const detail of [
    null,
    [],
    { trackId: "soundcloud:users:55", liked: true },
    { trackId: "soundcloud:tracks:nope", liked: true },
    { trackId: "soundcloud:tracks:55", liked: "true" },
  ]) {
    assert.equal(likeStatus.parseLikedTrackStatusDetail(detail), null);
  }
});

test("like status is delivered across the shared window event and unsubscribe works", () => {
  class FakeEventTarget {
    listeners = new Map();

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) ?? new Set();
      listeners.add(listener);
      this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
      this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event) {
      for (const listener of this.listeners.get(event.type) ?? []) {
        listener(event);
      }
      return true;
    }
  }
  const target = new FakeEventTarget();
  const received = [];
  const unsubscribe = likeStatus.subscribeLikedTrackStatus(
    (detail) => received.push(detail),
    target,
  );

  assert.equal(
    likeStatus.publishLikedTrackStatus("55", true, target),
    true,
  );
  assert.deepEqual(received, [
    { trackId: "soundcloud:tracks:55", liked: true },
  ]);

  target.dispatchEvent({
    type: likeStatus.LIKED_TRACK_STATUS_EVENT,
    detail: { trackId: "soundcloud:users:55", liked: false },
  });
  assert.equal(received.length, 1, "malformed status is ignored");

  unsubscribe();
  likeStatus.publishLikedTrackStatus("55", false, target);
  assert.equal(received.length, 1);
});

test("both bundles publish, subscribe and invalidate their local Like cache", async () => {
  const [hookSource, playerSource] = await Promise.all([
    readFile(new URL("../src/hooks/useLikedTracks.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  ]);

  for (const bundleSource of [hookSource, playerSource]) {
    assert.match(bundleSource, /\bpublishLikedTrackStatus\b/);
    assert.match(bundleSource, /\bsubscribeLikedTrackStatus\b/);
    assert.match(bundleSource, /\binvalidateLikedTrackIds\b/);
  }
  assert.match(
    hookSource,
    /\bgetLikedTrackIds\s*\(\s*\{\s*force\s*\}\s*\)/,
  );
  assert.match(hookSource, /\brefreshLikedIds\s*\(\s*true\s*,\s*true\s*\)/);
  assert.match(
    playerSource,
    /\bgetLikedTrackIds\s*\(\s*\{\s*force:\s*true\s*\}\s*\)/,
  );
  assert.match(hookSource, /\brefreshGenerationRef\b/);
  assert.match(playerSource, /\bgeneration\b/);
  assert.match(playerSource, /_unsubscribeLikedTrackStatus\?\.\(\)/);
});
