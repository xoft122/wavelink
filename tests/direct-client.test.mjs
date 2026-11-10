import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/directSoundcloud.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const direct = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function installTransport(sendImpl) {
  const requests = [];
  globalThis.window = {
    setTimeout,
    clearTimeout,
    atob: (value) => Buffer.from(value, "base64").toString("binary"),
    fetch: async (url, options) => {
      const request = { url: String(url), ...options };
      requests.push(request);
      const result = await sendImpl(request);
      return {
        status: result.status ?? 200,
        text: async () => {
          if (result.body === undefined || result.body === null) return "";
          return typeof result.body === "string"
            ? result.body
            : JSON.stringify(result.body);
        },
      };
    },
  };
  return requests;
}

function targetUrl(request) {
  const prefix = `${direct.SPICETIFY_CORS_PROXY_ORIGIN}/`;
  assert.equal(request.url.startsWith(prefix), true);
  return new URL(request.url.slice(prefix.length));
}

const credentials = {
  accessToken: "oauth-test-token-value",
  webClientId: "A1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6",
};

function playbackAuthorization(payload) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

function rawFeedUser(id) {
  return {
    id,
    urn: `soundcloud:users:${id}`,
    username: `Artist ${id}`,
    permalink_url: `https://soundcloud.com/artist-${id}`,
    avatar_url: `https://i1.sndcdn.com/avatars-${id}.jpg`,
  };
}

function rawFeedTrack(id, title = `Track ${id}`) {
  return {
    id,
    urn: `soundcloud:tracks:${id}`,
    kind: "track",
    title,
    duration: 180_000,
    user: rawFeedUser(id + 1_000),
    artwork_url: `https://i1.sndcdn.com/artworks-${id}.jpg`,
    permalink_url: `https://soundcloud.com/artist-${id + 1_000}/track-${id}`,
  };
}

test("feed normalization keeps the newest occurrence of each canonical entity", () => {
  const newestTrack = rawFeedTrack(71, "Fresh metadata");
  const repeatedTrack = {
    ...rawFeedTrack(71, "Stale duplicate"),
    id: "soundcloud:tracks:71",
  };
  const playlist = {
    id: 71,
    urn: "soundcloud:playlists:71",
    kind: "playlist",
    title: "Fresh playlist",
    user: rawFeedUser(2_071),
    tracks: [],
    track_count: 0,
    duration: 0,
    permalink_url: "https://soundcloud.com/artist-2071/sets/fresh-playlist",
  };
  const distinctTrackWithSameDisplayText = {
    ...rawFeedTrack(72, "Fresh metadata"),
    user: newestTrack.user,
  };

  const page = direct.normalizeFeedCollection({
    next_href: "https://api-v2.soundcloud.com/stream?cursor=opaque-next-page",
    collection: [
      {
        type: "track",
        uuid: "newest-track-activity",
        created_at: "2026-07-18T12:00:00Z",
        origin: newestTrack,
      },
      {
        type: "track:repost",
        uuid: "duplicate-track-activity",
        created_at: "2026-07-18T11:59:59Z",
        origin: repeatedTrack,
      },
      {
        type: "track",
        uuid: "different-track-activity",
        created_at: "2026-07-18T11:59:58Z",
        origin: distinctTrackWithSameDisplayText,
      },
      {
        type: "playlist",
        uuid: "newest-playlist-activity",
        created_at: "2026-07-18T11:59:57Z",
        origin: playlist,
      },
      {
        type: "playlist:repost",
        uuid: "duplicate-playlist-activity",
        created_at: "2026-07-18T11:59:56Z",
        origin: { ...playlist, title: "Stale playlist duplicate" },
      },
    ],
  });

  assert.deepEqual(
    page.collection.map((item) => item.track?.urn ?? item.playlist?.urn),
    [
      "soundcloud:tracks:71",
      "soundcloud:tracks:72",
      "soundcloud:playlists:71",
    ],
  );
  assert.equal(page.collection[0].track.title, "Fresh metadata");
  assert.equal(page.collection[2].playlist.title, "Fresh playlist");
  assert.equal(
    page.next_href,
    "https://api-v2.soundcloud.com/stream?cursor=opaque-next-page",
  );
});

