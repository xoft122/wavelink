import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [settingsSource, hookSource, playerSource] = await Promise.all([
  readFile(
    new URL("../src/components/SettingsView.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/hooks/usePlayer.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
]);

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker after ${startMarker}`);
  return source.slice(start, end);
}

test("Settings no longer exposes a Spotify player-bar opt-out", () => {
  assert.doesNotMatch(
    settingsSource,
    /Spotify player-bar integration|nativeAdapterEnabled|setNativeAdapterEnabled/,
  );
  assert.doesNotMatch(hookSource, /setNativeAdapterEnabled|nativeAdapterEnabled/);
  assert.match(settingsSource, />Playback</);
  assert.match(settingsSource, />Autoplay related tracks</);
});

test("legacy stored false cannot disable the required player-bar integration", () => {
  for (const legacyOptOut of [
    "wavelink:native-adapter-enabled",
    "STORAGE_KEYS.nativeAdapter",
    "_nativeAdapterEnabled",
    "nativeAdapterEnabled",
    "setNativeAdapterEnabled",
  ]) {
    assert.equal(
      playerSource.includes(legacyOptOut),
      false,
      `Player must not retain the opt-out path: ${legacyOptOut}`,
    );
  }
});

test("player-bar hooks are installed unconditionally when Spicetify is ready", () => {
  const startup = sourceSlice(
    playerSource,
    "private waitForSpicetify(): void",
    "private bindAudioEvents(): void",
  );

  assert.match(
    startup,
    /this\.hookSpotifyPlayer\(\);\s*this\.hookSkipButtons\(\);\s*this\.hookProgressBar\(\);/,
  );
  assert.match(
    startup,
    /this\._tryEnsureNativeControls = \(\) => this\.ensureNativeControls\(\);\s*this\._tryEnsureNativeControls\(\);/,
  );
});

test("active playback continuously restores Spotify player-bar integration", () => {
  const timer = sourceSlice(
    playerSource,
    "private startTimer(): void",
    "private stopTimer(): void",
  );
  assert.match(timer, /this\._tryHookProgressBar\?\.\(\);/);
  assert.match(timer, /this\._tryHookSkipButtons\?\.\(\);/);
  assert.match(timer, /this\._tryHookVolumeInput\?\.\(\);/);
  assert.match(timer, /this\._tryEnsureNativeControls\?\.\(\);/);
  assert.match(timer, /this\.applyTrackInfo\(\);/);
  assert.match(timer, /this\.syncSpotifyProgress\(\);/);
});
