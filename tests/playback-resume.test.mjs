import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import ts from "typescript";

const requireFromTest = createRequire(import.meta.url);
const servicePath = fileURLToPath(
  new URL("../src/services/playbackResume.ts", import.meta.url),
);

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
    for (const candidate of [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      resolve(base, "index.ts"),
    ]) {
      try {
        readFileSync(candidate);
        return loadTypeScriptModule(candidate, cache);
      } catch {}
    }
    throw new Error(`Could not resolve ${specifier} from ${absolute}`);
  };
  new Function(
    "exports",
    "require",
    "module",
    "__filename",
    "__dirname",
    compiled,
  )(module.exports, localRequire, module, absolute, dirname(absolute));
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
  return { platform, legacy, browser, calls };
}

function makeTrack(id, overrides = {}) {
  const urn = `soundcloud:tracks:${id}`;
  const userUrn = `soundcloud:users:${Number(id) + 10_000}`;
  const base = {
    id: urn,
    urn,
    title: `Track ${id}`,
    duration: 183_000,
    user: {
      id: userUrn,
      urn: userUrn,
      username: `Artist ${id}`,
      avatar_url: `https://i1.sndcdn.com/avatars-${id}-t500x500.jpg`,
      profile_header_url: `https://i1.sndcdn.com/visuals-${id}-original.jpg`,
      permalink_url: `https://soundcloud.com/artist-${id}`,
      description: "must not persist",
      followers_count: 12,
      verified: true,
    },
    artwork_url: `https://i1.sndcdn.com/artworks-${id}-t500x500.jpg`,
    permalink_url: `https://soundcloud.com/artist-${id}/track-${id}`,
    kind: "track",
    likes_count: 21,
    playback_count: 34,
    description: "must not persist",
    genre: "Electronic",
    access: "playable",
    policy: "ALLOW",
    streamable: true,
    has_transcodings: true,
    full_playable: true,
    sharing: "public",
    user_favorite: false,
  };
  return {
    ...base,
    ...overrides,
    user: { ...base.user, ...(overrides.user ?? {}) },
  };
}

function makeEntry(id, context = { label: "Home", target: { kind: "main", tab: "home" } }) {
  return { track: makeTrack(id), context };
}

function rawStored(environment, key) {
  return (
    environment.platform.get(key) ??
    environment.legacy.get(key) ??
    environment.browser.get(key) ??
    null
  );
}

test("resume state round-trips in one authoritative preferred storage copy", () => {
  const environment = installStorage();
  const resume = loadFreshService();
  const key = resume.PLAYBACK_RESUME_STORAGE_KEY;
  environment.legacy.set(key, "stale");
  environment.browser.set(key, "stale");

  assert.equal(
    resume.savePlaybackResumeState(
      {
        ownerUrn: "42",
        positionSeconds: 42.125,
        queue: [makeEntry(1), makeEntry(2), makeEntry(3)],
        queueIndex: 1,
      },
      1_700_000_000_000,
    ),
    true,
  );
  assert.equal(typeof environment.platform.get(key), "string");
  assert.equal(environment.legacy.has(key), false);
  assert.equal(environment.browser.has(key), false);

  const state = resume.loadPlaybackResumeState(
    "soundcloud:users:42",
    1_700_000_001_000,
  );
  assert.equal(state.version, 1);
  assert.equal(state.ownerUrn, "soundcloud:users:42");
  assert.equal(state.positionMs, 42_125);
  assert.equal(state.queueIndex, 1);
  assert.deepEqual(
    state.queue.map((entry) => entry.track.urn),
    ["soundcloud:tracks:1", "soundcloud:tracks:2", "soundcloud:tracks:3"],
  );
  assert.equal(state.queue[1].track.description, null);
});

test("stored projection omits credentials, raw API fields, descriptions, and search queries", () => {
  const environment = installStorage();
  const resume = loadFreshService();
  const secret = "2-321779-SECRET-OAUTH";
  const entry = {
    track: makeTrack(11, {
      description: secret,
      track_authorization: `auth-${secret}`,
      media: { transcodings: [{ url: `https://api-v2.soundcloud.com/media?client_id=${secret}` }] },
      secret_token: secret,
      client_id: secret,
      user: { description: secret, accessToken: secret },
    }),
    context: {
      label: `Search: ${secret}`,
      target: {
        kind: "main",
        tab: "search",
        query: `https://soundcloud.com/private?secret_token=${secret}`,
        searchDraft: `client_id=${secret}`,
        searchTab: "tracks",
      },
    },
  };

  assert.equal(
    resume.savePlaybackResumeState(
      { ownerUrn: "9", positionMs: 1_000, queue: [entry], queueIndex: 0 },
      10_000,
    ),
    true,
  );
  const raw = rawStored(environment, resume.PLAYBACK_RESUME_STORAGE_KEY);
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes("track_authorization"), false);
  assert.equal(raw.includes('"media"'), false);
  assert.equal(raw.includes("secret_token"), false);
  assert.equal(raw.includes("client_id"), false);
  assert.equal(raw.includes("must not persist"), false);
  const target = JSON.parse(raw).queue[0].context.target;
  assert.deepEqual(target, { kind: "main", tab: "search", searchTab: "tracks" });
  assert.equal(JSON.parse(raw).queue[0].context.label, "SoundCloud Search");
});

