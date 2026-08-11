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
  new URL("../src/services/tracksPerLoadSetting.ts", import.meta.url),
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

const [settingsSource, appCss] = await Promise.all([
  readFile(
    new URL("../src/components/SettingsView.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/styles/app.css", import.meta.url), "utf8"),
]);

test("tracks per load normalizes persisted and user-entered values", () => {
  assert.equal(setting.DEFAULT_TRACKS_PER_LOAD, 50);
  assert.equal(setting.MIN_TRACKS_PER_LOAD, 10);
  assert.equal(setting.MAX_TRACKS_PER_LOAD, 200);

  for (const value of [null, undefined, "", "   ", "invalid", Number.NaN, Infinity]) {
    assert.equal(setting.normalizeTracksPerLoad(value), 50);
  }
  assert.equal(setting.normalizeTracksPerLoad("75"), 75);
  assert.equal(setting.normalizeTracksPerLoad(75.9), 75);
  assert.equal(setting.normalizeTracksPerLoad(1), 10);
  assert.equal(setting.normalizeTracksPerLoad("999"), 200);
});

test("tracks per load reads the dedicated Spicetify preference safely", () => {
  const previous = globalThis.Spicetify;
  try {
    globalThis.Spicetify = {
      LocalStorage: {
        get(key) {
          assert.equal(key, setting.TRACKS_PER_LOAD_STORAGE_KEY);
          return "84";
        },
      },
    };
    assert.equal(setting.readTracksPerLoad(), 84);

    globalThis.Spicetify.LocalStorage.get = () => {
      throw new Error("storage unavailable");
    };
    assert.equal(setting.readTracksPerLoad(), 50);
  } finally {
    if (previous === undefined) delete globalThis.Spicetify;
    else globalThis.Spicetify = previous;
  }
});

test("the dedicated change event carries a normalized, validated integer", () => {
  const target = new EventTarget();
  const received = [];
  target.addEventListener(setting.TRACKS_PER_LOAD_CHANGED_EVENT, (event) => {
    received.push(event.detail);
  });

  assert.equal(setting.dispatchTracksPerLoadChanged(77.8, target), true);
  assert.deepEqual(received, [{ tracksPerLoad: 77 }]);
  assert.deepEqual(
    setting.parseTracksPerLoadChangedDetail(received[0]),
    { tracksPerLoad: 77 },
  );

  for (const detail of [
    null,
    { tracksPerLoad: "77" },
    { tracksPerLoad: 9 },
    { tracksPerLoad: 201 },
    { tracksPerLoad: 20.5 },
  ]) {
    assert.equal(setting.parseTracksPerLoadChangedDetail(detail), null);
  }
});

test("Settings exposes a bounded number input and commits only on blur or Enter", () => {
  assert.match(settingsSource, /Content loading/);
  assert.match(settingsSource, /Tracks per load/);
  assert.match(settingsSource, /playlists, profiles,[\s\S]*search results and queues/);
  assert.match(settingsSource, /type="number"/);
  assert.match(settingsSource, /min=\{MIN_TRACKS_PER_LOAD\}/);
  assert.match(settingsSource, /max=\{MAX_TRACKS_PER_LOAD\}/);
  assert.match(settingsSource, /step=\{1\}/);
  assert.match(settingsSource, /value=\{tracksPerLoadDraft\}/);
  assert.match(settingsSource, /onBlur=\{commitTracksPerLoad\}/);
  assert.match(
    settingsSource,
    /event\.key === "Enter"[\s\S]{0,140}event\.currentTarget\.blur\(\)/,
  );
  assert.doesNotMatch(
    settingsSource,
    /onChange=\{[^}]*setTracksPerLoad\(/,
  );
});

test("the numeric setting reuses WaveLink form styling at a compact width", () => {
  assert.match(appCss, /\.sc-settings__number-row\s*\{/);
  assert.match(
    appCss,
    /\.sc-settings__number-row \.sc-input\s*\{[\s\S]{0,100}flex:\s*0 0 112px;/,
  );
  assert.match(appCss, /\.sc-settings__number-unit\s*\{/);
});