test("track normalization preserves safe availability tri-state without exposing media", () => {
  const blocked = direct.normalizeTrack({
    ...rawFeedTrack(81),
    access: "blocked",
    policy: "BLOCK",
    streamable: false,
    media: { transcodings: [] },
    track_authorization: "private-playback-authorization",
  });
  assert.equal(blocked.access, "blocked");
  assert.equal(blocked.policy, "BLOCK");
  assert.equal(blocked.streamable, false);
  assert.equal(blocked.has_transcodings, false);
  assert.equal(blocked.full_playable, false);
  assert.equal(blocked.preview_playable, false);
  assert.equal("media" in blocked, false);
  assert.equal("track_authorization" in blocked, false);

  const playable = direct.normalizeTrack({
    ...rawFeedTrack(82),
    access: "playable",
    policy: "ALLOW",
    streamable: true,
    media: {
      transcodings: [{
        url: "https://api-v2.soundcloud.com/private-signed-path",
      }],
    },
  });
  assert.equal(playable.policy, "ALLOW");
  assert.equal(playable.streamable, true);
  assert.equal(playable.has_transcodings, true);
  assert.equal(playable.full_playable, true);
  assert.equal("media" in playable, false);

  const authorization = playbackAuthorization({ geo: "UA", ignored: "secret" });
  const snippet = direct.normalizeTrack({
    ...rawFeedTrack(85),
    duration: 30_000,
    full_duration: 134_034,
    access: "preview",
    policy: "SNIP",
    streamable: false,
    media: {
      transcodings: [
        {
          url: "https://api-v2.soundcloud.com/private-preview-hls",
          duration: 30_000,
          snipped: true,
        },
        {
          url: "https://api-v2.soundcloud.com/private-preview-progressive",
          duration: 30_000,
          snipped: true,
        },
      ],
    },
    track_authorization: authorization,
  });
  assert.equal(snippet.duration, 30_000);
  assert.equal(snippet.full_duration, 134_034);
  assert.equal(snippet.has_snipped_transcoding, true);
  assert.equal(snippet.has_full_transcoding, false);
  assert.equal(snippet.full_playable, false);
  assert.equal(snippet.preview_playable, true);
  assert.equal(snippet.authorization_geo, "UA");
  assert.equal(JSON.stringify(snippet).includes(authorization), false);
  assert.equal(JSON.stringify(snippet).includes("private-preview"), false);

  const thin = direct.normalizeTrack(rawFeedTrack(83));
  assert.equal(thin.policy, undefined);
  assert.equal(thin.streamable, undefined);
  assert.equal(thin.has_transcodings, undefined);
  assert.equal(
    direct.normalizeTrack({
      ...rawFeedTrack(84),
      media: { transcodings: "not-an-array" },
    }).has_transcodings,
    undefined,
  );
  assert.equal(
    direct.normalizeTrack({
      ...rawFeedTrack(86),
      track_authorization: "not-a-jwt",
    }).authorization_geo,
    undefined,
  );
});

test("playlist normalization preserves unknown Like state and liked collections mark membership", () => {
  const rawPlaylist = {
    id: 91,
    urn: "soundcloud:playlists:91",
    kind: "playlist",
    title: "Playlist 91",
    user: rawFeedUser(1_091),
    tracks: [],
    track_count: 0,
    duration: 0,
  };

  assert.equal(direct.normalizePlaylist(rawPlaylist).user_favorite, undefined);
  assert.equal(
    direct.normalizePlaylist({ ...rawPlaylist, user_favorite: false }).user_favorite,
    false,
  );
  assert.equal(
    direct.normalizePlaylist({ ...rawPlaylist, user_favorite: true }).user_favorite,
    true,
  );

  const page = direct.normalizeLikedPlaylistCollection({
    collection: [rawPlaylist, { playlist: { ...rawPlaylist, id: 92, urn: "soundcloud:playlists:92" } }],
    next_href: "https://api-v2.soundcloud.com/users/1/playlist_likes?cursor=next",
  });
  assert.deepEqual(
    page.collection.map((playlist) => playlist.user_favorite),
    [true, true],
  );
  assert.match(page.next_href, /cursor=next/);
});

