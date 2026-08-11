import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const [availabilitySource, playerSource] = await Promise.all([
  readFile(
    new URL("../src/services/trackAvailability.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
]);
const compiledAvailability = ts.transpileModule(availabilitySource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const availability = await import(
  `data:text/javascript;base64,${Buffer.from(compiledAvailability).toString("base64")}`
);

function track(id, signals = {}) {
  const urn = `soundcloud:tracks:${id}`;
  return {
    id: urn,
    urn,
    kind: "track",
    title: `Track ${id}`,
    duration: 180_000,
    artwork_url: null,
    permalink_url: `https://soundcloud.com/artist/track-${id}`,
    likes_count: 0,
    playback_count: 0,
    description: null,
    user: {
      id: "soundcloud:users:1",
      urn: "soundcloud:users:1",
      username: "Artist",
      avatar_url: "",
      permalink_url: "https://soundcloud.com/artist",
    },
    ...signals,
  };
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("only explicit or resolver-confirmed unavailable tracks are disabled", () => {
  availability.resetConsumerProductAvailability();
  assert.equal(availability.isTrackUnavailable(track(1)), false);
  assert.equal(
    availability.isTrackUnavailable(track(2, { access: "blocked" })),
    true,
  );
  assert.equal(
    availability.isTrackUnavailable(track(3, { policy: "BLOCK" })),
    true,
  );
  assert.equal(
    availability.isTrackUnavailable(track(4, { streamable: false })),
    false,
  );
  assert.equal(
    availability.isTrackUnavailable(track(5, { has_transcodings: false })),
    true,
  );
  assert.equal(
    availability.isTrackUnavailable(
      track(6, {
        access: "playable",
        policy: "MONETIZE",
        streamable: true,
        has_transcodings: true,
      }),
    ),
    false,
  );

  availability.markTrackUnavailable(track(7));
  assert.equal(
    availability.isTrackUnavailable(track(7)),
    true,
    "the session cache must also cover normalized clones of a failed track",
  );
});

test("automatic skipping is restricted to permanent media capability errors", () => {
  for (const code of [
    "track_region_blocked",
    "track_blocked",
    "stream_unavailable",
  ]) {
    assert.equal(
      availability.isAutomaticallySkippableMediaError({ code }),
      true,
      code,
    );
  }

  for (const code of [
    "soundcloud_login_required",
    "soundcloud_not_connected",
    "soundcloud_forbidden",
    "soundcloud_rate_limited",
    "soundcloud_unavailable",
    "soundcloud_unreachable",
    "invalid_soundcloud_response",
    "expired_media_url",
  ]) {
    assert.equal(
      availability.isAutomaticallySkippableMediaError({ code }),
      false,
      code,
    );
  }
  assert.equal(
    availability.isAutomaticallySkippableMediaError(
      new Error("No supported SoundCloud stream is available."),
    ),
    false,
    "classification must use a structured code, not message matching",
  );
});

test("available-index helpers skip known failures and examine at most one queue", () => {
  const queue = [
    track(11),
    track(12, { access: "blocked" }),
    track(13, { has_transcodings: false }),
    track(14),
  ];
  assert.equal(availability.nextAvailableTrackIndex(queue, 0, "off"), 3);
  assert.equal(availability.nextAvailableTrackIndex(queue, 3, "off"), null);
  assert.equal(availability.nextAvailableTrackIndex(queue, 3, "all"), 0);
  assert.equal(
    availability.nextAvailableTrackIndex(queue, 1, "one"),
    3,
    "repeat-one changes automatic end handling, not the explicit next preview",
  );
  assert.equal(availability.previousAvailableTrackIndex(queue, 3), 0);

  const attempted = new Set([queue[0].urn, queue[3].urn]);
  assert.equal(
    availability.nextAvailableTrackIndex(queue, 3, "all", attempted),
    null,
  );

  const nextHelper = sourceSlice(
    availabilitySource,
    "export function nextAvailableTrackIndex",
    "/** Select the nearest earlier playable entry",
  );
  assert.match(nextHelper, /offset\s*<=\s*length/);
  assert.doesNotMatch(nextHelper, /\bwhile\s*\(\s*true\s*\)/);
});

test("player queue advancement has a structured, bounded auto-skip contract", () => {
  const resultType = sourceSlice(
    playerSource,
    "type TrackLoadResult",
    "const STORAGE_KEYS",
  );
  for (const result of ["loaded", "stale", "unavailable", "failed"]) {
    assert.match(resultType, new RegExp(`["']${result}["']`));
  }

  const advance = sourceSlice(
    playerSource,
    "private async advanceQueue",
    "private requestAdvance",
  );
  assert.match(advance, /new Set<number>\(\)/);
  assert.match(advance, /attemptedTokens\.size\s*>=\s*this\.queue\.length/);
  assert.match(advance, /attemptedTokens\.has\(nextEntry\.token\)/);
  assert.match(advance, /attemptedTokens\.add\(nextEntry\.token\)/);
  assert.match(advance, /isTrackUnavailable\(nextEntry\.track\)/);
  assert.match(advance, /loadTrackInternal\([\s\S]*?true[\s\S]*?true/);
  assert.match(advance, /result\s*===\s*["']unavailable["'][\s\S]*?continue/);
  assert.match(advance, /relatedRequested/);
  assert.doesNotMatch(advance, /this\.advanceQueue\(/);

  const knownGuard = advance.indexOf("isTrackUnavailable(nextEntry.track)");
  const resolverLoad = advance.indexOf("this.loadTrackInternal(");
  assert.ok(
    knownGuard >= 0 && knownGuard < resolverLoad,
    "known unavailable entries must be skipped before stream resolution",
  );
});

test("auto-skippable resolution failures bypass failPlayback but all other failures do not", () => {
  const load = sourceSlice(
    playerSource,
    "private async loadTrackInternal",
    "async loadTrack(track",
  );
  assert.match(load, /Promise<TrackLoadResult>/);

  const classifier = load.indexOf(
    "skipUnavailable && isAutomaticallySkippableMediaError(err)",
  );
  const reason = load.indexOf("unavailableReasonForError(err)", classifier);
  const mark = load.indexOf("markTrackUnavailable(", classifier);
  const label = load.indexOf("trackUnavailableLabel(track)", classifier);
  const unavailableReturn = load.indexOf('return "unavailable"', classifier);
  const failPlayback = load.indexOf("this.failPlayback(", classifier);
  assert.ok(classifier >= 0, "missing structured auto-skip classifier");
  assert.ok(
    reason > classifier && reason < mark,
    "the structured error must select a truthful cache reason",
  );
  assert.ok(
    mark < label && label < unavailableReturn && unavailableReturn < failPlayback,
    "the auto-skip branch must return before the normal failure path",
  );
  assert.match(load.slice(failPlayback), /return\s+["']failed["']/);
});

test("manual queue selection refuses a known unavailable entry before changing playback", () => {
  const playQueueIndex = sourceSlice(
    playerSource,
    "async playQueueIndex",
    "private normalizeQueueInput",
  );
  assert.match(
    playQueueIndex,
    /if\s*\(\s*isTrackUnavailable\(track\)\s*\)/,
  );

  const guard = playQueueIndex.indexOf("isTrackUnavailable(track)");
  const queueMutation = playQueueIndex.indexOf("this.queueIndex = index");
  const playback = playQueueIndex.indexOf("this.loadTrack(");
  assert.ok(
    guard >= 0 && guard < queueMutation && queueMutation < playback,
    "the unavailable guard must run before queue mutation or playback",
  );
});
