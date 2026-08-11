import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/auth.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const auth = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const credentials = {
  accessToken: "oauth-test-token-value",
  webClientId: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",
};

function installStorage({ platformSetFails = false } = {}) {
  const platform = new Map([[auth.SETTINGS_KEY, "stale-platform"]]);
  const legacy = new Map([[auth.SETTINGS_KEY, "stale-legacy"]]);
  const browser = new Map([[auth.SETTINGS_KEY, "stale-browser"]]);
  const calls = {
    platformSet: 0,
    platformClear: 0,
    legacySet: 0,
    legacyRemove: 0,
    browserSet: 0,
    browserRemove: 0,
    events: [],
  };

  globalThis.Spicetify = {
    Platform: {
      LocalStorageAPI: {
        getItem(key) { return platform.get(key) ?? null; },
        setItem(key, value) {
          calls.platformSet += 1;
          if (platformSetFails) throw new Error("platform unavailable");
          platform.set(key, value);
        },
        clearItem(key) {
          calls.platformClear += 1;
          platform.delete(key);
        },
      },
    },
    LocalStorage: {
      get(key) { return legacy.get(key) ?? null; },
      set(key, value) {
        calls.legacySet += 1;
        legacy.set(key, value);
      },
      remove(key) {
        calls.legacyRemove += 1;
        legacy.delete(key);
      },
    },
  };
  globalThis.window = {
    localStorage: {
      getItem(key) { return browser.get(key) ?? null; },
      setItem(key, value) {
        calls.browserSet += 1;
        browser.set(key, value);
      },
      removeItem(key) {
        calls.browserRemove += 1;
        browser.delete(key);
      },
    },
    dispatchEvent(event) {
      calls.events.push(event);
      return true;
    },
  };
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  return { platform, legacy, browser, calls };
}

test("saveSettings keeps the account-scoped copy and removes legacy copies", () => {
  const state = installStorage();

  auth.saveSettings(credentials);

  assert.deepEqual(JSON.parse(state.platform.get(auth.SETTINGS_KEY)), credentials);
  assert.equal(state.legacy.has(auth.SETTINGS_KEY), false);
  assert.equal(state.browser.has(auth.SETTINGS_KEY), false);
  assert.equal(state.calls.platformSet >= 1, true);
  assert.equal(state.calls.legacySet, 0);
  assert.equal(state.calls.legacyRemove, 1);
  assert.equal(state.calls.browserRemove, 1);
  assert.equal(state.calls.events.at(-1)?.type, "wavelink:settings");
});

test("saveSettings clears a stale primary copy before using a fallback", () => {
  const state = installStorage({ platformSetFails: true });

  auth.saveSettings(credentials);

  assert.equal(state.platform.has(auth.SETTINGS_KEY), false);
  assert.deepEqual(JSON.parse(state.legacy.get(auth.SETTINGS_KEY)), credentials);
  assert.equal(state.browser.has(auth.SETTINGS_KEY), false);
  assert.equal(state.calls.platformClear, 1);
  assert.equal(state.calls.legacySet >= 1, true);
});

test("clearSettings calls every backend's removal API and leaves no empty copy", () => {
  const state = installStorage();
  const setCallsBefore =
    state.calls.platformSet + state.calls.legacySet + state.calls.browserSet;

  auth.clearSettings();

  assert.equal(state.platform.has(auth.SETTINGS_KEY), false);
  assert.equal(state.legacy.has(auth.SETTINGS_KEY), false);
  assert.equal(state.browser.has(auth.SETTINGS_KEY), false);
  assert.equal(state.calls.platformClear, 1);
  assert.equal(state.calls.legacyRemove, 1);
  assert.equal(state.calls.browserRemove, 1);
  assert.equal(
    state.calls.platformSet + state.calls.legacySet + state.calls.browserSet,
    setCallsBefore,
  );
  assert.deepEqual(state.calls.events.at(-1)?.detail, {
    accessToken: "",
    webClientId: "",
  });
});
