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

const modelSource = await readFile(
  new URL("../src/services/spotifySearchSetting.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(modelSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const setting = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const [
  playerSource,
  hookSource,
  settingsSource,
  extensionSource,
  dropdownSource,
  pageSource,
] = await Promise.all([
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/hooks/usePlayer.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../src/components/SettingsView.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/extensions/extension.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/services/searchIntegration.ts", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL("../src/services/searchPageIntegration.ts", import.meta.url),
    "utf8",
  ),
]);

function sourceFrom(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  return source.slice(start);
}

test("Spotify Search integration defaults on and honors only an explicit false", () => {
  for (const value of [null, undefined, "garbage", true, "true", 1]) {
    assert.equal(
      setting.normalizeSpotifySearchIntegrationEnabled(value),
      true,
    );
  }
  assert.equal(
    setting.normalizeSpotifySearchIntegrationEnabled(false),
    false,
  );
  assert.equal(
    setting.normalizeSpotifySearchIntegrationEnabled("false"),
    false,
  );

  assert.equal(
    setting.shouldRunSpotifySearchIntegration(true, true),
    true,
  );
  assert.equal(
    setting.shouldRunSpotifySearchIntegration(false, true),
    false,
  );
  assert.equal(
    setting.shouldRunSpotifySearchIntegration(true, false),
    false,
  );
});

test("the dedicated preference event carries a validated live boolean", () => {
  const target = new EventTarget();
  const received = [];
  target.addEventListener(
    setting.SPOTIFY_SEARCH_INTEGRATION_CHANGED_EVENT,
    (event) => received.push(event.detail),
  );

  assert.equal(
    setting.dispatchSpotifySearchIntegrationChanged(false, target),
    true,
  );
  assert.deepEqual(received, [{ enabled: false }]);
  assert.deepEqual(
    setting.parseSpotifySearchIntegrationChangedDetail(received[0]),
    { enabled: false },
  );
  assert.equal(
    setting.parseSpotifySearchIntegrationChangedDetail({
      enabled: "false",
    }),
    null,
  );
});

test("Settings persists and exposes the Spotify Search opt-out live", () => {
  for (const source of [playerSource, settingsSource]) {
    assert.match(source, /\bspotifySearchIntegrationEnabled\b/);
  }
  for (const source of [playerSource, hookSource, settingsSource]) {
    assert.match(source, /\bsetSpotifySearchIntegrationEnabled\b/);
  }
  assert.match(hookSource, /\.\.\.state/);
  assert.match(
    playerSource,
    /SPOTIFY_SEARCH_INTEGRATION_STORAGE_KEY[\s\S]{0,120}String\(enabled\)/,
  );
  assert.match(
    playerSource,
    /dispatchSpotifySearchIntegrationChanged\(enabled\);[\s\S]{0,60}this\.emit\(\);/,
  );
  assert.match(settingsSource, /Spotify search integration/);
  assert.match(
    settingsSource,
    /Show SoundCloud results in Spotify Search/,
  );
  assert.match(
    settingsSource,
    /WaveLink&apos;s own Search remains available/,
  );
  assert.match(
    settingsSource,
    /checked=\{spotifySearchIntegrationEnabled\}/,
  );
  assert.doesNotMatch(
    settingsSource,
    /(?:init|destroy)Search(?:Page)?Integration/,
  );
});

test("the extension owns live init and teardown with stale-check protection", () => {
  assert.match(
    extensionSource,
    /const generation = \+\+syncGeneration;/,
  );
  assert.match(
    extensionSource,
    /if \(!preferenceEnabled\) \{\s*applySearchIntegrations\(false\);\s*return;/,
  );
  assert.match(
    extensionSource,
    /generation !== syncGeneration \|\|\s*!readSpotifySearchIntegrationEnabled\(\)/,
  );
  assert.match(
    extensionSource,
    /shouldRunSpotifySearchIntegration\(\s*true,\s*capabilityAvailable/,
  );
  assert.match(
    extensionSource,
    /initSearchIntegration\(\);\s*initSearchPageIntegration\(\);/,
  );
  assert.match(
    extensionSource,
    /destroySearchIntegration\(\);\s*destroySearchPageIntegration\(\);/,
  );
  assert.match(
    extensionSource,
    /SPOTIFY_SEARCH_INTEGRATION_CHANGED_EVENT[\s\S]{0,320}detail\?\.enabled === false[\s\S]{0,180}\+\+syncGeneration;[\s\S]{0,180}applySearchIntegrations\(false\)/,
  );
  assert.doesNotMatch(extensionSource, /_checkingCapabilities/);
});

test("disabling either Spotify Search surface fully cleans owned runtime state", () => {
  const dropdownDestroy = sourceFrom(
    dropdownSource,
    "export function destroySearchIntegration(): void",
  );
  assert.match(dropdownDestroy, /_destroyed = true;/);
  assert.match(dropdownDestroy, /_searchGeneration\+\+;/);
  assert.match(dropdownDestroy, /_bodyObs\?\.disconnect\(\);/);
  assert.match(dropdownDestroy, /_gridObs\?\.disconnect\(\);/);
  assert.match(dropdownDestroy, /clearScRows\(document\);/);
  assert.match(dropdownDestroy, /clearSpotifyBadges\(document\);/);
  assert.match(dropdownDestroy, /sc-si-styles/);
  assert.match(
    dropdownSource,
    /function syncGrid\(\): void \{\s*if \(_destroyed\) return;/,
  );
  assert.match(
    dropdownSource,
    /document\.activeElement[\s\S]{0,220}void doSearch\(activeElement\.value\)/,
  );

  const pageDestroy = sourceFrom(
    pageSource,
    "export function destroySearchPageIntegration(): void",
  );
  assert.match(pageDestroy, /_destroyed = true;/);
  assert.match(pageDestroy, /_searchGeneration\+\+;/);
  assert.match(pageDestroy, /_historyUnlisten\?\.\(\);/);
  assert.match(pageDestroy, /clearInterval\(_pollInterval\);/);
  assert.match(pageDestroy, /_pageObs\?\.disconnect\(\);/);
  assert.match(pageDestroy, /clearScRows\(\);/);
  assert.match(pageDestroy, /clearSpotifyBadges\(\);/);
  assert.match(pageDestroy, /sc-sp-styles/);
});
