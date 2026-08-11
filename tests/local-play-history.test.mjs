import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import ts from "typescript";

const requireFromTest = createRequire(import.meta.url);
const servicePath = fileURLToPath(
  new URL("../src/services/localPlayHistory.ts", import.meta.url),
);

class TestCustomEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.detail = init.detail;
  }
}

/**
 * Load a TypeScript module as CommonJS, including any relative TypeScript
 * dependencies. A new cache represents the independently bundled startup
 * extension or custom app.
 */
function loadTypeScriptModule(filename, cache = new Map()) {
  const absolute = resolve(filename);
  const cached = cache.get(absolute);
  if (cached) return cached.exports;

  const module = { exports: {} };
  cache.set(absolute, module);
  const source = readFileSync(absolute, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: absolute,
  }).outputText;

  const localRequire = (specifier) => {
    if (!specifier.startsWith(".")) return requireFromTest(specifier);
    const base = resolve(dirname(absolute), specifier);
    const candidates = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      resolve(base, "index.ts"),
    ];
    for (const candidate of candidates) {
      try {
        readFileSync(candidate);
        return loadTypeScriptModule(candidate, cache);
      } catch {}
    }
    throw new Error(`Could not resolve ${specifier} from ${absolute}`);
  };

  const execute = new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    compiled,
  );
  execute(
    module.exports,
    localRequire,
    module,
    absolute,
    dirname(absolute),
  );
  return module.exports;
}

function loadFreshService() {
  return loadTypeScriptModule(servicePath, new Map());
}

