import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [settingsSource, apiSource, versionSource, appCss, packageJson] =
  await Promise.all([
    readFile(
      new URL("../src/components/SettingsView.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/services/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/version.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/styles/app.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8").then(JSON.parse),
  ]);

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker after ${startMarker}`);
  return source.slice(start, end);
}

test("Settings ends with the installed WaveLink version", () => {
  assert.match(
    settingsSource,
    /import \{ WAVELINK_VERSION \} from "\.\.\/version";/,
  );
  const disconnect = settingsSource.indexOf("Disconnect SoundCloud");
  const version = settingsSource.indexOf(
    '<small className="sc-settings__version">',
  );
  assert.ok(disconnect >= 0 && version > disconnect);
  assert.match(
    settingsSource.slice(version),
    /WaveLink \{WAVELINK_VERSION\}[\s\S]*?<\/small>/,
  );
});

test("the displayed and API versions share the package release value", () => {
  const match = versionSource.match(/WAVELINK_VERSION = "([^"]+)"/);
  assert.ok(match);
  assert.equal(match[1], packageJson.version);
  assert.match(apiSource, /version:\s*WAVELINK_VERSION/);
  assert.doesNotMatch(apiSource, /DIRECT_VERSION/);
});

test("the Settings version is a small subdued footer", () => {
  const rule = sourceSlice(
    appCss,
    ".sc-settings__version {",
    ".sc-auth__setup-btn {",
  );
  assert.match(rule, /align-self:\s*center;/);
  assert.match(rule, /color:\s*var\(--text-subdued/);
  assert.match(rule, /font-size:\s*11px;/);
  assert.match(rule, /opacity:\s*0\.62;/);
});