test("Spotify-only transport omits Spotify credentials and injects only SoundCloud OAuth", async () => {
  const requests = installTransport(async () => ({
    status: 200,
    body: { ok: true },
  }));
  direct.configureDirectSoundCloud(() => credentials);

  const result = await direct.directSoundCloudRequest("/me", {
    query: { linked_partitioning: true },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(requests.length, 1);
  const request = requests[0];
  const target = targetUrl(request);
  assert.equal(target.origin + target.pathname, "https://api-v2.soundcloud.com/me");
  assert.equal(request.method, "GET");
  assert.deepEqual(Object.fromEntries(target.searchParams), {
    linked_partitioning: "true",
    client_id: credentials.webClientId,
  });
  assert.deepEqual(request.headers, {
    Accept: "application/json; charset=utf-8",
    Authorization: `OAuth ${credentials.accessToken}`,
  });
  assert.equal(Object.values(request.headers).some((value) => /Bearer|Spotify/i.test(value)), false);
  assert.equal(request.credentials, "omit");
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.equal(request.cache, "no-store");
});

test("play-history mutation sends the captured authenticated JSON contract", async () => {
  const requests = installTransport(async () => ({
    status: 204,
    body: null,
  }));
  direct.configureDirectSoundCloud(() => credentials);

  const result = await direct.directSoundCloudRequest("/me/play-history", {
    method: "POST",
    body: { track_urn: "soundcloud:tracks:1730921286" },
  });
  assert.equal(result, null);
  assert.equal(requests.length, 1);

  const request = requests[0];
  const target = targetUrl(request);
  assert.equal(
    target.origin + target.pathname,
    "https://api-v2.soundcloud.com/me/play-history",
  );
  assert.deepEqual(Object.fromEntries(target.searchParams), {
    client_id: credentials.webClientId,
  });
  assert.equal(request.method, "POST");
  assert.deepEqual(request.headers, {
    Accept: "application/json; charset=utf-8",
    Authorization: `OAuth ${credentials.accessToken}`,
    "Content-Type": "application/json;charset=UTF-8",
  });
  assert.equal(
    request.body,
    JSON.stringify({ track_urn: "soundcloud:tracks:1730921286" }),
  );
  assert.equal(request.credentials, "omit");
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.equal(request.cache, "no-store");
});

test("direct transport rejects arbitrary hosts and limits the legacy host to repost mutations", async () => {
  const requests = installTransport(async () => ({ status: 200, body: {} }));
  direct.configureDirectSoundCloud(() => credentials);

  await assert.rejects(
    direct.directSoundCloudRequest("https://example.com/me"),
    (error) => error.code === "blocked_api_url",
  );
  await assert.rejects(
    direct.directSoundCloudRequest("https://api.soundcloud.com/me"),
    (error) => error.code === "blocked_api_url",
  );
  await direct.directSoundCloudRequest(
    "https://api.soundcloud.com/e1/me/track_reposts/123",
    { method: "PUT" },
  );
  assert.equal(requests.length, 1);
});

test("401 invokes the credential cleanup hook without reflecting credentials", async () => {
  installTransport(async () => {
    throw { status: 401 };
  });
  let rejected = null;
  direct.configureDirectSoundCloud(
    () => credentials,
    (value) => { rejected = value; },
  );

  await assert.rejects(
    direct.directSoundCloudRequest("/me"),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.message.includes(credentials.accessToken), false);
      assert.equal(error.message.includes(credentials.webClientId), false);
      return true;
    },
  );
  assert.deepEqual(rejected, credentials);
});

