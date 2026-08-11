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
  new URL("../src/services/playHistoryStatus.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const historyStatus = await import(`${moduleUrl}#main`);

test("play-history track IDs are canonical and resource-kind safe", () => {
  assert.equal(
    historyStatus.canonicalPlayHistoryTrackUrn("73"),
    "soundcloud:tracks:73",
  );
  assert.equal(
    historyStatus.canonicalPlayHistoryTrackUrn("soundcloud:tracks:73"),
    "soundcloud:tracks:73",
  );
  for (const value of [
    null,
    "",
    "soundcloud:users:73",
    "soundcloud:tracks:nope",
    "https://soundcloud.com/artist/track",
  ]) {
    assert.equal(historyStatus.canonicalPlayHistoryTrackUrn(value), null);
  }
});

test("one history attempt is claimed per current playback load", () => {
  assert.deepEqual(
    historyStatus.claimPlayHistoryAttempt(
      -1,
      9,
      9,
      "soundcloud:tracks:73",
    ),
    {
      attemptedLoadId: 9,
      trackUrn: "soundcloud:tracks:73",
    },
  );
  assert.deepEqual(
    historyStatus.claimPlayHistoryAttempt(
      9,
      9,
      9,
      "soundcloud:tracks:73",
    ),
    {
      attemptedLoadId: 9,
      trackUrn: null,
    },
    "pause/resume must not create a duplicate",
  );
  assert.deepEqual(
    historyStatus.claimPlayHistoryAttempt(
      -1,
      9,
      10,
      "soundcloud:tracks:73",
    ),
    {
      attemptedLoadId: -1,
      trackUrn: null,
    },
    "a stale play promise must not record the newer load",
  );
  assert.deepEqual(
    historyStatus.claimPlayHistoryAttempt(-1, 10, 10, "not-a-track"),
    {
      attemptedLoadId: -1,
      trackUrn: null,
    },
  );
});

test("separate WaveLink bundles communicate history success through window events", async () => {
  const publisher = await import(`${moduleUrl}#publisher`);
  const subscriber = await import(`${moduleUrl}#subscriber`);
  const target = new EventTarget();
  const received = [];
  const unsubscribe = subscriber.subscribePlayHistoryRecorded(
    (detail) => received.push(detail),
    target,
  );

  assert.equal(
    publisher.publishPlayHistoryRecorded("soundcloud:tracks:73", target),
    true,
  );
  assert.deepEqual(received, [
    { trackUrn: "soundcloud:tracks:73" },
  ]);

  target.dispatchEvent(
    new CustomEvent(subscriber.PLAY_HISTORY_RECORDED_EVENT, {
      detail: { trackUrn: "soundcloud:users:73" },
    }),
  );
  assert.equal(received.length, 1, "malformed events are ignored");

  unsubscribe();
  publisher.publishPlayHistoryRecorded("soundcloud:tracks:74", target);
  assert.equal(received.length, 1);
});

test("API, player and HomeView wire the captured history contract safely", async () => {
  const [apiSource, playerSource, homeSource] = await Promise.all([
    readFile(new URL("../src/services/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/HomeView.tsx", import.meta.url), "utf8"),
  ]);

  const apiStart = apiSource.indexOf(
    "export async function recordTrackPlayHistory",
  );
  const apiEnd = apiSource.indexOf(
    "export async function getFollowings",
    apiStart,
  );
  const mutation = apiSource.slice(apiStart, apiEnd);
  assert.ok(apiStart >= 0 && apiEnd > apiStart);
  assert.match(mutation, /request<unknown>\("\/me\/play-history"/);
  assert.match(mutation, /method:\s*"POST"/);
  assert.match(mutation, /app_version:\s*SOUNDCLOUD_WEB_APP_VERSION/);
  assert.match(mutation, /app_locale:\s*"en"/);
  assert.match(mutation, /body:\s*\{\s*track_urn:\s*canonicalUrn\s*\}/);
  assert.match(mutation, /onUnauthorized:\s*\(\)\s*=>\s*undefined/);
  assert.match(mutation, /publishPlayHistoryRecorded\(canonicalUrn\)/);

  const recentStart = apiSource.indexOf(
    "export async function getRecentlyPlayed",
  );
  const recentEnd = apiSource.indexOf(
    "export async function recordTrackPlayHistory",
    recentStart,
  );
  const recentQuery = apiSource.slice(recentStart, recentEnd);
  assert.ok(recentStart >= 0 && recentEnd > recentStart);
  assert.match(recentQuery, /query:\s*\{\s*linked_partitioning:\s*true\s*\}/);
  assert.doesNotMatch(recentQuery, /query:\s*\{[^}]*\blimit\s*:/s);

  const startAudioStart = playerSource.indexOf(
    "private async startAudio",
  );
  const startAudioEnd = playerSource.indexOf(
    "async loadTrack",
    startAudioStart,
  );
  const startAudio = playerSource.slice(startAudioStart, startAudioEnd);
  assert.ok(startAudioStart >= 0 && startAudioEnd > startAudioStart);
  assert.ok(
    startAudio.indexOf("await this.audio.play()") <
      startAudio.indexOf("claimPlayHistoryAttempt"),
  );
  assert.ok(
    startAudio.indexOf("expectedLoadId !== this._loadId") <
      startAudio.indexOf("claimPlayHistoryAttempt"),
  );
  assert.match(startAudio, /recordLocalPlayHistory\(historyTrack\)/);
  assert.match(startAudio, /void recordTrackPlayHistory\(claim\.trackUrn\)\.catch/);
  assert.ok(
    startAudio.indexOf("recordLocalPlayHistory(historyTrack)") <
      startAudio.indexOf("recordTrackPlayHistory(claim.trackUrn)"),
    "local history must be persisted before and independently of the remote mutation",
  );

  assert.match(homeSource, /subscribeLocalPlayHistoryChanged\(refreshLocalRecent\)/);
  assert.match(homeSource, /loadLocalPlayHistory\(\)/);
  assert.match(homeSource, /removeLocalPlayHistoryTrack\(/);
  assert.match(homeSource, /setHistorySource\(source\)/);
  assert.match(homeSource, /source === "wavelink" \? "WaveLink" : "SoundCloud"/);
  assert.match(homeSource, /subscribePlayHistoryRecorded\(refreshRecent\)/);
  assert.match(homeSource, /const generation = \+\+recentRequestGeneration\.current/);
  assert.match(homeSource, /getRecentlyPlayed\(100\)/);
  assert.doesNotMatch(homeSource, /\.slice\(0,\s*8\)/);
  assert.match(homeSource, /visibleRecentHistory\(activeHistory, isHistoryExpanded\)/);
  assert.match(homeSource, /canExpandRecentHistory\(activeHistory\)/);
  assert.match(homeSource, /Record<HistorySource, boolean>/);
  assert.match(homeSource, /aria-expanded=\{isHistoryExpanded\}/);
  assert.match(homeSource, /aria-controls=\{historyListId\}/);
  assert.match(homeSource, /"Show less"/);
  assert.match(homeSource, /`Show all \$\{activeHistory\.length\}`/);
  assert.match(homeSource, /ref=\{historyDisclosureButtonRef\}/);
  assert.match(
    homeSource,
    /pendingCollapseScrollSource\.current = isHistoryExpanded\s*\? historySource\s*:\s*null/,
  );
  assert.match(homeSource, /useLayoutEffect\(\(\) => \{/);
  assert.match(homeSource, /window\.requestAnimationFrame\(\(\) => \{/);
  assert.match(homeSource, /button\?\.isConnected/);
  assert.match(homeSource, /button\.scrollIntoView\(\{/);
  assert.match(homeSource, /behavior:\s*"auto"/);
  assert.doesNotMatch(homeSource, /behavior:\s*"smooth"/);
  assert.match(homeSource, /block:\s*"center"/);
  assert.match(homeSource, /inline:\s*"nearest"/);
  assert.match(homeSource, /window\.cancelAnimationFrame\(frame\)/);
  assert.match(homeSource, /unsubscribe\(\)/);
});