function installStorage({
  platformSetFails = false,
  legacySetFails = false,
  browserSetFails = false,
} = {}) {
  const platform = new Map();
  const legacy = new Map();
  const browser = new Map();
  const calls = {
    platformSet: 0,
    platformClear: 0,
    legacySet: 0,
    legacyRemove: 0,
    browserSet: 0,
    browserRemove: 0,
  };

  globalThis.CustomEvent = TestCustomEvent;
  globalThis.Spicetify = {
    Platform: {
      LocalStorageAPI: {
        getItem(key) {
          return platform.get(key) ?? null;
        },
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
      get(key) {
        return legacy.get(key) ?? null;
      },
      set(key, value) {
        calls.legacySet += 1;
        if (legacySetFails) throw new Error("legacy unavailable");
        legacy.set(key, value);
      },
      remove(key) {
        calls.legacyRemove += 1;
        legacy.delete(key);
      },
    },
  };

  const windowTarget = new EventTarget();
  windowTarget.localStorage = {
    getItem(key) {
      return browser.get(key) ?? null;
    },
    setItem(key, value) {
      calls.browserSet += 1;
      if (browserSetFails) throw new Error("browser unavailable");
      browser.set(key, value);
    },
    removeItem(key) {
      calls.browserRemove += 1;
      browser.delete(key);
    },
  };
  globalThis.window = windowTarget;

  return { platform, legacy, browser, calls, window: windowTarget };
}

function makeTrack(id, title = `Track ${id}`) {
  const urn = `soundcloud:tracks:${id}`;
  const userUrn = `soundcloud:users:${Number(id) + 1000}`;
  return {
    id: urn,
    urn,
    title,
    duration: 183_000,
    user: {
      id: userUrn,
      urn: userUrn,
      username: `Artist ${id}`,
      avatar_url: `https://i1.sndcdn.com/avatars-${id}.jpg`,
      permalink_url: `https://soundcloud.com/artist-${id}`,
      city: "Kyiv",
      country: "Ukraine",
      description: "Artist description",
      followers_count: 12,
      followings_count: 3,
      track_count: 8,
      playlist_count: 2,
      verified: false,
      followed_by_user: true,
    },
    artwork_url: `https://i1.sndcdn.com/artworks-${id}.jpg`,
    permalink_url: `https://soundcloud.com/artist-${id}/track-${id}`,
    kind: "track",
    likes_count: 21,
    playback_count: 34,
    reposts_count: 5,
    comment_count: 6,
    description: "Track description",
    genre: "Electronic",
    access: "playable",
    policy: "ALLOW",
    streamable: true,
    has_transcodings: true,
    sharing: "public",
    user_favorite: false,
    reposted_by_user: false,
  };
}

function storedValue(environment, key) {
  return (
    environment.platform.get(key) ??
    environment.legacy.get(key) ??
    environment.browser.get(key) ??
    null
  );
}

test("local history persists schema v1 in the first backend and keeps one copy", () => {
  const environment = installStorage();
  const history = loadFreshService();
  const key = history.LOCAL_PLAY_HISTORY_KEY;
  environment.legacy.set(key, "stale legacy copy");
  environment.browser.set(key, "stale browser copy");

  assert.equal(
    history.recordLocalPlayHistory(makeTrack(7), 1_700_000_000_007),
    true,
  );

  const raw = environment.platform.get(key);
  assert.equal(typeof raw, "string");
  assert.equal(environment.legacy.has(key), false);
  assert.equal(environment.browser.has(key), false);
  assert.deepEqual(
    JSON.parse(raw),
    {
      version: 1,
      entries: history.loadLocalPlayHistory(),
    },
  );
  const [entry] = history.loadLocalPlayHistory();
  assert.equal(entry.playedAt, 1_700_000_000_007);
  assert.equal(entry.track.urn, "soundcloud:tracks:7");
  assert.equal(entry.track.title, "Track 7");
});

test("storage falls back in order and removes copies outside the selected backend", () => {
  const environment = installStorage({ platformSetFails: true });
  const history = loadFreshService();
  const key = history.LOCAL_PLAY_HISTORY_KEY;
  environment.platform.set(key, "stale platform copy");
  environment.browser.set(key, "stale browser copy");

  assert.equal(history.recordLocalPlayHistory(makeTrack(8), 800), true);
  assert.equal(environment.platform.has(key), false);
  assert.equal(typeof environment.legacy.get(key), "string");
  assert.equal(environment.browser.has(key), false);
  assert.equal(environment.calls.platformSet >= 1, true);
  assert.equal(environment.calls.platformClear >= 1, true);
  assert.equal(environment.calls.legacySet >= 1, true);

  const browserEnvironment = installStorage({
    platformSetFails: true,
    legacySetFails: true,
  });
  const browserHistory = loadFreshService();
  const browserKey = browserHistory.LOCAL_PLAY_HISTORY_KEY;
  browserEnvironment.platform.set(browserKey, "stale platform copy");
  browserEnvironment.legacy.set(browserKey, "stale legacy copy");

  assert.equal(
    browserHistory.recordLocalPlayHistory(makeTrack(9), 900),
    true,
  );
  assert.equal(browserEnvironment.platform.has(browserKey), false);
  assert.equal(browserEnvironment.legacy.has(browserKey), false);
  assert.equal(typeof browserEnvironment.browser.get(browserKey), "string");
  assert.equal(browserEnvironment.calls.browserSet >= 1, true);
});

test("a repeated canonical track moves to the front with fresh metadata", () => {
  installStorage();
  const history = loadFreshService();

  assert.equal(history.recordLocalPlayHistory(makeTrack(17, "Old A"), 100), true);
  assert.equal(history.recordLocalPlayHistory(makeTrack(18, "Track B"), 200), true);
  assert.equal(
    history.recordLocalPlayHistory(
      {
        ...makeTrack(17, "Fresh A"),
        id: "17",
        urn: "17",
      },
      300,
    ),
    true,
  );

  const entries = history.loadLocalPlayHistory();
  assert.deepEqual(
    entries.map(({ playedAt, track }) => [
      playedAt,
      track.urn,
      track.title,
    ]),
    [
      [300, "soundcloud:tracks:17", "Fresh A"],
      [200, "soundcloud:tracks:18", "Track B"],
    ],
  );
});

test("removal matches the exact canonical entry and preserves the remaining order", () => {
  const environment = installStorage();
  const history = loadFreshService();
  assert.equal(history.recordLocalPlayHistory(makeTrack(51), 100), true);
  assert.equal(history.recordLocalPlayHistory(makeTrack(52), 200), true);
  assert.equal(history.recordLocalPlayHistory(makeTrack(53), 300), true);

  const snapshots = [];
  environment.window.addEventListener(
    history.LOCAL_PLAY_HISTORY_CHANGED_EVENT,
    () => snapshots.push(history.loadLocalPlayHistory()),
  );

  assert.equal(history.removeLocalPlayHistoryTrack("52", 200), true);
  assert.deepEqual(
    history.loadLocalPlayHistory().map(({ playedAt, track }) => [
      playedAt,
      track.urn,
      track.title,
    ]),
    [
      [300, "soundcloud:tracks:53", "Track 53"],
      [100, "soundcloud:tracks:51", "Track 51"],
    ],
  );
  assert.equal(snapshots.length, 1);
  assert.deepEqual(
    snapshots[0].map((entry) => entry.track.urn),
    ["soundcloud:tracks:53", "soundcloud:tracks:51"],
    "the committed removal is visible before the synchronous change event",
  );
});

test("a stale removal cannot erase a newer replay of the same track", () => {
  const environment = installStorage();
  const history = loadFreshService();
  assert.equal(history.recordLocalPlayHistory(makeTrack(61), 100), true);
  assert.equal(history.recordLocalPlayHistory(makeTrack(61, "Replay"), 200), true);

  let events = 0;
  environment.window.addEventListener(
    history.LOCAL_PLAY_HISTORY_CHANGED_EVENT,
    () => {
      events += 1;
    },
  );
  const callsBefore = { ...environment.calls };

  assert.equal(
    history.removeLocalPlayHistoryTrack("soundcloud:tracks:61", 100),
    false,
  );
  assert.deepEqual(environment.calls, callsBefore, "a stale identity does not write");
  assert.equal(events, 0);
  assert.deepEqual(
    history.loadLocalPlayHistory().map(({ playedAt, track }) => [
      playedAt,
      track.title,
    ]),
    [[200, "Replay"]],
  );
});

test("removal rereads storage and preserves a concurrent record from another bundle", () => {
  installStorage();
  const firstBundle = loadFreshService();
  const secondBundle = loadFreshService();
  assert.equal(firstBundle.recordLocalPlayHistory(makeTrack(71), 100), true);
  assert.equal(firstBundle.recordLocalPlayHistory(makeTrack(72), 200), true);

  assert.equal(secondBundle.recordLocalPlayHistory(makeTrack(73), 300), true);
  assert.equal(firstBundle.removeLocalPlayHistoryTrack("71", 100), true);
  assert.deepEqual(
    secondBundle.loadLocalPlayHistory().map(({ playedAt, track }) => [
      playedAt,
      track.urn,
    ]),
    [
      [300, "soundcloud:tracks:73"],
      [200, "soundcloud:tracks:72"],
    ],
  );
});

test("removing the final entry persists an authoritative empty store", () => {
  const environment = installStorage();
  const history = loadFreshService();
  const key = history.LOCAL_PLAY_HISTORY_KEY;
  assert.equal(history.recordLocalPlayHistory(makeTrack(81), 100), true);
  environment.legacy.set(key, JSON.stringify({
    version: 1,
    entries: [{ playedAt: 50, track: makeTrack(82) }],
  }));
  environment.browser.set(key, JSON.stringify({
    version: 1,
    entries: [{ playedAt: 40, track: makeTrack(83) }],
  }));

  assert.equal(history.removeLocalPlayHistoryTrack("81", 100), true);
  assert.deepEqual(JSON.parse(environment.platform.get(key)), {
    version: 1,
    entries: [],
  });
  assert.equal(environment.legacy.has(key), false);
  assert.equal(environment.browser.has(key), false);
  assert.deepEqual(history.loadLocalPlayHistory(), []);
});

test("invalid, missing, or unwritable removals leave history unchanged and emit nothing", () => {
  const environment = installStorage();
  const history = loadFreshService();
  assert.equal(history.recordLocalPlayHistory(makeTrack(91), 100), true);

  let events = 0;
  environment.window.addEventListener(
    history.LOCAL_PLAY_HISTORY_CHANGED_EVENT,
    () => {
      events += 1;
    },
  );
  const callsBefore = { ...environment.calls };
  for (const [trackUrn, playedAt] of [
    ["soundcloud:users:91", 100],
    ["not-a-track", 100],
    [91, 999],
    [91, -1],
    [91, 1.5],
    [91, Number.NaN],
  ]) {
    assert.equal(
      history.removeLocalPlayHistoryTrack(trackUrn, playedAt),
      false,
    );
  }
  assert.deepEqual(environment.calls, callsBefore);
  assert.equal(events, 0);
  assert.equal(history.loadLocalPlayHistory()[0]?.track.urn, "soundcloud:tracks:91");

  const failingEnvironment = installStorage({
    platformSetFails: true,
    legacySetFails: true,
    browserSetFails: true,
  });
  const failingHistory = loadFreshService();
  const failingKey = failingHistory.LOCAL_PLAY_HISTORY_KEY;
  const original = JSON.stringify({
    version: 1,
    entries: [{ playedAt: 200, track: makeTrack(92) }],
  });
  failingEnvironment.platform.set(failingKey, original);
  let failedEvents = 0;
  failingEnvironment.window.addEventListener(
    failingHistory.LOCAL_PLAY_HISTORY_CHANGED_EVENT,
    () => {
      failedEvents += 1;
    },
  );

  assert.equal(failingHistory.removeLocalPlayHistoryTrack(92, 200), false);
  assert.equal(failingEnvironment.platform.get(failingKey), original);
  assert.equal(failedEvents, 0);
  assert.equal(
    failingHistory.loadLocalPlayHistory()[0]?.track.urn,
    "soundcloud:tracks:92",
  );
});

test("local history is capped at the newest 100 unique tracks", () => {
  installStorage();
  const history = loadFreshService();
  assert.equal(history.MAX_LOCAL_PLAY_HISTORY_ENTRIES, 100);

  for (let id = 1; id <= 103; id += 1) {
    assert.equal(history.recordLocalPlayHistory(makeTrack(id), id), true);
  }

  const entries = history.loadLocalPlayHistory();
  assert.equal(entries.length, history.MAX_LOCAL_PLAY_HISTORY_ENTRIES);
  assert.deepEqual(
    entries.map((entry) => entry.track.urn),
    Array.from(
      { length: history.MAX_LOCAL_PLAY_HISTORY_ENTRIES },
      (_, index) => `soundcloud:tracks:${103 - index}`,
    ),
  );
  assert.equal(entries[0].playedAt, 103);
  assert.equal(entries.at(-1).playedAt, 4);
});

test("malformed or unsupported persisted payloads are ignored and repaired on record", () => {
  const environment = installStorage();
  const history = loadFreshService();
  const key = history.LOCAL_PLAY_HISTORY_KEY;
  const malformedPayloads = [
    "{",
    "null",
    JSON.stringify([]),
    JSON.stringify({ version: 2, entries: [] }),
    JSON.stringify({ version: 1, entries: "not-an-array" }),
    JSON.stringify({
      version: 1,
      entries: [{ playedAt: "yesterday", track: {} }],
    }),
  ];

  for (const payload of malformedPayloads) {
    environment.platform.set(key, payload);
    assert.deepEqual(history.loadLocalPlayHistory(), []);
  }

  environment.platform.set(key, "{broken");
  assert.equal(history.recordLocalPlayHistory(makeTrack(22), 220), true);
  assert.deepEqual(JSON.parse(environment.platform.get(key)), {
    version: 1,
    entries: history.loadLocalPlayHistory(),
  });
});

test("independent bundles observe a persisted history change exactly once", () => {
  const environment = installStorage();
  const publisher = loadFreshService();
  const subscriber = loadFreshService();
  const snapshots = [];
  const unsubscribe = subscriber.subscribeLocalPlayHistoryChanged(() => {
    snapshots.push(subscriber.loadLocalPlayHistory());
  });

  assert.equal(
    publisher.recordLocalPlayHistory(makeTrack(31), 310),
    true,
  );
  assert.equal(snapshots.length, 1);
  assert.equal(
    snapshots[0][0]?.track.urn,
    "soundcloud:tracks:31",
    "the write is visible before the synchronous change event",
  );

  assert.equal(
    publisher.recordLocalPlayHistory(
      {
        ...makeTrack(32),
        id: "soundcloud:users:32",
        urn: "soundcloud:users:32",
      },
      320,
    ),
    false,
  );
  assert.equal(snapshots.length, 1, "a rejected record emits no change");

  unsubscribe();
  assert.equal(publisher.recordLocalPlayHistory(makeTrack(33), 330), true);
  assert.equal(snapshots.length, 1);
});

test("persistence and change events expose only allowlisted display fields", () => {
  const environment = installStorage();
  const history = loadFreshService();
  const secrets = {
    accessToken: "secret-oauth-token-sentinel",
    webClientId: "secret-client-id-sentinel",
    authorization: "secret-authorization-sentinel",
    client_id: "secret-query-client-sentinel",
    oauth_token: "secret-query-oauth-sentinel",
    media: {
      transcodings: [{
        url: "https://api-v2.soundcloud.com/secret-signed-media-sentinel",
      }],
    },
  };
  const track = {
    ...makeTrack(41),
    ...secrets,
    user: {
      ...makeTrack(41).user,
      ...secrets,
    },
  };
  let eventDetail;
  environment.window.addEventListener(
    history.LOCAL_PLAY_HISTORY_CHANGED_EVENT,
    (event) => {
      eventDetail = event.detail;
    },
  );

  assert.equal(history.recordLocalPlayHistory(track, 410), true);
  const raw = storedValue(environment, history.LOCAL_PLAY_HISTORY_KEY);
  assert.equal(typeof raw, "string");

  const payload = JSON.parse(raw);
  const storedTrack = payload.entries[0].track;
  const allowedTrackKeys = new Set([
    "id",
    "urn",
    "title",
    "duration",
    "user",
    "artwork_url",
    "permalink_url",
    "kind",
    "likes_count",
    "playback_count",
    "reposts_count",
    "comment_count",
    "description",
    "genre",
    "access",
    "policy",
    "streamable",
    "has_transcodings",
    "sharing",
    "user_favorite",
    "reposted_by_user",
  ]);
  const allowedUserKeys = new Set([
    "id",
    "urn",
    "username",
    "avatar_url",
    "permalink_url",
    "city",
    "country",
    "description",
    "followers_count",
    "followings_count",
    "track_count",
    "playlist_count",
    "verified",
    "followed_by_user",
  ]);
  assert.equal(
    Object.keys(storedTrack).every((key) => allowedTrackKeys.has(key)),
    true,
  );
  assert.equal(storedTrack.policy, "ALLOW");
  assert.equal(storedTrack.streamable, true);
  assert.equal(storedTrack.has_transcodings, true);
  assert.equal("media" in storedTrack, false);
  assert.equal(
    Object.keys(storedTrack.user).every((key) => allowedUserKeys.has(key)),
    true,
  );
  assert.equal(storedTrack.urn, "soundcloud:tracks:41");
  assert.equal(storedTrack.user.urn, "soundcloud:users:1041");

  const exposed = `${raw}\n${JSON.stringify(eventDetail) ?? ""}`;
  for (const sentinel of [
    secrets.accessToken,
    secrets.webClientId,
    secrets.authorization,
    secrets.client_id,
    secrets.oauth_token,
    secrets.media.transcodings[0].url,
  ]) {
    assert.equal(exposed.includes(sentinel), false);
  }
});