test("media resolution prefers a validated progressive SoundCloud CDN URL", async () => {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/123")) {
      return {
        status: 200,
        body: {
          id: 123,
          urn: "soundcloud:tracks:123",
          access: "playable",
          streamable: true,
          media: {
            transcodings: [{
              url: "https://api-v2.soundcloud.com/media/soundcloud:tracks:123/abcDEF12/stream/progressive",
              preset: "mp3_0_1",
              format: { protocol: "progressive", mime_type: "audio/mpeg" },
            }],
          },
        },
      };
    }
    if (url.pathname.includes("/media/soundcloud:tracks:123/")) {
      return {
        status: 200,
        body: { url: `https://cf-media.sndcdn.com/test.mp3?Expires=${expires}` },
      };
    }
    throw new Error(`Unexpected URL: ${url.origin}${url.pathname}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  const source = await direct.resolveDirectMediaSource("soundcloud:tracks:123");
  assert.equal(source.kind, "progressive");
  assert.equal(source.codec, "mp3");
  assert.equal(source.access, "playable");
  assert.match(source.url, /^https:\/\/cf-media\.sndcdn\.com\/test\.mp3/);
  assert.equal(requests.length, 2);
});

test("media resolution rejects only explicit access and policy blocks before transcoding requests", async () => {
  const signals = new Map([
    ["801", { access: "blocked", policy: "ALLOW", streamable: true }],
    ["802", { access: "playable", policy: "BLOCK", streamable: true }],
  ]);
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    const id = url.pathname.match(/\/tracks\/([0-9]+)$/)?.[1];
    const signal = id ? signals.get(id) : null;
    if (!id || !signal) throw new Error(`Unexpected URL: ${url}`);
    return {
      status: 200,
      body: {
        id: Number(id),
        urn: `soundcloud:tracks:${id}`,
        ...signal,
        media: {
          transcodings: [{
            url: `https://api-v2.soundcloud.com/media/soundcloud:tracks:${id}/abcdefgh/stream/progressive`,
            preset: "mp3_0_1",
            format: { protocol: "progressive", mime_type: "audio/mpeg" },
          }],
        },
      },
    };
  });
  direct.configureDirectSoundCloud(() => credentials);

  for (const id of signals.keys()) {
    await assert.rejects(
      direct.resolveDirectMediaSource(`soundcloud:tracks:${id}`),
      (error) => error.code === "track_blocked" && error.status === 403,
    );
  }
  assert.equal(
    requests.length,
    signals.size,
    "blocked tracks must stop after their metadata request",
  );
});

