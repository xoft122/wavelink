import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";

import ts from "typescript";

const require = createRequire(import.meta.url);

const credentials = {
  accessToken: "oauth-playlist-source-test-token",
  webClientId: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",
};

function rawUser(id) {
  return {
    id,
    username: `Artist ${id}`,
    permalink_url: `https://soundcloud.com/artist-${id}`,
    avatar_url: `https://i1.sndcdn.com/avatars-${id}.jpg`,
  };
}

function rawTrack(id) {
  return {
    id,
    kind: "track",
    title: `Track ${id}`,
    duration: 180_000,
    user: rawUser(id + 1_000),
    permalink_url: `https://soundcloud.com/artist-${id + 1_000}/track-${id}`,
    artwork_url: `https://i1.sndcdn.com/artworks-${id}.jpg`,
  };
}

function jsonResponse(body) {
  return {
    status: 200,
    text: async () => JSON.stringify(body),
  };
}

function clearSourceModuleCache() {
  for (const filename of Object.keys(require.cache)) {
    if (/[\\/]src[\\/]/.test(filename)) delete require.cache[filename];
  }
}

test("playlist source bulk-loads only the requested pages and preserves repeats", async () => {
  const previousTsLoader = require.extensions[".ts"];
  const previousSpicetify = globalThis.Spicetify;
  const previousWindow = globalThis.window;
  const storage = new Map([
    ["wavelink:settings", JSON.stringify(credentials)],
  ]);
  const requests = [];

  try {
    require.extensions[".ts"] = (module, filename) => {
      const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2020,
          esModuleInterop: true,
        },
        fileName: filename,
      }).outputText;
      module._compile(compiled, filename);
    };
    globalThis.Spicetify = {
      LocalStorage: {
        get: (key) => storage.get(key) ?? null,
        set: (key, value) => storage.set(key, value),
        remove: (key) => storage.delete(key),
      },
    };
    globalThis.window = {
      setTimeout,
      clearTimeout,
      fetch: async (proxiedUrl, options) => {
        const prefix = "https://cors-proxy.spicetify.app/";
        assert.equal(String(proxiedUrl).startsWith(prefix), true);
        const url = new URL(String(proxiedUrl).slice(prefix.length));
        requests.push({ url, options });

        if (url.pathname === "/playlists/9") {
          const ids = [
            1,
            2,
            1,
            ...Array.from({ length: 57 }, (_, index) => index + 3),
          ];
          return jsonResponse({
            id: 9,
            kind: "playlist",
            title: "Lazy playlist",
            track_count: ids.length,
            tracks: ids.map((id) => ({ id, kind: "track" })),
            duration: ids.length * 180_000,
            user: rawUser(7),
            permalink_url:
              "https://soundcloud.com/artist-7/sets/lazy-playlist",
          });
        }
        if (url.pathname === "/tracks") {
          const ids = (url.searchParams.get("ids") ?? "")
            .split(",")
            .filter(Boolean)
            .map(Number);
          return jsonResponse({
            // Deliberately reverse the bulk response: playlist order and
            // repeated occurrences must come from the original references.
            collection: ids.reverse().map(rawTrack),
          });
        }
        throw new Error(`Unexpected SoundCloud request: ${url}`);
      },
    };

    clearSourceModuleCache();
    const api = require("../src/services/api.ts");
    const result = await api.getPlaylistTrackSource(
      "soundcloud:playlists:9",
      50,
    );
    const initial = result.source.getSnapshot();

    assert.equal(
      requests.filter(({ url }) => url.pathname === "/playlists/9").length,
      1,
    );
    assert.equal(
      requests.filter(({ url }) => url.pathname === "/tracks").length,
      1,
    );
    assert.equal(initial.tracks.length, 50);
    assert.equal(initial.totalCount, 60);
    assert.equal(initial.pageSize, 50);
    assert.ok(initial.nextHref);
    assert.deepEqual(
      initial.tracks.slice(0, 3).map((track) => track.urn),
      [
        "soundcloud:tracks:1",
        "soundcloud:tracks:2",
        "soundcloud:tracks:1",
      ],
    );

    const complete = await result.source.loadNext();
    assert.equal(
      requests.filter(({ url }) => url.pathname === "/playlists/9").length,
      1,
    );
    assert.equal(
      requests.filter(({ url }) => url.pathname === "/tracks").length,
      2,
    );
    assert.equal(complete.tracks.length, 60);
    assert.equal(complete.totalCount, 60);
    assert.equal(complete.nextHref, null);
    assert.equal(complete.tracks.at(-1).urn, "soundcloud:tracks:59");
  } finally {
    clearSourceModuleCache();
    if (previousTsLoader) require.extensions[".ts"] = previousTsLoader;
    else delete require.extensions[".ts"];
    if (previousSpicetify === undefined) delete globalThis.Spicetify;
    else globalThis.Spicetify = previousSpicetify;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