test("malicious and signed URLs are replaced with safe non-secret fallbacks", () => {
  installStorage();
  const resume = loadFreshService();
  const entry = makeEntry(15);
  entry.track = makeTrack(15, {
    artwork_url: "https://evil.example/art.jpg",
    permalink_url: "https://soundcloud.com/artist/track/s-AbCdEf123",
    sharing: undefined,
    user: {
      avatar_url: "javascript:alert(1)",
      profile_header_url: "https://i1.sndcdn.com/header.jpg?signature=secret",
      permalink_url: "https://evil.example/artist",
    },
  });

  assert.equal(
    resume.savePlaybackResumeState(
      { ownerUrn: "9", positionMs: 0, queue: [entry], queueIndex: 0 },
      20_000,
    ),
    true,
  );
  const state = resume.loadPlaybackResumeState("9", 20_001);
  assert.equal(state.queue[0].track.artwork_url, null);
  assert.equal(state.queue[0].track.user.avatar_url, "");
  assert.equal(state.queue[0].track.user.profile_header_url, null);
  assert.equal(state.queue[0].track.user.permalink_url, "https://soundcloud.com/");
  assert.equal(state.queue[0].track.permalink_url, "https://soundcloud.com/");
});

test("queue storage is cropped around and retains the current effective entry", () => {
  installStorage();
  const resume = loadFreshService();
  const queue = Array.from({ length: 250 }, (_, index) => makeEntry(index + 1));
  assert.equal(
    resume.savePlaybackResumeState(
      { ownerUrn: "77", positionMs: 9_000, queue, queueIndex: 200 },
      30_000,
    ),
    true,
  );
  const state = resume.loadPlaybackResumeState("77", 30_001);
  assert.equal(state.queue.length, resume.MAX_PLAYBACK_RESUME_QUEUE_ENTRIES);
  assert.equal(state.queueIndex, 50);
  assert.equal(state.queue[0].track.urn, "soundcloud:tracks:151");
  assert.equal(state.queue[state.queueIndex].track.urn, "soundcloud:tracks:201");
  assert.equal(state.queue.at(-1).track.urn, "soundcloud:tracks:250");
});

test("storage writes fall back in priority order and clean all other copies", () => {
  const environment = installStorage({ platformSetFails: true });
  const resume = loadFreshService();
  const key = resume.PLAYBACK_RESUME_STORAGE_KEY;
  environment.platform.set(key, "old platform");
  environment.browser.set(key, "old browser");
  assert.equal(
    resume.savePlaybackResumeState(
      { ownerUrn: "5", positionMs: 5_000, queue: [makeEntry(5)], queueIndex: 0 },
      40_000,
    ),
    true,
  );
  assert.equal(environment.platform.has(key), false);
  assert.equal(typeof environment.legacy.get(key), "string");
  assert.equal(environment.browser.has(key), false);
  assert.ok(environment.calls.platformSet >= 1);
  assert.ok(environment.calls.legacySet >= 1);

  const browserEnvironment = installStorage({
    platformSetFails: true,
    legacySetFails: true,
  });
  const browserResume = loadFreshService();
  assert.equal(
    browserResume.savePlaybackResumeState(
      { ownerUrn: "6", positionMs: 6_000, queue: [makeEntry(6)], queueIndex: 0 },
      41_000,
    ),
    true,
  );
  assert.equal(
    typeof browserEnvironment.browser.get(browserResume.PLAYBACK_RESUME_STORAGE_KEY),
    "string",
  );
});