test("SNIP playback is a preview unless the consumer product is explicitly unavailable", async () => {
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const authorization = playbackAuthorization({ geo: "UA" });
  const installSnippetTransport = () =>
    installTransport(async (request) => {
      const url = targetUrl(request);
      if (url.pathname.endsWith("/tracks/803")) {
        return {
          status: 200,
          body: {
            id: 803,
            urn: "soundcloud:tracks:803",
            access: "preview",
            policy: "SNIP",
            streamable: false,
            duration: 30_000,
            full_duration: 134_034,
            track_authorization: authorization,
            media: {
              transcodings: [{
                url: "https://api-v2.soundcloud.com/media/soundcloud:tracks:803/preview12/stream/progressive",
                preset: "mp3_0_1",
                duration: 30_000,
                snipped: true,
                format: {
                  protocol: "progressive",
                  mime_type: "audio/mpeg",
                },
              }],
            },
          },
        };
      }
      if (url.pathname.includes("/media/soundcloud:tracks:803/")) {
        return {
          status: 200,
          body: {
            url: `https://cf-media.sndcdn.com/preview.mp3?Expires=${expires}`,
          },
        };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

  let requests = installSnippetTransport();
  direct.configureDirectSoundCloud(() => credentials);
  const preview = await direct.resolveDirectMediaSource(
    "soundcloud:tracks:803",
  );
  assert.equal(preview.access, "preview");
  assert.equal(preview.kind, "progressive");
  assert.equal(requests.length, 2);

  requests = installSnippetTransport();
  direct.configureDirectSoundCloud(() => credentials);
  await assert.rejects(
    direct.resolveDirectMediaSource("soundcloud:tracks:803", {
      consumerProductAvailable: false,
    }),
    (error) =>
      error.code === "track_region_blocked" &&
      error.status === 403 &&
      error.countryCode === "UA",
  );
  assert.equal(
    requests.length,
    1,
    "product-unavailable SNIP must stop before resolving a preview URL",
  );
});

test("HLS accepts the exact SoundCloud streaming host and resolves HQ AAC before SQ AAC", async () => {
  const highPath = "/media/soundcloud:tracks:456/highAAC123/stream/hls";
  const lowPath = "/media/soundcloud:tracks:456/lowAAC1234/stream/hls";
  const highUrl =
    "https://playback.media-streaming.soundcloud.cloud/4f5e/high/playlist.m3u8";
  const lowUrl = "https://cf-media.sndcdn.com/4f5e/low/playlist.m3u8";
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/456")) {
      return {
        status: 200,
        body: {
          id: 456,
          urn: "soundcloud:tracks:456",
          access: "playable",
          streamable: true,
          media: {
            // Deliberately put SQ first and use the same current preset for
            // both: the `quality` field must distinguish 96 from 160.
            transcodings: [
              {
                url: `https://api-v2.soundcloud.com${lowPath}`,
                preset: "aac_0_1",
                quality: "sq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
              {
                url: `https://api-v2.soundcloud.com${highPath}`,
                preset: "aac_0_1",
                quality: "hq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
            ],
          },
        },
      };
    }
    if (url.pathname.endsWith(highPath)) {
      return { status: 200, body: { url: highUrl } };
    }
    if (url.pathname.endsWith(lowPath)) {
      return { status: 200, body: { url: lowUrl } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  const source = await direct.resolveDirectMediaSource("soundcloud:tracks:456");
  assert.equal(source.kind, "hls");
  assert.equal(source.codec, "aac");
  assert.equal(source.url, highUrl);
  assert.deepEqual(
    requests.slice(1).map((request) => targetUrl(request).pathname),
    [highPath],
    "a valid HQ AAC stream makes the lower-quality resolver unnecessary",
  );
});

test("current aac_160k preset outranks aac_96k even when SoundCloud labels it SQ", async () => {
  const lowPath = "/media/soundcloud:tracks:457/aac96Path/stream/hls";
  const highPath = "/media/soundcloud:tracks:457/aac160Path/stream/hls";
  const lowUrl =
    "https://playback.media-streaming.soundcloud.cloud/current-aac/96.m3u8";
  const highUrl =
    "https://playback.media-streaming.soundcloud.cloud/current-aac/160.m3u8";
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/457")) {
      return {
        status: 200,
        body: {
          id: 457,
          urn: "soundcloud:tracks:457",
          access: "playable",
          streamable: true,
          media: {
            // This is the current API ordering and metadata: `quality` no
            // longer distinguishes the bitrates, while the preset does.
            transcodings: [
              {
                url: `https://api-v2.soundcloud.com${lowPath}`,
                preset: "aac_96k",
                quality: "lq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
              {
                url: `https://api-v2.soundcloud.com${highPath}`,
                preset: "aac_160k",
                quality: "sq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
            ],
          },
        },
      };
    }
    if (url.pathname.endsWith(lowPath)) {
      return { status: 200, body: { url: lowUrl } };
    }
    if (url.pathname.endsWith(highPath)) {
      return { status: 200, body: { url: highUrl } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  const source = await direct.resolveDirectMediaSource("soundcloud:tracks:457");
  assert.equal(source.kind, "hls");
  assert.equal(source.codec, "aac");
  assert.equal(source.url, highUrl);
  assert.deepEqual(
    requests.slice(1).map((request) => targetUrl(request).pathname),
    [highPath],
    "aac_160k must be resolved first despite its generic SQ quality label",
  );
});

test("software AAC selects 96 before playback, while native AAC keeps 160", async () => {
  const id = 2126209917;
  const highPath = `/media/soundcloud:tracks:${id}/highStream16/stream/hls`;
  const lowPath = `/media/soundcloud:tracks:${id}/lowStream096/stream/hls`;
  const highUrl = "https://playback.media-streaming.soundcloud.cloud/test-160.m3u8";
  const lowUrl = "https://playback.media-streaming.soundcloud.cloud/test-96.m3u8";
  const requests = installTransport(async request => {
    const url = targetUrl(request);
    assert.equal(url.searchParams.has("preferStandardAac"), false);
    assert.equal(url.searchParams.has("excludeAacRendition"), false);
    if (url.pathname === `/tracks/${id}`) return { body: {
      ...rawFeedTrack(id), access: "playable", policy: "ALLOW", streamable: true,
      media: { transcodings: [
        { preset: "aac_160k", quality: "sq", snipped: false, url: `https://api-v2.soundcloud.com${highPath}`, format: { protocol: "hls", mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
        { preset: "aac_96k", quality: "lq", snipped: false, url: `https://api-v2.soundcloud.com${lowPath}`, format: { protocol: "hls", mime_type: 'audio/mp4; codecs="mp4a.40.2"' } },
      ] },
    } };
    if (url.pathname === highPath) return { body: { url: highUrl } };
    if (url.pathname === lowPath) return { body: { url: lowUrl } };
    throw new Error(`Unexpected URL: ${url.pathname}`);
  });
  direct.configureDirectSoundCloud(() => credentials);
  const urn = `soundcloud:tracks:${id}`;
  const native = await direct.resolveDirectMediaSource(urn);
  const software = await direct.resolveDirectMediaSource(urn, { preferStandardAac: true });
  const retryAfter96 = await direct.resolveDirectMediaSource(urn, { preferStandardAac: true, excludeAacRendition: 96 });
  const retryAfter160 = await direct.resolveDirectMediaSource(urn, { preferStandardAac: true, excludeAacRendition: 160 });
  assert.deepEqual([native.url, native.aacRendition], [highUrl, 160]);
  assert.deepEqual([software.url, software.aacRendition], [lowUrl, 96]);
  assert.deepEqual([retryAfter96.url, retryAfter96.aacRendition], [highUrl, 160]);
  assert.deepEqual([retryAfter160.url, retryAfter160.aacRendition], [lowUrl, 96]);
  assert.deepEqual(requests.filter(r => targetUrl(r).pathname.includes("/media/")).map(r => targetUrl(r).pathname), [highPath, lowPath, highPath, lowPath]);
});

test("HLS prefers AAC over MPEG for current Spotify embedded-player compatibility", async () => {
  const aacPath = "/media/soundcloud:tracks:654/aacStream9/stream/hls";
  const mp3Path = "/media/soundcloud:tracks:654/mp3Stream/stream/hls";
  const aacUrl = "https://playback.media-streaming.soundcloud.cloud/aac/playlist.m3u8";
  const mp3Url = "https://cf-hls-media.sndcdn.com/mp3/playlist.m3u8";
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/654")) {
      return {
        status: 200,
        body: {
          id: 654,
          urn: "soundcloud:tracks:654",
          access: "playable",
          streamable: true,
          media: {
            transcodings: [
              {
                url: `https://api-v2.soundcloud.com${aacPath}`,
                preset: "aac_0_1",
                quality: "hq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
              {
                url: `https://api-v2.soundcloud.com${mp3Path}`,
                preset: "mp3_0_1",
                quality: "sq",
                format: { protocol: "hls", mime_type: "audio/mpeg" },
              },
            ],
          },
        },
      };
    }
    if (url.pathname.endsWith(aacPath)) return { status: 200, body: { url: aacUrl } };
    if (url.pathname.endsWith(mp3Path)) return { status: 200, body: { url: mp3Url } };
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  const source = await direct.resolveDirectMediaSource("soundcloud:tracks:654");
  assert.equal(source.kind, "hls");
  assert.equal(source.codec, "aac");
  assert.equal(source.url, aacUrl);
  assert.deepEqual(
    requests.slice(1).map((request) => targetUrl(request).pathname),
    [aacPath],
    "the legacy MPEG fallback must not be resolved when AAC succeeds",
  );
});

test("HLS resolves Spotify-compatible AAC before an unusable MPEG fallback", async () => {
  const aacPath = "/media/soundcloud:tracks:655/aacStream9/stream/hls";
  const mp3Path = "/media/soundcloud:tracks:655/mp3Stream/stream/hls";
  const aacUrl =
    "https://playback.media-streaming.soundcloud.cloud/aac-first/playlist.m3u8";
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/655")) {
      return {
        status: 200,
        body: {
          id: 655,
          urn: "soundcloud:tracks:655",
          access: "playable",
          streamable: true,
          media: {
            transcodings: [
              {
                url: `https://api-v2.soundcloud.com${aacPath}`,
                preset: "aac_0_1",
                quality: "hq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
              {
                url: `https://api-v2.soundcloud.com${mp3Path}`,
                preset: "mp3_0_1",
                quality: "sq",
                format: { protocol: "hls", mime_type: "audio/mpeg" },
              },
            ],
          },
        },
      };
    }
    if (url.pathname.endsWith(aacPath)) {
      return { status: 200, body: { url: aacUrl } };
    }
    if (url.pathname.endsWith(mp3Path)) {
      // Spotify's current CEF can report bufferAddCodecError for this legacy
      // fallback. Its independent resolver failure must not invalidate an AAC
      // stream that was already resolved successfully.
      return { status: 500, body: { error: "MPEG unavailable" } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  const source = await direct.resolveDirectMediaSource("soundcloud:tracks:655");
  assert.equal(source.kind, "hls");
  assert.equal(source.codec, "aac");
  assert.equal(source.url, aacUrl);
  assert.deepEqual(
    requests.slice(1).map((request) => targetUrl(request).pathname),
    [aacPath],
    "an available AAC HLS stream should make the legacy MPEG request unnecessary",
  );
});

test("HLS retains an MPEG-only fallback when SoundCloud exposes no AAC", async () => {
  const mp3Path = "/media/soundcloud:tracks:656/mp3Stream/stream/hls";
  const mp3Url = "https://cf-hls-media.sndcdn.com/mp3-only/playlist.m3u8";
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/656")) {
      return {
        status: 200,
        body: {
          id: 656,
          urn: "soundcloud:tracks:656",
          access: "playable",
          streamable: true,
          media: {
            transcodings: [{
              url: `https://api-v2.soundcloud.com${mp3Path}`,
              preset: "mp3_0_1",
              quality: "sq",
              format: { protocol: "hls", mime_type: "audio/mpeg" },
            }],
          },
        },
      };
    }
    if (url.pathname.endsWith(mp3Path)) {
      return { status: 200, body: { url: mp3Url } };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  const source = await direct.resolveDirectMediaSource("soundcloud:tracks:656");
  assert.equal(source.kind, "hls");
  assert.equal(source.codec, "mp3");
  assert.equal(source.url, mp3Url);
  assert.deepEqual(
    requests.slice(1).map((request) => targetUrl(request).pathname),
    [mp3Path],
  );
});

test("SoundCloud abr_sq playlist metadata is not mistaken for MP3 when AAC160 is available", async () => {
  const abrPath = "/media/soundcloud:tracks:657/abrStream9/stream/hls";
  const aacPath = "/media/soundcloud:tracks:657/aacStream9/stream/hls";
  const aacUrl =
    "https://playback.media-streaming.soundcloud.cloud/abr-contract/aac-160.m3u8";
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/657")) {
      return {
        status: 200,
        body: {
          id: 657,
          urn: "soundcloud:tracks:657",
          access: "playable",
          streamable: true,
          media: {
            transcodings: [
              {
                url: `https://api-v2.soundcloud.com${abrPath}`,
                preset: "abr_sq",
                quality: "sq",
                format: { protocol: "hls", mime_type: "audio/mpegurl" },
              },
              {
                url: `https://api-v2.soundcloud.com${aacPath}`,
                preset: "aac_0_1",
                quality: "hq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
            ],
          },
        },
      };
    }
    if (url.pathname.endsWith(aacPath)) {
      return { status: 200, body: { url: aacUrl } };
    }
    if (url.pathname.endsWith(abrPath)) {
      throw new Error("abr_sq must not be resolved as an MP3 stream");
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  const source = await direct.resolveDirectMediaSource("soundcloud:tracks:657");
  assert.equal(source.kind, "hls");
  assert.equal(source.codec, "aac");
  assert.equal(source.url, aacUrl);
  assert.deepEqual(
    requests.slice(1).map((request) => targetUrl(request).pathname),
    [aacPath],
  );
});

test("AAC96 is tried after AAC160 fails while abr_sq remains ignored", async () => {
  const abrPath = "/media/soundcloud:tracks:658/abrStream9/stream/hls";
  const highPath = "/media/soundcloud:tracks:658/highAAC12/stream/hls";
  const lowPath = "/media/soundcloud:tracks:658/lowAAC123/stream/hls";
  const lowUrl =
    "https://playback.media-streaming.soundcloud.cloud/abr-contract/aac-96.m3u8";
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/658")) {
      return {
        status: 200,
        body: {
          id: 658,
          urn: "soundcloud:tracks:658",
          access: "playable",
          streamable: true,
          media: {
            transcodings: [
              {
                url: `https://api-v2.soundcloud.com${abrPath}`,
                preset: "abr_sq",
                quality: "sq",
                format: { protocol: "hls", mime_type: "audio/mpegurl" },
              },
              {
                url: `https://api-v2.soundcloud.com${lowPath}`,
                preset: "aac_0_1",
                quality: "sq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
              {
                url: `https://api-v2.soundcloud.com${highPath}`,
                preset: "aac_0_1",
                quality: "hq",
                format: { protocol: "hls", mime_type: "audio/mp4" },
              },
            ],
          },
        },
      };
    }
    if (url.pathname.endsWith(highPath)) {
      return { status: 404, body: { error: "HQ unavailable" } };
    }
    if (url.pathname.endsWith(lowPath)) {
      return { status: 200, body: { url: lowUrl } };
    }
    if (url.pathname.endsWith(abrPath)) {
      throw new Error("abr_sq must stay outside the codec fallback chain");
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  const source = await direct.resolveDirectMediaSource("soundcloud:tracks:658");
  assert.equal(source.kind, "hls");
  assert.equal(source.codec, "aac");
  assert.equal(source.url, lowUrl);
  assert.deepEqual(
    requests.slice(1).map((request) => targetUrl(request).pathname),
    [highPath, lowPath],
  );
});

test("unknown abr_sq HLS alone is rejected as stream_unavailable without resolving it", async () => {
  const abrPath = "/media/soundcloud:tracks:659/abrStream9/stream/hls";
  const requests = installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/659")) {
      return {
        status: 200,
        body: {
          id: 659,
          urn: "soundcloud:tracks:659",
          access: "playable",
          streamable: true,
          media: {
            transcodings: [{
              url: `https://api-v2.soundcloud.com${abrPath}`,
              preset: "abr_sq",
              quality: "sq",
              format: { protocol: "hls", mime_type: "audio/mpegurl" },
            }],
          },
        },
      };
    }
    if (url.pathname.endsWith(abrPath)) {
      return {
        status: 200,
        body: {
          url: "https://cf-hls-media.sndcdn.com/abr-contract/unknown.m3u8",
        },
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  await assert.rejects(
    direct.resolveDirectMediaSource("soundcloud:tracks:659"),
    (error) => error.code === "stream_unavailable" && error.status === 502,
  );
  assert.equal(
    requests.length,
    1,
    "an unknown playlist MIME is not a codec and must not reach its resolver",
  );
});

test("HLS rejects lookalike subdomains of the exact SoundCloud streaming host", async () => {
  const hlsPath = "/media/soundcloud:tracks:789/aacStream9/stream/hls";
  installTransport(async (request) => {
    const url = targetUrl(request);
    if (url.pathname.endsWith("/tracks/789")) {
      return {
        status: 200,
        body: {
          id: 789,
          urn: "soundcloud:tracks:789",
          access: "playable",
          streamable: true,
          media: {
            transcodings: [{
              url: `https://api-v2.soundcloud.com${hlsPath}`,
              preset: "aac_1_0",
              quality: "hq",
              format: { protocol: "hls", mime_type: "audio/mp4" },
            }],
          },
        },
      };
    }
    if (url.pathname.endsWith(hlsPath)) {
      return {
        status: 200,
        body: {
          url: "https://edge.playback.media-streaming.soundcloud.cloud/playlist.m3u8",
        },
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  });
  direct.configureDirectSoundCloud(() => credentials);

  await assert.rejects(
    direct.resolveDirectMediaSource("soundcloud:tracks:789"),
    (error) => error.code === "blocked_media_url",
  );
});

test("HLS media relay accepts only validated SoundCloud CDN assets and preserves the signed target", () => {
  const signed =
    "https://playback.media-streaming.soundcloud.cloud/audio/master.m3u8?Policy=signed-value&Signature=signature-value";
  const relayed = direct.soundCloudMediaProxyUrl(signed);
  const prefix = `${direct.SPICETIFY_CORS_PROXY_ORIGIN}/`;
  assert.equal(relayed.startsWith(prefix), true);
  assert.equal(relayed.slice(prefix.length), signed);

  const fragment = "https://cf-hls-media.sndcdn.com/audio/segment-1.m4s?Expires=9999999999";
  assert.equal(
    direct.soundCloudMediaProxyUrl(fragment).slice(prefix.length),
    fragment,
  );

  for (const blocked of [
    "http://cf-hls-media.sndcdn.com/audio/segment.m4s",
    "https://edge.playback.media-streaming.soundcloud.cloud/audio/master.m3u8",
    "https://sndcdn.com.evil.example/audio/segment.m4s",
    "https://user:pass@cf-hls-media.sndcdn.com/audio/segment.m4s",
    `${direct.SPICETIFY_CORS_PROXY_ORIGIN}/${signed}`,
  ]) {
    assert.throws(
      () => direct.soundCloudMediaProxyUrl(blocked),
      (error) => error.code === "blocked_media_url",
    );
  }
});

test("HLS XHR setup relays each asset and explicitly omits ambient credentials", () => {
  const target = "https://cf-hls-media.sndcdn.com/audio/segment-2.m4s?Expires=9999999999";
  const calls = [];
  const xhr = {
    withCredentials: true,
    open(...args) { calls.push(args); },
  };

  direct.configureSoundCloudMediaXhr(xhr, target);

  assert.deepEqual(calls, [[
    "GET",
    `${direct.SPICETIFY_CORS_PROXY_ORIGIN}/${target}`,
    true,
  ]]);
  assert.equal(xhr.withCredentials, false);
});
