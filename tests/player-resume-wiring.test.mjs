import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [playerSource, extensionSource] = await Promise.all([
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../src/extensions/extension.tsx", import.meta.url),
    "utf8",
  ),
]);

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker after ${startMarker}`);
  return source.slice(start, end);
}

test("startup resume is initialized from a verified account independently of Spotify Search", () => {
  const resumeBootstrap = extensionSource.indexOf(
    "const syncPlaybackResume = () =>",
  );
  const searchBootstrap = extensionSource.indexOf("const sync = async () =>");
  assert.ok(resumeBootstrap >= 0 && resumeBootstrap < searchBootstrap);
  const block = extensionSource.slice(resumeBootstrap, searchBootstrap);
  assert.match(block, /session\?\.authenticated/);
  assert.match(block, /player\.initializePlaybackResume\(session\.user\)/);
  assert.match(block, /authSessionStore\.ensureSession\(\)\.then\(syncPlaybackResume\)/);
  assert.doesNotMatch(block, /readSpotifySearchIntegrationEnabled/);
});

test("restoration refreshes metadata, adopts the effective queue directly, and never autoplays", () => {
  const restore = sourceSlice(
    playerSource,
    "private async restorePlaybackResume(",
    "private persistSetting(",
  );
  assert.match(restore, /loadPlaybackResumeState\(ownerUrn\)/);
  assert.match(restore, /freshTrack = await getTrack\(savedCurrent\.track\.urn\)/);
  assert.match(restore, /this\.originalQueue = entries;/);
  assert.match(restore, /this\.queue = \[\.\.\.entries\];/);
  assert.doesNotMatch(restore, /this\.setQueue\(/);
  assert.match(
    restore,
    /this\.loadTrackInternal\(freshTrack, false, false\)/,
    "restored playback must be loaded paused",
  );
});

test("the saved position survives pre-metadata emits and is seeked with load guards", () => {
  const persist = sourceSlice(
    playerSource,
    "private playbackResumePositionMs(): number",
    "private async waitForStablePausedSpotifyBaseline(",
  );
  assert.match(persist, /this\._resumeRestoring && !force/);
  assert.match(persist, /pending\.positionMs/);
  assert.match(persist, /pending\.loadId !== this\._loadId/);
  assert.match(persist, /pending\.trackKey !== trackKey\(track\)/);
  assert.match(persist, /this\.audio\.readyState < 1/);
  assert.match(persist, /this\.audio\.currentTime = seconds/);

  const audioEvents = sourceSlice(
    playerSource,
    "private bindAudioEvents(): void",
    "private muteSpotifyAudio(",
  );
  assert.match(
    audioEvents,
    /addEventListener\("loadedmetadata"[\s\S]*?applyPendingPlaybackResumeSeek\(\)/,
  );
});

test("resume checkpoints are periodic and flushed on pause, hide, and teardown", () => {
  assert.match(playerSource, /positionMs \/ 5_000/);
  assert.match(playerSource, /now - this\._resumeLastSavedAt < 5_000/);
  assert.match(playerSource, /addEventListener\("pagehide", this\._onResumePageHide\)/);
  assert.match(
    playerSource,
    /visibilityState === "hidden"[\s\S]*?persistPlaybackResume\(true\)/,
  );
  const destroy = sourceSlice(
    playerSource,
    "destroy(): void",
    "// Cross-bundle singleton",
  );
  assert.match(destroy, /this\.persistPlaybackResume\(true\)/);
});

test("explicit WaveLink release clears resume state while a window close only saves", () => {
  const stop = sourceSlice(playerSource, "stop(): void", "seek(ratio: number)");
  assert.match(
    stop,
    /this\.clearPlaybackResumeCheckpoint\(this\._resumeUnloading\)/,
  );
  assert.match(
    playerSource,
    /private clearPlaybackResumeCheckpoint\(preserveStored = false\)[\s\S]*?if \(!preserveStored\) clearPlaybackResumeState\(\)/,
  );
  const pageHide = sourceSlice(
    playerSource,
    "private readonly _onResumePageHide",
    "private readonly _onResumeBeforeUnload",
  );
  assert.match(pageHide, /this\._resumeUnloading = true/);
  assert.match(pageHide, /persistPlaybackResume\(true\)/);
  assert.doesNotMatch(pageHide, /clearPlaybackResume/);
});

test("a fast Play intent waits for the restored media source instead of failing", () => {
  const toggle = sourceSlice(playerSource, "private toggleSc(): void", "private spotifyItemUri(");
  assert.match(toggle, /this\._isLoading/);
  assert.match(toggle, /this\._resumePendingSeek/);
  assert.match(toggle, /this\._playRequestedWhileLoading = true/);

  const load = sourceSlice(
    playerSource,
    "private async loadTrackInternal(",
    "async loadTrack(track",
  );
  assert.match(
    load,
    /const shouldStartPlayback =\s*autoPlay \|\| this\._playRequestedWhileLoading/,
  );
  assert.match(load, /if \(this\._resumePendingSeek\)[\s\S]*?metadata\/duration handlers seek first/);
  const seekBeforePlay = load.indexOf(
    "const startedAfterResumeSeek = this.applyPendingPlaybackResumeSeek()",
  );
  const startAfterSeek = load.indexOf("await this.startAudio(loadId)", seekBeforePlay);
  assert.ok(seekBeforePlay >= 0 && startAfterSeek > seekBeforePlay);
});

test("a verified SoundCloud account switch cannot re-own the old account's track", () => {
  const initialize = sourceSlice(
    playerSource,
    "initializePlaybackResume(",
    "private async restorePlaybackResume(",
  );
  const ownerMismatch = initialize.indexOf("this._resumeOwnerUrn !== ownerUrn");
  const release = initialize.indexOf("this.stop()", ownerMismatch);
  const assign = initialize.indexOf("this._resumeOwnerUrn = ownerUrn");
  assert.ok(ownerMismatch >= 0 && release > ownerMismatch && assign > release);
});

test("a playing or changing Spotify source can abort startup takeover", () => {
  const stable = sourceSlice(
    playerSource,
    "private async waitForStablePausedSpotifyBaseline(",
    "initializePlaybackResume(",
  );
  assert.match(stable, /this\.spotifyPlaying\(\)/);
  assert.match(stable, /generation !== this\._resumeInitializationGeneration/);
  assert.match(stable, /current === uri/);

  const restore = sourceSlice(
    playerSource,
    "private async restorePlaybackResume(",
    "private persistSetting(",
  );
  assert.match(restore, /!baseline\.allowed/);
  assert.match(restore, /loadGeneration !== this\._loadId/);
  assert.match(restore, /this\.spotifyPlaying\(\)/);
});
