import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

async function importTypeScript(relativeUrl) {
  const source = await readFile(new URL(relativeUrl, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

const artistMode = await importTypeScript(
  "../src/services/fullscreenArtistMode.ts",
);
const direct = await importTypeScript("../src/services/directSoundcloud.ts");

function rawUser(overrides = {}) {
  return {
    id: 42,
    urn: "soundcloud:users:42",
    username: "Artist",
    permalink_url: "https://soundcloud.com/artist",
    avatar_url: "https://i1.sndcdn.com/avatars-artist-large.jpg",
    ...overrides,
  };
}

function trackWithUser(userOverrides = {}) {
  return {
    id: "soundcloud:tracks:7",
    urn: "soundcloud:tracks:7",
    kind: "track",
    title: "Track",
    duration: 120_000,
    user: {
      id: "soundcloud:users:42",
      urn: "soundcloud:users:42",
      username: "Artist",
      permalink_url: "https://soundcloud.com/artist",
      avatar_url: "https://i1.sndcdn.com/avatars-embedded-large.jpg",
      ...userOverrides,
    },
    artwork_url: "https://i1.sndcdn.com/artworks-track-large.jpg",
    permalink_url: "https://soundcloud.com/artist/track",
    likes_count: 0,
    playback_count: 0,
    description: null,
  };
}

test("fullscreen artist settings normalize persisted values and safe defaults", () => {
  assert.equal(artistMode.normalizeArtistAvatarPosition("left"), "left");
  assert.equal(artistMode.normalizeArtistAvatarPosition("center"), "center");
  assert.equal(artistMode.normalizeArtistAvatarPosition("right"), "right");

  for (const invalid of [undefined, null, "", "top", false, 1, {}]) {
    assert.equal(
      artistMode.normalizeArtistAvatarPosition(invalid),
      "center",
    );
  }

  assert.equal(artistMode.normalizeArtistAvatarVisibility("false"), false);
  for (const visible of [undefined, null, "true", "", true, false, 0]) {
    assert.equal(artistMode.normalizeArtistAvatarVisibility(visible), true);
  }

  assert.equal(
    artistMode.normalizeArtistAvatarBorderVisibility("false"),
    false,
  );
  for (const visible of [undefined, null, "true", "", true, false, 0]) {
    assert.equal(
      artistMode.normalizeArtistAvatarBorderVisibility(visible),
      true,
    );
  }

  assert.equal(
    artistMode.normalizeArtworkBackgroundMode("color"),
    "color",
  );
  for (const blurred of [
    undefined,
    null,
    "",
    "blur",
    "blurred",
    false,
    1,
  ]) {
    assert.equal(
      artistMode.normalizeArtworkBackgroundMode(blurred),
      "blurred",
    );
  }
  assert.equal(
    artistMode.nextArtworkBackgroundMode("blurred", "ArrowRight"),
    "color",
  );
  assert.equal(
    artistMode.nextArtworkBackgroundMode("color", "ArrowRight"),
    "blurred",
  );
});

test("artist toolbar is accessible while active and becomes inert exactly at idle", () => {
  const input = {
    artistMode: true,
    nowMs: 10_000,
    lastActivityAtMs: 10_000,
    keyboardFocusWithin: false,
    reducedMotion: false,
  };

  assert.deepEqual(artistMode.artistToolbarPresentation(input), {
    visible: true,
    inert: false,
    ariaHidden: false,
    hideAfterMs: artistMode.ARTIST_TOOLBAR_IDLE_MS,
    transitionMs: artistMode.ARTIST_TOOLBAR_FADE_MS,
    reason: "recent-activity",
  });

  assert.equal(
    artistMode.artistToolbarPresentation({
      ...input,
      nowMs: input.nowMs + artistMode.ARTIST_TOOLBAR_IDLE_MS - 1,
    }).visible,
    true,
  );
  assert.deepEqual(
    artistMode.artistToolbarPresentation({
      ...input,
      nowMs: input.nowMs + artistMode.ARTIST_TOOLBAR_IDLE_MS,
    }),
    {
      visible: false,
      inert: true,
      ariaHidden: true,
      hideAfterMs: null,
      transitionMs: artistMode.ARTIST_TOOLBAR_FADE_MS,
      reason: "idle",
    },
  );
});

test("pointer idleness hides the toolbar while keyboard focus alone pins it", () => {
  const stale = {
    artistMode: true,
    nowMs: 20_000,
    lastActivityAtMs: 0,
    keyboardFocusWithin: false,
    reducedMotion: false,
  };

  assert.deepEqual(artistMode.artistToolbarPresentation(stale), {
    visible: false,
    inert: true,
    ariaHidden: true,
    hideAfterMs: null,
    transitionMs: artistMode.ARTIST_TOOLBAR_FADE_MS,
    reason: "idle",
  });
  assert.equal(
    artistMode.artistToolbarPresentation({
      ...stale,
      keyboardFocusWithin: true,
    }).reason,
    "keyboard-focus",
  );
  assert.equal(
    artistMode.artistToolbarPresentation({
      ...stale,
      keyboardFocusWithin: true,
    }).hideAfterMs,
    null,
  );
  assert.equal(
    artistMode.artistToolbarPresentation({
      ...stale,
      artistMode: false,
      keyboardFocusWithin: true,
    }).reason,
    "inactive",
  );
});

test("reduced motion removes toolbar fades without changing its idle policy", () => {
  const reduced = artistMode.artistToolbarPresentation({
    artistMode: true,
    nowMs: 4_000,
    lastActivityAtMs: 3_000,
    keyboardFocusWithin: false,
    reducedMotion: true,
  });
  assert.equal(reduced.visible, true);
  assert.equal(reduced.hideAfterMs, artistMode.ARTIST_TOOLBAR_IDLE_MS - 1_000);
  assert.equal(reduced.transitionMs, 0);

  for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY]) {
    const safe = artistMode.artistToolbarPresentation({
      artistMode: true,
      nowMs: invalid,
      lastActivityAtMs: invalid,
      keyboardFocusWithin: false,
      reducedMotion: true,
    });
    assert.equal(safe.visible, true);
    assert.equal(safe.inert, false);
  }
});

test("fullscreen player hides at five seconds and keyboard focus pins it open", () => {
  assert.equal(artistMode.CINEMA_PLAYER_IDLE_MS, 5_000);
  const active = {
    active: true,
    nowMs: 15_000,
    lastActivityAtMs: 10_000,
    keyboardFocusWithin: false,
    reducedMotion: false,
  };
  assert.deepEqual(
    artistMode.cinemaPlayerPresentation({
      ...active,
      nowMs: active.lastActivityAtMs +
        artistMode.CINEMA_PLAYER_IDLE_MS -
        1,
    }),
    {
      hidden: false,
      hideAfterMs: 1,
      transitionMs: artistMode.CINEMA_PLAYER_FADE_MS,
      reason: "recent-activity",
    },
  );
  assert.deepEqual(artistMode.cinemaPlayerPresentation(active), {
    hidden: true,
    hideAfterMs: null,
    transitionMs: artistMode.CINEMA_PLAYER_FADE_MS,
    reason: "idle",
  });
  assert.deepEqual(
    artistMode.cinemaPlayerPresentation({
      ...active,
      lastActivityAtMs: 14_999,
    }),
    {
      hidden: false,
      hideAfterMs: 4_999,
      transitionMs: artistMode.CINEMA_PLAYER_FADE_MS,
      reason: "recent-activity",
    },
  );
  assert.deepEqual(
    artistMode.cinemaPlayerPresentation({
      ...active,
      keyboardFocusWithin: true,
    }).reason,
    "keyboard-focus",
  );
  assert.equal(
    artistMode.cinemaPlayerPresentation({
      ...active,
      active: false,
    }).hidden,
    false,
  );
  assert.deepEqual(
    artistMode.cinemaPlayerPresentation({
      ...active,
      nowMs: Number.NaN,
      reducedMotion: true,
    }),
    {
      hidden: false,
      hideAfterMs: 5_000,
      transitionMs: 0,
      reason: "recent-activity",
    },
  );
});

test("cinema player overlap matches Spotify's real grid contribution", () => {
  assert.equal(
    artistMode.cinemaPlayerGridOffset(88, -8, -8, 8),
    80,
  );
  assert.equal(
    artistMode.cinemaPlayerGridOffset(96, 0, 0, 12),
    108,
  );
  assert.equal(
    artistMode.cinemaPlayerGridOffset(88, Number.NaN, Infinity, -4),
    88,
  );
  for (const invalid of [0, 20, 500, Number.NaN, Infinity]) {
    assert.equal(
      artistMode.cinemaPlayerGridOffset(invalid, 0, 0, 8),
      null,
    );
  }
});

test("cinema artwork follows native geometry through a compositor transform", () => {
  assert.deepEqual(
    artistMode.cinemaArtworkCoverTransform(
      { left: 100, top: 40, width: 1_200, height: 720 },
      { left: 460, top: 120, width: 480, height: 480 },
      400,
      400,
    ),
    {
      x: 360,
      y: 80,
      scaleX: 1.2,
      scaleY: 1.2,
    },
  );
  assert.deepEqual(
    artistMode.cinemaArtworkCoverTransform(
      { left: 25, top: 10, width: 900, height: 600 },
      { left: 225, top: 70, width: 360, height: 320 },
      400,
      400,
    ),
    {
      x: 200,
      y: 60,
      scaleX: 0.9,
      scaleY: 0.8,
    },
  );
  for (const invalid of [
    [0, 400],
    [400, 0],
    [Number.NaN, 400],
    [400, Infinity],
  ]) {
    assert.equal(
      artistMode.cinemaArtworkCoverTransform(
        { left: 0, top: 0, width: 1_000, height: 700 },
        { left: 300, top: 100, width: 400, height: 400 },
        invalid[0],
        invalid[1],
      ),
      null,
    );
  }
});

test("fullscreen entry rejects a falling cover and never measures a WaveLink overlay", async () => {
  const source = await readFile(new URL("../src/services/player.ts", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("player.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const player = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "SoundCloudPlayer");
  const method = player.members.find(node => node.name?.getText(parsed) === "syncCinemaArtworkCoverGeometry");
  const setter = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "setStylePropertyIfChanged");
  const code = ts.transpileModule(`${setter.getText(parsed)}\nclass Harness { ${method.getText(parsed)} }\nreturn Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const Harness = new Function("window", "cinemaArtworkCoverTransform", code)(
    { getComputedStyle: () => ({ borderRadius: "8px" }) },
    artistMode.cinemaArtworkCoverTransform,
  );
  const rect = (left, top, width, height = width) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const image = (bounds, owned = false) => ({
    bounds, isConnected: true,
    matches: () => !owned,
    closest: () => owned ? {} : null,
    getBoundingClientRect() { return this.bounds; },
  });
  const native = image(rect(400, 650, 400));
  const duplicate = image(rect(300, 100, 600), true);
  const classes = new Set(["is-native-aligned"]);
  const properties = new Map([["--wl-cinema-cover-y", "650px"]]);
  const binding = {
    root: {
      dataset: { wlCinemaMode: "artwork" },
      contains: element => [native, duplicate].includes(element),
      querySelectorAll: () => [duplicate, native],
    },
    artworkBackground: { hidden: false, getBoundingClientRect: () => rect(0, 0, 1200, 800) },
    artworkCover: {
      classList: { add: value => classes.add(value), remove: value => classes.delete(value) },
      style: {
        getPropertyValue: name => properties.get(name) ?? "",
        setProperty: (name, value) => properties.set(name, value),
        removeProperty: name => properties.delete(name),
      },
    },
    scrollViewport: { scrollTop: 0 },
    nativeArtworkCover: duplicate,
    artworkCoverBaseWidth: 600,
    artworkCoverBaseHeight: 600,
  };
  const harness = new Harness();
  harness.syncCinemaArtworkCoverGeometry(binding);
  assert.equal(binding.nativeArtworkCover, null, "entering artwork below the viewport must use the centered fallback");
  assert.equal(classes.has("is-native-aligned"), false);
  assert.equal(properties.has("--wl-cinema-cover-y"), false);

  native.bounds = rect(400, 160, 400);
  harness.syncCinemaArtworkCoverGeometry(binding);
  assert.equal(binding.nativeArtworkCover, native, "settled geometry must use the untouched native image");
  assert.equal(properties.get("--wl-cinema-cover-y"), "160px");

  native.bounds = rect(500, 500, 200);
  harness.syncCinemaArtworkCoverGeometry(binding);
  assert.equal(binding.nativeArtworkCover, null, "a fully visible but bottom-aligned entering cover is not the final layout");

  binding.scrollViewport.scrollTop = 220;
  native.bounds = rect(400, -100, 400);
  harness.syncCinemaArtworkCoverGeometry(binding);
  assert.equal(properties.get("--wl-cinema-cover-y"), "-100px", "normal artwork scrolling must remain supported");
});

test("artwork panels follow scroll position and disappear completely at the top", () => {
  const base = {
    active: true,
    scrollTop: 0,
    scrollHeight: 1_100,
    clientHeight: 800,
    reducedMotion: false,
  };
  assert.deepEqual(artistMode.artworkPanelsPresentation(base), {
    progress: 0,
    visible: false,
    inert: true,
    ariaHidden: true,
    transitionMs: artistMode.ARTWORK_PANELS_FADE_MS,
  });
  const middle = artistMode.artworkPanelsPresentation({
    ...base,
    scrollTop: 72,
  });
  assert.equal(middle.progress, 0.5);
  assert.equal(middle.visible, true);
  assert.equal(middle.inert, false);
  assert.equal(
    artistMode.artworkPanelsPresentation({
      ...base,
      scrollTop: 300,
    }).progress,
    1,
  );
  assert.equal(
    artistMode.artworkPanelsPresentation({
      ...base,
      scrollTop: -100,
    }).visible,
    false,
  );
  assert.equal(
    artistMode.artworkPanelsPresentation({
      ...base,
      active: false,
      scrollTop: 300,
    }).progress,
    0,
  );

  const shortRange = artistMode.artworkPanelsPresentation({
    active: true,
    scrollTop: 40,
    scrollHeight: 840,
    clientHeight: 800,
    reducedMotion: true,
  });
  assert.equal(shortRange.progress, 1);
  assert.equal(shortRange.transitionMs, 0);
});

test("Hide avatar keeps one label and pressed means the avatar is hidden", () => {
  assert.deepEqual(
    artistMode.artistAvatarVisibilityPresentation(true, true),
    {
      hidden: false,
      disabled: false,
      ariaPressed: false,
      label: "Hide avatar",
      ariaLabel: "Hide artist avatar",
    },
  );
  assert.deepEqual(
    artistMode.artistAvatarVisibilityPresentation(true, false),
    {
      hidden: true,
      disabled: false,
      ariaPressed: true,
      label: "Hide avatar",
      ariaLabel: "Hide artist avatar",
    },
  );
  assert.deepEqual(
    artistMode.artistAvatarVisibilityPresentation(false, true),
    {
      hidden: true,
      disabled: true,
      ariaPressed: false,
      label: "Hide avatar",
      ariaLabel: "Hide artist avatar",
    },
  );
});

test("avatar border retains its preference while disabled with a hidden avatar", () => {
  assert.deepEqual(
    artistMode.artistAvatarBorderPresentation(true, true, true),
    {
      drawn: true,
      disabled: false,
      ariaPressed: true,
      ariaLabel: "Hide artist avatar border",
    },
  );
  assert.deepEqual(
    artistMode.artistAvatarBorderPresentation(true, true, false),
    {
      drawn: false,
      disabled: false,
      ariaPressed: false,
      ariaLabel: "Show artist avatar border",
    },
  );
  for (const [available, visible] of [
    [false, true],
    [true, false],
    [false, false],
  ]) {
    const presentation = artistMode.artistAvatarBorderPresentation(
      available,
      visible,
      true,
    );
    assert.equal(presentation.drawn, false);
    assert.equal(presentation.disabled, true);
    assert.equal(presentation.ariaPressed, true);
  }
});

test("avatar position follows the keyboard radio-group pattern and wraps", () => {
  assert.equal(
    artistMode.nextArtistAvatarPosition("left", "ArrowLeft"),
    "right",
  );
  assert.equal(
    artistMode.nextArtistAvatarPosition("right", "ArrowRight"),
    "left",
  );
  assert.equal(
    artistMode.nextArtistAvatarPosition("center", "ArrowUp"),
    "left",
  );
  assert.equal(
    artistMode.nextArtistAvatarPosition("center", "ArrowDown"),
    "right",
  );
  assert.equal(artistMode.nextArtistAvatarPosition("right", "Home"), "left");
  assert.equal(artistMode.nextArtistAvatarPosition("left", "End"), "right");
  assert.equal(
    artistMode.nextArtistAvatarPosition("center", "Escape"),
    "center",
    "unhandled keys must remain available to Spotify/fullscreen",
  );
});

test("fullscreen artist visuals prefer hydrated profile assets and trim URLs", () => {
  const track = trackWithUser({
    profile_header_url: "https://i1.sndcdn.com/visuals-embedded.jpg",
  });
  const profile = {
    ...track.user,
    avatar_url: "  https://i1.sndcdn.com/avatars-profile.jpg  ",
    profile_header_url: "  https://i1.sndcdn.com/visuals-profile.jpg  ",
  };

  assert.deepEqual(artistMode.fullscreenArtistVisuals(track, profile), {
    bannerUrl: "https://i1.sndcdn.com/visuals-profile.jpg",
    avatarUrl: "https://i1.sndcdn.com/avatars-profile.jpg",
  });
  assert.deepEqual(artistMode.fullscreenArtistVisuals(track, null), {
    bannerUrl: "https://i1.sndcdn.com/visuals-embedded.jpg",
    avatarUrl: "https://i1.sndcdn.com/avatars-embedded-large.jpg",
  });
});

test("fullscreen artwork uses the track cover and the shared track fallback", () => {
  const track = trackWithUser();
  const fallback = "data:image/svg+xml,wavelink-track-fallback";
  assert.equal(
    artistMode.fullscreenArtworkUrl(track, fallback),
    "https://i1.sndcdn.com/artworks-track-t500x500.jpg",
  );
  assert.equal(
    artistMode.fullscreenArtworkUrl(
      {
        ...track,
        artwork_url: "  https://i1.sndcdn.com/artworks-new-large.jpg  ",
      },
      fallback,
    ),
    "https://i1.sndcdn.com/artworks-new-t500x500.jpg",
  );
  assert.equal(
    artistMode.fullscreenArtworkUrl(
      {
        ...track,
        artwork_url: null,
      },
      fallback,
    ),
    fallback,
    "an artist avatar must not replace the same cover fallback used elsewhere",
  );
  assert.equal(
    artistMode.fullscreenArtworkUrl(
      {
        ...track,
        artwork_url: null,
        user: { ...track.user, avatar_url: "   " },
      },
      fallback,
    ),
    fallback,
  );
});

test("fullscreen artwork retries failed remote covers with the shared fallback", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const start = playerSource.indexOf(
    "private syncCinemaArtworkBackground(",
  );
  const end = playerSource.indexOf(
    "private syncCinemaArtworkForeground(",
    start,
  );
  const background = playerSource.slice(start, end);
  const paletteStart = playerSource.indexOf(
    "private syncCinemaArtworkPalette(",
  );
  const paletteEnd = playerSource.indexOf(
    "private syncCinemaArtworkModeControl(",
    paletteStart,
  );
  const palette = playerSource.slice(paletteStart, paletteEnd);

  assert.match(
    playerSource,
    /private readonly _failedCinemaArtworkSources = new Set<string>\(\)/,
    "cinema failures must be tracked independently from player-bar cover failures",
  );
  assert.doesNotMatch(background, /_failedCoverSources/);
  assert.match(
    background,
    /fullscreenArtworkUrl\(\s*track,\s*WAVELINK_TRACK_FALLBACK_ARTWORK/,
  );
  assert.match(
    background,
    /this\._failedCinemaArtworkSources\.has\(preferredArtwork\)[\s\S]{0,120}WAVELINK_TRACK_FALLBACK_ARTWORK/,
  );
  assert.match(
    background,
    /artwork !== WAVELINK_TRACK_FALLBACK_ARTWORK[\s\S]{0,180}this\._failedCinemaArtworkSources\.add\(artwork\);[\s\S]{0,140}this\.syncCinemaArtworkBackground\(binding, track, artworkMode\);/,
  );
  assert.match(
    background,
    /binding\.artworkCover\.src = artwork;[\s\S]{0,80}binding\.artworkCover\.hidden = false/,
  );
  assert.match(
    palette,
    /!artwork \|\| artwork === WAVELINK_TRACK_FALLBACK_ARTWORK/,
    "the internal data URI keeps the neutral palette without entering the SoundCloud proxy",
  );
});

test("artist profile cache deduplicates concurrent and subsequent loads", async () => {
  const cache = new artistMode.ArtistProfileCache();
  const urn = "soundcloud:users:42";
  const profile = direct.normalizeUser(rawUser());
  assert.ok(profile);

  let resolveRequest;
  let requests = 0;
  const fetchProfile = () => {
    requests += 1;
    return new Promise((resolve) => {
      resolveRequest = resolve;
    });
  };

  const first = cache.load(urn, fetchProfile);
  const second = cache.load(urn, fetchProfile);
  assert.strictEqual(first, second);
  assert.equal(requests, 1);
  assert.equal(cache.get(urn), undefined);

  resolveRequest(profile);
  assert.strictEqual(await first, profile);
  assert.strictEqual(await second, profile);
  assert.strictEqual(cache.get(urn), profile);

  assert.strictEqual(
    await cache.load(urn, async () => {
      requests += 1;
      throw new Error("cached profiles must not be fetched again");
    }),
    profile,
  );
  assert.equal(requests, 1);
});

test("artist profile cache retries transient failures and clear drops success", async () => {
  const cache = new artistMode.ArtistProfileCache();
  const urn = "soundcloud:users:42";
  let requests = 0;

  const failed = await cache.load(urn, async () => {
    requests += 1;
    throw new Error("temporary failure");
  });
  assert.equal(failed, null);
  assert.equal(cache.get(urn), undefined);

  const recovered = await cache.load(urn, async () => {
    requests += 1;
    return direct.normalizeUser(rawUser());
  });
  assert.equal(recovered?.urn, urn);
  assert.equal(requests, 2);

  cache.clear();
  assert.equal(cache.get(urn), undefined);
});

test("user normalization selects the earliest safe enabled SoundCloud visual", () => {
  const normalized = direct.normalizeUser(
    rawUser({
      visuals: {
        enabled: true,
        visuals: [
          {
            entry_time: 20,
            visual_url: "https://i1.sndcdn.com/visuals-later.jpg",
          },
          {
            entry_time: 0,
            visual_url: "https://i1.sndcdn.com/visuals-first.jpg",
          },
          {
            entry_time: 10,
            visual_url: "https://i1.sndcdn.com/visuals-middle.jpg",
          },
        ],
      },
    }),
  );

  assert.equal(
    normalized?.profile_header_url,
    "https://i1.sndcdn.com/visuals-first.jpg",
  );
});

test("user visual and avatar normalization enforce the SoundCloud CDN allowlist", () => {
  const blockedUrls = [
    "http://i1.sndcdn.com/visuals-http.jpg",
    "https://sndcdn.com.evil.example/visuals-host.jpg",
    "https://user:password@i1.sndcdn.com/visuals-creds.jpg",
    "https://i1.sndcdn.com:8443/visuals-port.jpg",
    "javascript:alert(1)",
  ];

  for (const blocked of blockedUrls) {
    const normalized = direct.normalizeUser(
      rawUser({
        avatar_url: blocked,
        visuals: {
          enabled: true,
          visuals: [{ entry_time: 0, visual_url: blocked }],
        },
      }),
    );
    assert.equal(normalized?.avatar_url, "", blocked);
    assert.equal(normalized?.profile_header_url, null, blocked);
  }

  const safeAfterBlocked = direct.normalizeUser(
    rawUser({
      visuals: {
        enabled: true,
        visuals: [
          { entry_time: 0, visual_url: blockedUrls[1] },
          {
            entry_time: 1,
            visual_url: "https://sndcdn.com/visuals-safe.jpg",
          },
        ],
      },
    }),
  );
  assert.equal(
    safeAfterBlocked?.profile_header_url,
    "https://sndcdn.com/visuals-safe.jpg",
  );
});

test("disabled, malformed, and oversized visual collections do not leak a header", () => {
  const safeVisual = {
    entry_time: 0,
    visual_url: "https://i1.sndcdn.com/visuals-safe.jpg",
  };

  for (const visuals of [
    null,
    {},
    { enabled: false, visuals: [safeVisual] },
    { enabled: true, visuals: "not-an-array" },
  ]) {
    assert.equal(
      direct.normalizeUser(rawUser({ visuals }))?.profile_header_url,
      null,
    );
  }

  const oversized = Array.from({ length: 32 }, (_, index) => ({
    entry_time: index,
    visual_url: "https://attacker.example/blocked.jpg",
  }));
  oversized.push(safeVisual);
  assert.equal(
    direct.normalizeUser(
      rawUser({ visuals: { enabled: true, visuals: oversized } }),
    )?.profile_header_url,
    null,
  );
});

test("player wires cinema controls, guarded profile hydration, and full cleanup", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    playerSource,
    /\[role=\"radio\"\]\[value=\"canvas\"\]:not\(\[data-wl-owned\]\)/,
  );
  assert.match(
    playerSource,
    /\[role=\"radio\"\]\[value=\"hero\"\]:not\(\[data-wl-owned\]\)/,
  );
  assert.doesNotMatch(
    playerSource,
    /template\.cloneNode\(true\)/,
    "the Spotify-owned hero radio must be reused instead of cloned into React",
  );
  assert.match(playerSource, /data-wl-cinema-artist-control/);
  assert.match(
    playerSource,
    /parent\.querySelectorAll<HTMLElement>\('\[role="radio"\]'\)[\s\S]{0,180}radios\.length !== 1/,
    "the click target must include Spotify's single-radio visual wrapper without swallowing sibling controls",
  );
  assert.match(
    playerSource,
    /attributeFilter: \["disabled", "aria-disabled"\]/,
  );
  assert.match(
    playerSource,
    /root\.addEventListener\(\s*"pointermove"/,
  );
  assert.match(
    playerSource,
    /root\.addEventListener\(\s*"pointermove"[\s\S]{0,180}noteCinemaToolbarActivity\(binding\)[\s\S]{0,180}document\.addEventListener\(\s*"pointermove"[\s\S]{0,180}noteCinemaPlayerActivity\(binding\)/,
    "pointer activity must restore both the artist toolbar and fullscreen player",
  );
  assert.match(
    playerSource,
    /root\.addEventListener\(\s*"pointerdown"[\s\S]{0,260}toolbarKeyboardFocusWithin = false/,
    "pointer interaction must release the keyboard-only toolbar pin",
  );
  assert.match(playerSource, /\(event as MouseEvent\)\.detail <= 0/);
  assert.match(playerSource, /active\.blur\(\)/);
  assert.match(
    playerSource,
    /interactionTarget\.addEventListener\(\s*"click",\s*this\._onCinemaArtistModeClick/,
  );
  assert.match(
    playerSource,
    /button\.addEventListener\("keydown",\s*this\._onCinemaArtistModeKeyDown/,
  );
  assert.match(playerSource, /binding\.artistControlAbort\?\.abort\(\)/);
  assert.doesNotMatch(
    playerSource,
    /_onCinemaArtistDocumentClick/,
    "artist mode must never intercept unrelated document-level fullscreen clicks",
  );
  assert.doesNotMatch(
    playerSource,
    /document\.addEventListener\(\s*"pointerdown"[\s\S]{0,120}CinemaArtist/,
  );
  assert.match(playerSource, /artistAvatarBorderPresentation\(/);
  assert.match(playerSource, /artistAvatarVisibilityPresentation\(/);
  assert.match(
    playerSource,
    /wl-cinema-scroll-viewport[\s\S]{0,140}overflow-y: hidden !important/,
  );
  assert.match(
    playerSource,
    /Root__cinema-view:has\(\.wl-sc-cinema-artist-overlay\.is-controls-visible\) \.wl-cinema-controls-layer,[\s\S]{0,260}Root__cinema-view:has\(\.wl-sc-cinema-artist-overlay\.is-controls-visible\) :has\(\[role="radiogroup"\]:not\(\.wl-cinema-avatar-position\)\) \{[\s\S]{0,220}opacity: 1 !important[\s\S]{0,120}visibility: visible !important[\s\S]{0,120}pointer-events: auto !important/,
    "artist activity must override Spotify's stale scrolled-header opacity without affecting artwork mode",
  );
  assert.match(
    playerSource,
    /binding\.overlay\.classList\.toggle\(\s*"is-controls-visible",\s*this\._cinemaArtistMode && presentation\.visible/,
    "the native fullscreen controls must follow the toolbar activity on WaveLink-owned DOM that React cannot overwrite",
  );
  assert.match(
    playerSource,
    /if \(binding\.controlsLayer !== controlsLayer\) \{[\s\S]{0,220}\}\s*controlsLayer\.classList\.add\("wl-cinema-controls-layer"\)/,
    "reconciliation must restore the native-header marker after Spotify rewrites its className",
  );
  assert.match(
    playerSource,
    /binding\.scrollViewport\.scrollTop !== 0[\s\S]{0,100}binding\.scrollViewport\.scrollTop = 0/,
  );
  assert.match(
    playerSource,
    /viewport\.addEventListener\(\s*"scroll"[\s\S]{0,220}noteCinemaArtworkScroll\(binding\)/,
    "Credits and queue must follow the real Spotify scroll viewport",
  );
  assert.match(
    playerSource,
    /binding\.scrollAbort\?\.abort\(\)[\s\S]{0,180}cancelCinemaScrollFrame\(binding\)/,
    "replaced Spotify viewports must release their scroll lifecycle",
  );
  assert.match(
    playerSource,
    /if \(binding\.scrollViewport === viewport\) return/,
    "the 250 ms reconciliation tick must not rewrite an unchanged scroll presentation",
  );
  assert.match(
    playerSource,
    /private noteCinemaArtworkScroll\([\s\S]{0,420}binding\.scrollActive = true[\s\S]{0,180}classList\.add\("is-scroll-active"\)/,
    "scroll activity must suspend deep reconciliation until kinetic scrolling settles",
  );
  assert.match(
    playerSource,
    /binding\.scrollSettleTimer = window\.setTimeout\([\s\S]{0,620}CINEMA_ARTWORK_SCROLL_SETTLE_MS/,
  );
  assert.match(
    playerSource,
    /if \(!this\.cinemaArtworkScrollActive\(\)\) \{[\s\S]{0,120}this\.applyTrackInfo\(\)/,
    "the playback tick must skip only heavy DOM reconciliation while artwork is scrolling",
  );
  assert.match(
    playerSource,
    /wl-cinema-artwork-foreground\.is-scroll-active \{[\s\S]{0,100}transition: none !important/,
    "scroll-bound opacity must follow the viewport directly instead of chasing it through a 160 ms transition",
  );
  assert.match(
    playerSource,
    /Math\.round\(presentation\.progress \* 1_000\) \/ 1_000[\s\S]{0,320}scrollPresentationKey === presentationKey/,
    "equivalent scroll frames must not invalidate styles and accessibility attributes",
  );
  assert.match(
    playerSource,
    /private scheduleCinemaArtworkScrollPresentation\([\s\S]{0,420}requestAnimationFrame\([\s\S]{0,180}syncCinemaArtworkCoverGeometry\(binding\)[\s\S]{0,120}syncCinemaArtworkScrollPresentation\(binding\)/,
    "the sharp cover and scroll panels must advance in the same animation frame",
  );
  assert.match(
    playerSource,
    /private trackCinemaArtworkLayout\([\s\S]{0,900}syncCinemaArtworkCoverGeometry\(binding\)[\s\S]{0,260}requestAnimationFrame\(sample\)/,
    "the sharp cover must follow every frame of the fullscreen player collapse",
  );
  assert.match(
    playerSource,
    /wasHidden !== presentation\.hidden[\s\S]{0,180}trackCinemaArtworkLayout\([\s\S]{0,120}presentation\.transitionMs/,
    "layout tracking must start only when the player actually changes visibility",
  );
  assert.match(
    playerSource,
    /cached\?\.isConnected[\s\S]{0,180}binding\.root\.contains\(cached\)[\s\S]{0,320}cached\.getBoundingClientRect\(\)/,
    "scroll frames must reuse the same native cover instead of sorting every candidate",
  );
  assert.match(
    playerSource,
    /wl-cinema-artwork-cover\.is-native-aligned \{[\s\S]{0,500}translate3d\([\s\S]{0,260}scale\([\s\S]{0,220}will-change: transform/,
    "cover motion must stay on the compositor instead of animating layout properties",
  );
  assert.match(
    playerSource,
    /syncCinemaPlayerMode\(\s*binding,\s*this\._cinemaArtistMode \|\| artworkMode/,
    "the native player auto-hide policy must cover both WaveLink fullscreen modes",
  );
  assert.match(
    playerSource,
    /wl-cinema-player-layer,[\s\S]{0,220}Root__now-playing-bar \{[\s\S]{0,220}clip-path: inset\(0 0 0 0\)/,
  );
  assert.match(
    playerSource,
    /wl-cinema-player-layer\.wl-cinema-player-idle,[\s\S]{0,320}Root__now-playing-bar \{[\s\S]{0,180}clip-path: inset\(100% 0 0 0\)[\s\S]{0,120}pointer-events: none/,
  );
  assert.match(
    playerSource,
    /body\.sc-active\.wl-cinema-player-idle \.Root__cinema-view \{[\s\S]{0,420}margin-bottom:[\s\S]{0,100}calc\(-1 \* var\(--wl-cinema-player-grid-offset, 80px\)\) !important[\s\S]{0,180}above-everything-grid-area-z-index/,
    "the cinema view must mirror Spotify's native controls-hidden overlap and cover the full player row",
  );
  assert.doesNotMatch(
    playerSource,
    /wl-cinema-player-layer\.wl-cinema-player-idle,[\s\S]{0,520}transform:/,
    "auto-hide must not change the geometry used to rediscover Spotify's player layer",
  );
  assert.match(
    playerSource,
    /\[data-testid="now-playing-bar"\], \.Root__now-playing-bar/,
    "the player layer must target Spotify's semantic bottom bar even when it is a cinema sibling",
  );
  assert.match(
    playerSource,
    /current\?\.isConnected[\s\S]{0,220}current\.matches\([\s\S]{0,120}\[data-testid="now-playing-bar"\],[\s\S]{0,120}\.Root__now-playing-bar/,
    "the cached semantic player must avoid repeated fullscreen geometry scans",
  );
  assert.match(
    playerSource,
    /rememberCinemaPlayerGridOffset\([\s\S]{0,1200}cinemaPlayerGridOffset\([\s\S]{0,320}--wl-cinema-player-grid-offset[\s\S]{0,120}Math\.ceil\(offset\)/,
    "the native overlap distance must include the bar's negative margins and Spotify's row gap",
  );
  assert.match(
    playerSource,
    /document\.getElementById\("wavelink-native-controls"\)[\s\S]{0,620}rect\.width >= viewportWidth \* 0\.65[\s\S]{0,220}rect\.bottom >= viewportHeight - 36/,
    "WaveLink controls provide a geometry-based fallback when Spotify drops the semantic bar selector",
  );
  assert.match(
    playerSource,
    /binding\.playerLayer\.classList\.toggle\(\s*"wl-cinema-player-idle",\s*presentation\.hidden/,
  );
  assert.match(
    playerSource,
    /document\.body\.classList\.toggle\("wl-cinema-player-idle", hidden\)/,
    "the stable document root must preserve idle state across Spotify React rewrites",
  );
  assert.match(
    playerSource,
    /binding\.playerKeyboardModality &&[\s\S]{0,120}binding\.playerLayer\?\.contains\(active\)/,
    "pointer-created focus on the fullscreen button must not pin the player open",
  );
  assert.match(
    playerSource,
    /"pointermove",[\s\S]{0,160}binding\.playerKeyboardModality = false[\s\S]{0,120}noteCinemaPlayerActivity\(binding\)/,
  );
  assert.match(
    playerSource,
    /"keydown",[\s\S]{0,160}binding\.playerKeyboardModality = true[\s\S]{0,120}noteCinemaPlayerActivity\(binding\)/,
    "real keyboard focus must still keep the controls accessible",
  );
  assert.match(
    playerSource,
    /body\.sc-active\.wl-cinema-player-idle \[data-testid="now-playing-bar"\],[\s\S]{0,120}body\.sc-active\.wl-cinema-player-idle \.Root__now-playing-bar/,
    "the document idle state must hide Spotify's semantic bottom bar without relying on a mutable footer class",
  );
  assert.match(
    playerSource,
    /binding\.scrollViewport\?\.classList\.remove\("wl-cinema-scroll-viewport"\)/,
  );
  assert.match(
    playerSource,
    /wl-cinema-avatar-toggle[\s\S]{0,100}border-radius: 999px 0 0 999px !important/,
  );
  assert.match(
    playerSource,
    /wl-cinema-artist-avatar \{[\s\S]{0,500}solid #ff5500/,
  );
  assert.match(
    playerSource,
    /is-avatar-border-hidden \.wl-cinema-artist-avatar \{[\s\S]{0,100}border: 0/,
  );
  assert.doesNotMatch(
    playerSource,
    /is-avatar-border-hidden \.wl-cinema-artist-avatar \{[\s\S]{0,100}border-color: transparent/,
  );
  assert.match(
    playerSource,
    /wl-npv-credits,[\s\S]{0,180}wl-npv-queue[\s\S]{0,100}display: none !important/,
  );
  assert.match(playerSource, /className = "wl-sc-cinema-artist-overlay"/);
  assert.match(playerSource, /overlay\.setAttribute\("data-wl-owned", "true"\)/);
  assert.match(
    playerSource,
    /binding\.overlayHost && root\.contains\(binding\.overlayHost\)[\s\S]{0,100}: root\)/,
    "the fullscreen root must remain a safe overlay fallback when Spotify changes its internal visual wrapper",
  );
  assert.match(playerSource, /this\.prepareArtistProfile\(track, loadId\)/);
  assert.match(playerSource, /loadId !== this\._loadId/);
  assert.match(
    playerSource,
    /\(this\._track\.user\.urn \|\| this\._track\.user\.id\) !== urn/,
  );
  assert.match(playerSource, /this\.releaseCinemaArtistSurface\(binding\)/);
  assert.match(playerSource, /this\.restoreHiddenNative\(element, snapshot\)/);
  assert.match(playerSource, /binding\.foregroundLayers\.clear\(\)/);
  assert.match(playerSource, /this\.clearCinemaPlayerTimer\(binding\)/);
  assert.match(
    playerSource,
    /this\.cancelCinemaArtworkLayoutFrame\(binding\)/,
  );
  assert.match(
    playerSource,
    /binding\.playerLayer\?\.classList\.remove\([\s\S]{0,160}"wl-cinema-player-layer"[\s\S]{0,120}"wl-cinema-player-idle"/,
  );
  assert.match(playerSource, /binding\.scrollAbort\?\.abort\(\)/);
});

test("Show artwork owns a color-matched background with guarded lifecycle", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    playerSource,
    /className = "wl-sc-cinema-artwork-background"/,
  );
  assert.match(
    playerSource,
    /className = "wl-cinema-artwork-backdrop"/,
  );
  assert.match(
    playerSource,
    /className = "wl-cinema-artwork-cover"/,
  );
  assert.match(
    playerSource,
    /artworkBackground\.setAttribute\("data-wl-owned", "true"\)[\s\S]{0,120}artworkBackground\.setAttribute\("aria-hidden", "true"\)/,
  );
  assert.match(
    playerSource,
    /overlayHost\.classList\.add\("wl-cinema-visual-host"\)[\s\S]{0,180}overlayHost\.prepend\(binding\.artworkBackground\)/,
    "the background must sit behind Spotify's native artwork tree",
  );
  assert.match(
    playerSource,
    /binding\.root\.classList\.toggle\(\s*"wl-sc-cinema-artwork-mode",\s*artworkMode/,
  );
  assert.match(
    playerSource,
    /binding\.artworkBackground\.hidden = !artworkMode/,
  );
  assert.match(
    playerSource,
    /const artworkMode =\s*!this\._cinemaArtistMode[\s\S]{0,180}artworkChecked === "true"/,
    "artist image and unrelated native modes must not expose the artwork background",
  );
  assert.match(
    playerSource,
    /const signature = \[trackKey\(track\), artwork\]\.join\("\\u0000"\)/,
  );
  assert.match(
    playerSource,
    /binding\.artworkBackdrop\.hidden = true;[\s\S]{0,100}binding\.artworkBackdrop\.removeAttribute\("src"\)/,
    "the preceding track's palette must disappear before a new cover loads",
  );
  assert.match(
    playerSource,
    /candidate\.addEventListener\(\s*"load"[\s\S]{0,260}binding\.artworkSignature !== signature[\s\S]{0,260}binding\.artworkBackdrop = candidate[\s\S]{0,100}candidate\.hidden = false/,
  );
  assert.match(
    playerSource,
    /candidate\.addEventListener\(\s*"error"[\s\S]{0,260}binding\.artworkSignature !== signature[\s\S]{0,700}binding\.artworkBackdrop\.hidden = true/,
    "only a failure of the bundled terminal fallback may leave fullscreen artwork hidden",
  );
  assert.match(
    playerSource,
    /wl-sc-cinema-artwork-background \{[\s\S]{0,520}z-index: 20 !important[\s\S]{0,180}pointer-events: none !important/,
    "WaveLink must own a non-interactive visual above Spotify's stale palette",
  );
  assert.match(
    playerSource,
    /wl-cinema-artwork-cover \{[\s\S]{0,420}z-index: 2[\s\S]{0,300}object-fit: cover/,
  );
  assert.match(
    playerSource,
    /syncCinemaArtworkCoverGeometry\(binding\)[\s\S]{0,160}binding\.artworkSignature === signature/,
    "native cover geometry must be reconciled even when the track signature is unchanged",
  );
  assert.match(
    playerSource,
    /querySelectorAll<HTMLImageElement>\(\s*"img:not\(\[data-wl-owned\]\)"/,
  );
  assert.match(
    playerSource,
    /cinemaArtworkCoverTransform\([\s\S]{0,220}binding\.artworkCoverBaseWidth[\s\S]{0,620}--wl-cinema-cover-x[\s\S]{0,620}--wl-cinema-cover-scale-x/,
    "the owned sharp cover must follow Spotify's live geometry through compositor properties",
  );
  assert.match(
    playerSource,
    /className = "wl-cinema-artwork-foreground"[\s\S]{0,140}setAttribute\("data-wl-owned", "true"\)/,
  );
  assert.match(
    playerSource,
    /className =\s*"wl-cinema-artwork-background-control"[\s\S]{0,220}setAttribute\("role", "radiogroup"\)/,
  );
  assert.match(
    playerSource,
    /\["blurred", "Blurred artwork",[\s\S]{0,180}\["color", "Color",/,
    "the scroll-bound foreground must own both background choices",
  );
  assert.match(
    playerSource,
    /artworkForeground\.appendChild\(artworkModeControl\)/,
  );
  assert.match(
    playerSource,
    /wl-cinema-artwork-foreground \{[\s\S]{0,360}z-index: 30 !important[\s\S]{0,260}grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)[\s\S]{0,420}opacity: var\(--wl-cinema-panels-opacity, 0\)[\s\S]{0,420}pointer-events: none !important/,
  );
  assert.match(
    playerSource,
    /wl-cinema-artwork-foreground\.is-scroll-interactive \{[\s\S]{0,120}pointer-events: auto !important/,
  );
  assert.match(
    playerSource,
    /for \(const selector of \["\.wl-npv-credits", "\.wl-npv-queue"\]\)[\s\S]{0,900}binding\.artworkForeground\.appendChild\(section\)/,
    "the owned interactive fullscreen panels must be lifted above the artwork visual",
  );
  assert.match(
    playerSource,
    /overlayHost\.prepend\(binding\.artworkBackground\)[\s\S]{0,220}overlayHost\.appendChild\(binding\.artworkForeground\)/,
  );
  assert.match(
    playerSource,
    /wl-cinema-artwork-backdrop \{[\s\S]{0,400}blur\(clamp\([\s\S]{0,120}saturate\(1\.38\)[\s\S]{0,80}brightness\(\.52\)/,
  );
  assert.match(
    playerSource,
    /data-background-mode="color"[\s\S]{0,180}background: var\(--wl-cinema-color-dark, #2A2A2A\)/,
  );
  assert.match(
    playerSource,
    /data-background-mode="color"[\s\S]{0,420}wl-cinema-artwork-backdrop \{[\s\S]{0,120}opacity: 0[\s\S]{0,100}visibility: hidden/,
    "Color mode must hide only the blurred image while retaining the sharp cover",
  );
  assert.match(
    playerSource,
    /syncCinemaArtworkPalette\(binding, artwork, signature\)[\s\S]{0,160}binding\.artworkSignature === signature/,
    "palette loading must be independent from image reloads and background mode changes",
  );
  assert.match(
    playerSource,
    /binding\.paletteSignature !== signature[\s\S]{0,180}_cinemaArtistSurfaces\.get\(binding\.root\) !== binding/,
    "a late palette may not recolor a newer track or destroyed fullscreen root",
  );
  assert.match(
    playerSource,
    /STORAGE_KEYS\.cinemaArtworkBackgroundMode[\s\S]{0,140}mode/,
    "the selected artwork background mode must persist",
  );
  assert.match(
    playerSource,
    /binding\.artworkBackground\.remove\(\)[\s\S]{0,120}binding\.artworkForeground\.remove\(\)[\s\S]{0,300}binding\.root\.classList\.remove\("wl-sc-cinema-artwork-mode"\)/,
    "Spotify handoff must restore the native fullscreen surface completely",
  );
});