test("the highest readable copy is authoritative and corruption cannot fall through", () => {
  const environment = installStorage();
  const resume = loadFreshService();
  const key = resume.PLAYBACK_RESUME_STORAGE_KEY;
  assert.equal(
    resume.savePlaybackResumeState(
      { ownerUrn: "8", positionMs: 0, queue: [makeEntry(8)], queueIndex: 0 },
      50_000,
    ),
    true,
  );
  const valid = environment.platform.get(key);
  environment.platform.set(key, "{broken");
  environment.legacy.set(key, valid);
  assert.equal(resume.loadPlaybackResumeState("8", 50_001), null);
  assert.equal(environment.platform.has(key), false);
  assert.equal(environment.legacy.has(key), false);
  assert.equal(environment.browser.has(key), false);
});

test("malformed, oversized, stale, future, and owner-mismatched states are cleared", async (t) => {
  const cases = [
    ["malformed JSON", () => "{"],
    ["wrong schema version", (raw) => JSON.stringify({ ...JSON.parse(raw), version: 2 })],
    ["oversized raw data", () => `{"padding":"${"x".repeat(270_000)}"}`],
    ["stale timestamp", (raw) => JSON.stringify({ ...JSON.parse(raw), savedAt: 0 })],
    ["future timestamp", (raw) => JSON.stringify({ ...JSON.parse(raw), savedAt: 700_001 })],
    ["owner mismatch", (raw) => JSON.stringify({ ...JSON.parse(raw), ownerUrn: "soundcloud:users:999" })],
  ];

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const environment = installStorage();
      const resume = loadFreshService();
      const key = resume.PLAYBACK_RESUME_STORAGE_KEY;
      assert.equal(
        resume.savePlaybackResumeState(
          { ownerUrn: "12", positionMs: 0, queue: [makeEntry(12)], queueIndex: 0 },
          100_000,
        ),
        true,
      );
      const raw = environment.platform.get(key);
      const now = name === "stale timestamp" ? 90 * 24 * 60 * 60 * 1_000 + 1 : 100_000;
      environment.platform.set(key, mutate(raw));
      environment.legacy.set(key, raw);
      assert.equal(resume.loadPlaybackResumeState("12", now), null);
      assert.equal(environment.platform.has(key), false);
      assert.equal(environment.legacy.has(key), false);
      assert.equal(environment.browser.has(key), false);
    });
  }
});

test("clear removes every backend copy", () => {
  const environment = installStorage();
  const resume = loadFreshService();
  const key = resume.PLAYBACK_RESUME_STORAGE_KEY;
  environment.platform.set(key, "a");
  environment.legacy.set(key, "b");
  environment.browser.set(key, "c");
  resume.clearPlaybackResumeState();
  assert.equal(environment.platform.has(key), false);
  assert.equal(environment.legacy.has(key), false);
  assert.equal(environment.browser.has(key), false);
});

test("position conversion clamps invalid offsets and restarts tracks near their end", () => {
  installStorage();
  const resume = loadFreshService();
  assert.equal(resume.resumePositionSeconds(10_250, 100_000), 10.25);
  assert.equal(resume.resumePositionSeconds(-10, 100_000), 0);
  assert.equal(resume.resumePositionSeconds(Number.NaN, 100_000), 0);
  assert.equal(resume.resumePositionSeconds(96_999, 100_000), 96.999);
  assert.equal(resume.resumePositionSeconds(97_000, 100_000), 0);
  assert.equal(resume.resumePositionSeconds(150_000, 100_000), 0);
  assert.equal(resume.resumePositionSeconds(12_345, 0), 12.345);

  assert.equal(
    resume.savePlaybackResumeState(
      {
        ownerUrn: "22",
        positionMs: 181_000,
        queue: [makeEntry(22)],
        queueIndex: 0,
      },
      200_000,
    ),
    true,
  );
  assert.equal(resume.loadPlaybackResumeState("22", 200_001).positionMs, 0);
});

test("canonical owner helper and invalid current entries fail closed", () => {
  const environment = installStorage();
  const resume = loadFreshService();
  assert.equal(resume.canonicalPlaybackResumeOwnerUrn(" 123 "), "soundcloud:users:123");
  assert.equal(
    resume.canonicalPlaybackResumeOwnerUrn("soundcloud:users:123"),
    "soundcloud:users:123",
  );
  assert.equal(resume.canonicalPlaybackResumeOwnerUrn("soundcloud:tracks:123"), null);
  assert.equal(resume.canonicalPlaybackResumeOwnerUrn("abc"), null);

  const broken = makeEntry(1);
  delete broken.track.user.username;
  assert.equal(
    resume.savePlaybackResumeState(
      { ownerUrn: "1", positionMs: 0, queue: [broken], queueIndex: 0 },
      1,
    ),
    false,
  );
  assert.equal(rawStored(environment, resume.PLAYBACK_RESUME_STORAGE_KEY), null);
});
