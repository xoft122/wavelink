import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const [bridgeSource, playerSource] = await Promise.all([
  readFile(
    new URL("../src/services/linuxMediaSession.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
]);

const compiledBridge = ts.transpileModule(bridgeSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const linuxMedia = await import(
  `data:text/javascript;base64,${Buffer.from(compiledBridge).toString("base64")}`
);

class FakeMediaMetadata {
  static constructions = [];

  constructor(init) {
    this.init = structuredClone(init);
    FakeMediaMetadata.constructions.push(this.init);
  }
}

class FakeMediaSession {
  constructor({ unsupported = [], metadata = null, playbackState = "none" } = {}) {
    this.unsupported = new Set(unsupported);
    this.handlers = new Map();
    this.actionCalls = [];
    this.positionCalls = [];
    this.metadataWrites = [];
    this.playbackWrites = [];
    this._metadata = metadata;
    this._playbackState = playbackState;
  }

  get metadata() {
    return this._metadata;
  }

  set metadata(value) {
    this.metadataWrites.push(value);
    this._metadata = value;
  }

  get playbackState() {
    return this._playbackState;
  }

  set playbackState(value) {
    this.playbackWrites.push(value);
    this._playbackState = value;
  }

  setActionHandler(action, handler) {
    this.actionCalls.push({ action, handler });
    if (this.unsupported.has(action)) {
      throw new DOMException(`${action} unsupported`, "NotSupportedError");
    }
    if (handler === null) this.handlers.delete(action);
    else this.handlers.set(action, handler);
  }

  setPositionState(state) {
    this.positionCalls.push(state === undefined ? undefined : { ...state });
  }
}

function navigatorFor(session, overrides = {}) {
  return {
    platform: "Linux x86_64",
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    mediaSession: session,
    ...overrides,
  };
}

function createHarness({
  session = new FakeMediaSession(),
  navigator = navigatorFor(session),
  now = 10_000,
  timeline = {
    duration: 180,
    position: 25,
    playbackRate: 1,
    isPlaying: false,
  },
  metadataConstructor = FakeMediaMetadata,
} = {}) {
  let clock = now;
  const liveTimeline = { ...timeline };
  const calls = {
    play: 0,
    pause: 0,
    stop: 0,
    next: 0,
    previous: 0,
    seekTo: [],
  };
  const bridge = linuxMedia.createLinuxMediaSessionBridge(
    {
      play() {
        calls.play += 1;
      },
      pause() {
        calls.pause += 1;
      },
      stop() {
        calls.stop += 1;
      },
      next() {
        calls.next += 1;
      },
      previous() {
        calls.previous += 1;
      },
      seekTo(seconds) {
        calls.seekTo.push(seconds);
        liveTimeline.position = seconds;
      },
      timeline() {
        return { ...liveTimeline };
      },
    },
    {
      navigator,
      mediaMetadataConstructor: metadataConstructor,
      now: () => clock,
    },
  );
  return {
    bridge,
    calls,
    session,
    timeline: liveTimeline,
    advanceClock(milliseconds) {
      clock += milliseconds;
    },
  };
}

function activate(bridge, overrides = {}) {
  return bridge.activate({
    key: "soundcloud:tracks:123",
    title: "Night Drive",
    artist: "Wave Artist",
    album: "WaveLink · Your Feed",
    artworkUrl: "https://i1.sndcdn.com/artworks-test-t500x500.jpg",
    ...overrides,
  });
}

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker after ${startMarker}`);
  return source.slice(start, end);
}

test("Linux desktop detection is strict and capability based", () => {
  const session = new FakeMediaSession();
  const environment = (navigator) => ({
    navigator,
    mediaMetadataConstructor: FakeMediaMetadata,
  });
  const supported = [
    navigatorFor(session),
    navigatorFor(session, {
      platform: "",
      userAgent: "Mozilla/5.0 (X11; Linux aarch64)",
    }),
    navigatorFor(session, {
      platform: "Win32",
      userAgent: "",
      userAgentData: { platform: "Linux" },
    }),
  ];
  for (const navigator of supported) {
    assert.equal(
      linuxMedia.isLinuxDesktopMediaSessionEnvironment(environment(navigator)),
      true,
    );
  }

  const unsupported = [
    navigatorFor(session, {
      platform: "Win32",
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    }),
    navigatorFor(session, {
      platform: "MacIntel",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    }),
    navigatorFor(session, {
      platform: "Linux armv8l",
      userAgent: "Mozilla/5.0 (Linux; Android 15)",
    }),
    { platform: "Linux x86_64", userAgent: "Linux" },
    { ...navigatorFor(session), mediaSession: {} },
  ];
  for (const navigator of unsupported) {
    assert.equal(
      linuxMedia.isLinuxDesktopMediaSessionEnvironment(environment(navigator)),
      false,
    );
  }
  assert.equal(
    linuxMedia.isLinuxDesktopMediaSessionEnvironment({
      navigator: navigatorFor(session),
      mediaMetadataConstructor: null,
    }),
    false,
  );
});

test("Windows and macOS sessions are never readopted, overwritten, or cleared", () => {
  for (const [platform, userAgent] of [
    ["Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"],
    ["MacIntel", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"],
  ]) {
    const foreignMetadata = { owner: "Spotify" };
    const session = new FakeMediaSession({
      metadata: foreignMetadata,
      playbackState: "playing",
    });
    const { bridge } = createHarness({
      session,
      navigator: navigatorFor(session, { platform, userAgent }),
    });

    assert.equal(bridge.isEnabled, false);
    assert.equal(activate(bridge), false);
    bridge.syncPlayback();
    bridge.syncPosition(true);
    bridge.release();
    bridge.destroy();

    assert.equal(session.metadata, foreignMetadata);
    assert.equal(session.playbackState, "playing");
    assert.deepEqual(session.metadataWrites, []);
    assert.deepEqual(session.playbackWrites, []);
    assert.deepEqual(session.actionCalls, []);
    assert.deepEqual(session.positionCalls, []);
  }
});

test("activation publishes clean WaveLink metadata and a valid initial timeline", () => {
  FakeMediaMetadata.constructions = [];
  const { bridge, session } = createHarness();
  assert.equal(
    activate(bridge, {
      title: "  Night\u0000   Drive  ",
      artist: "  Wave\n Artist ",
    }),
    true,
  );
  assert.equal(bridge.isOwned, true);
  assert.deepEqual(FakeMediaMetadata.constructions, [
    {
      title: "Night Drive",
      artist: "Wave Artist",
      album: "WaveLink · Your Feed",
      artwork: [
        { src: "https://i1.sndcdn.com/artworks-test-t500x500.jpg" },
      ],
    },
  ]);
  assert.equal(session.playbackState, "paused");
  assert.deepEqual(session.positionCalls.at(-1), {
    duration: 180,
    playbackRate: 1,
    position: 25,
  });
  assert.equal(session.handlers.size, 8);
});

test("blank metadata receives readable WaveLink defaults", () => {
  FakeMediaMetadata.constructions = [];
  const { bridge } = createHarness();
  activate(bridge, {
    title: " \n ",
    artist: "\u0000",
    album: undefined,
    artworkUrl: "",
  });
  assert.deepEqual(FakeMediaMetadata.constructions.at(-1), {
    title: "Unknown track",
    artist: "SoundCloud",
    album: "WaveLink · SoundCloud",
  });
});

test("all Linux OS transport actions control only the WaveLink callbacks", () => {
  const { bridge, calls, session } = createHarness();
  activate(bridge);

  session.handlers.get("play")({});
  session.handlers.get("pause")({});
  session.handlers.get("stop")({});
  session.handlers.get("nexttrack")({});
  session.handlers.get("previoustrack")({});

  assert.deepEqual(calls, {
    play: 1,
    pause: 1,
    stop: 1,
    next: 1,
    previous: 1,
    seekTo: [],
  });
});

test("async OS play, next, and previous failures are consumed by the bridge", async () => {
  const session = new FakeMediaSession();
  let consumedThenables = 0;
  const rejectedThenable = () => ({
    then(_resolve, reject) {
      consumedThenables += 1;
      reject(new Error("simulated async control failure"));
    },
  });
  const bridge = linuxMedia.createLinuxMediaSessionBridge(
    {
      play: rejectedThenable,
      pause() {},
      stop() {},
      next: rejectedThenable,
      previous: rejectedThenable,
      seekTo() {},
      timeline() {
        return {
          duration: 180,
          position: 25,
          playbackRate: 1,
          isPlaying: false,
        };
      },
    },
    {
      navigator: navigatorFor(session),
      mediaMetadataConstructor: FakeMediaMetadata,
    },
  );
  activate(bridge);

  assert.doesNotThrow(() => session.handlers.get("play")({}));
  assert.doesNotThrow(() => session.handlers.get("nexttrack")({}));
  assert.doesNotThrow(() => session.handlers.get("previoustrack")({}));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(
    consumedThenables,
    3,
    "every Promise-like result needs a rejection handler instead of becoming an unhandled rejection",
  );
});

test("seek actions use the live timeline, defaults, custom offsets, and clamping", () => {
  const { bridge, calls, session, timeline } = createHarness();
  activate(bridge);

  session.handlers.get("seekto")({ seekTime: 999 });
  assert.deepEqual(calls.seekTo, [180]);

  timeline.position = 50;
  session.handlers.get("seekbackward")({});
  assert.deepEqual(calls.seekTo, [180, 40]);

  session.handlers.get("seekbackward")({ seekOffset: 100 });
  assert.deepEqual(calls.seekTo, [180, 40, 0]);

  timeline.position = 175;
  session.handlers.get("seekforward")({ seekOffset: 30 });
  assert.deepEqual(calls.seekTo, [180, 40, 0, 180]);

  session.handlers.get("seekto")({ seekTime: Number.NaN });
  assert.deepEqual(calls.seekTo, [180, 40, 0, 180]);

  timeline.duration = 0;
  session.handlers.get("seekforward")({ seekOffset: 10 });
  assert.deepEqual(calls.seekTo, [180, 40, 0, 180]);
});

test("position state is finite, clamped, throttled, and cleared for invalid duration", () => {
  const { bridge, session, timeline, advanceClock } = createHarness({
    now: 20_000,
  });
  activate(bridge);

  timeline.position = -50;
  timeline.playbackRate = 0;
  bridge.syncPosition(true);
  assert.deepEqual(session.positionCalls.at(-1), {
    duration: 180,
    playbackRate: 1,
    position: 0,
  });

  timeline.position = 999;
  timeline.playbackRate = Number.NaN;
  bridge.syncPosition(true);
  assert.deepEqual(session.positionCalls.at(-1), {
    duration: 180,
    playbackRate: 1,
    position: 180,
  });

  const beforeThrottle = session.positionCalls.length;
  timeline.position = 60;
  advanceClock(999);
  bridge.syncPosition();
  assert.equal(session.positionCalls.length, beforeThrottle);
  advanceClock(1);
  bridge.syncPosition();
  assert.equal(session.positionCalls.length, beforeThrottle + 1);
  assert.equal(session.positionCalls.at(-1).position, 60);

  timeline.duration = Number.POSITIVE_INFINITY;
  bridge.syncPosition(true);
  assert.equal(session.positionCalls.at(-1), undefined);
});

test("unsupported Media Session actions degrade independently", () => {
  const session = new FakeMediaSession({
    unsupported: ["stop", "seekto", "seekforward", "seekbackward"],
  });
  const { bridge, calls } = createHarness({ session });
  assert.doesNotThrow(() => activate(bridge));
  assert.deepEqual([...session.handlers.keys()].sort(), [
    "nexttrack",
    "pause",
    "play",
    "previoustrack",
  ]);

  session.handlers.get("play")({});
  session.handlers.get("nexttrack")({});
  assert.equal(calls.play, 1);
  assert.equal(calls.next, 1);

  const callsBeforeRelease = session.actionCalls.length;
  bridge.release();
  const cleanup = session.actionCalls.slice(callsBeforeRelease);
  assert.deepEqual(
    cleanup.map(({ action }) => action).sort(),
    ["nexttrack", "pause", "play", "previoustrack"],
    "cleanup must retry only actions that WaveLink successfully registered",
  );
});

test("metadata artwork rejection falls back to text without dropping the session", () => {
  class ArtworkRejectingMetadata {
    static constructions = [];

    constructor(init) {
      ArtworkRejectingMetadata.constructions.push(structuredClone(init));
      if (init.artwork) throw new TypeError("unsupported artwork scheme");
      this.init = structuredClone(init);
    }
  }
  const { bridge, session } = createHarness({
    metadataConstructor: ArtworkRejectingMetadata,
  });
  assert.doesNotThrow(() => activate(bridge));
  assert.equal(ArtworkRejectingMetadata.constructions.length, 2);
  assert.deepEqual(session.metadata.init, {
    title: "Night Drive",
    artist: "Wave Artist",
    album: "WaveLink · Your Feed",
  });
  assert.equal(bridge.isOwned, true);
});

test("release is complete, idempotent, and invalidates queued stale commands", () => {
  const { bridge, calls, session } = createHarness();
  activate(bridge);
  const stalePlay = session.handlers.get("play");
  const successfulActions = [...session.handlers.keys()];

  bridge.release();
  assert.equal(bridge.isOwned, false);
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, "none");
  assert.equal(session.positionCalls.at(-1), undefined);
  assert.equal(session.handlers.size, 0);
  for (const action of successfulActions) {
    assert.ok(
      session.actionCalls.some(
        (call) => call.action === action && call.handler === null,
      ),
    );
  }

  stalePlay({});
  assert.equal(calls.play, 0, "an OS event queued before handoff must be inert");

  const writeCounts = {
    metadata: session.metadataWrites.length,
    playback: session.playbackWrites.length,
    actions: session.actionCalls.length,
    positions: session.positionCalls.length,
  };
  bridge.release();
  assert.deepEqual(
    {
      metadata: session.metadataWrites.length,
      playback: session.playbackWrites.length,
      actions: session.actionCalls.length,
      positions: session.positionCalls.length,
    },
    writeCounts,
  );
});

test("same-track activation is stable while a new track updates metadata without duplicate handlers", () => {
  FakeMediaMetadata.constructions = [];
  const { bridge, session } = createHarness();
  activate(bridge);
  const actionRegistrations = session.actionCalls.length;
  const metadataWrites = session.metadataWrites.length;

  activate(bridge);
  assert.equal(session.actionCalls.length, actionRegistrations);
  assert.equal(session.metadataWrites.length, metadataWrites);

  activate(bridge, {
    key: "soundcloud:tracks:456",
    title: "Second Track",
  });
  assert.equal(session.actionCalls.length, actionRegistrations);
  assert.equal(session.metadataWrites.length, metadataWrites + 1);
  assert.equal(session.metadata.init.title, "Second Track");
});

test("the same track can replace rejected remote artwork with WaveLink fallback", () => {
  FakeMediaMetadata.constructions = [];
  const { bridge, session } = createHarness();
  activate(bridge);
  const actionRegistrations = session.actionCalls.length;
  const metadataWrites = session.metadataWrites.length;

  activate(bridge, {
    artworkUrl:
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
  });
  assert.equal(session.actionCalls.length, actionRegistrations);
  assert.equal(session.metadataWrites.length, metadataWrites + 1);
  assert.deepEqual(session.metadata.init.artwork, [
    {
      src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E",
    },
  ]);
});

test("destroy prevents reacquisition and a never-owned release is a no-op", () => {
  const untouchedSession = new FakeMediaSession();
  const untouched = createHarness({ session: untouchedSession }).bridge;
  untouched.release();
  assert.deepEqual(untouchedSession.actionCalls, []);
  assert.deepEqual(untouchedSession.metadataWrites, []);
  assert.deepEqual(untouchedSession.playbackWrites, []);
  assert.deepEqual(untouchedSession.positionCalls, []);

  const { bridge, session } = createHarness();
  activate(bridge);
  bridge.destroy();
  const counts = {
    actions: session.actionCalls.length,
    metadata: session.metadataWrites.length,
  };
  assert.equal(activate(bridge, { title: "Must not return" }), false);
  assert.deepEqual(
    {
      actions: session.actionCalls.length,
      metadata: session.metadataWrites.length,
    },
    counts,
  );
});

test("player owns one Linux bridge and routes OS commands only to WaveLink controls", () => {
  assert.match(
    playerSource,
    /from ["']\.\/linuxMediaSession["']/,
    "player must import the isolated Linux-only bridge",
  );
  assert.match(
    playerSource,
    /createLinuxMediaSessionBridge\s*\(\s*\{[\s\S]*?play:\s*\(\)\s*=>\s*this\.play\(\)[\s\S]*?pause:\s*\(\)\s*=>\s*this\.pause\(\)[\s\S]*?stop:\s*\(\)\s*=>\s*this\.stop\(\)[\s\S]*?next:\s*\(\)\s*=>\s*this\.next\(\)[\s\S]*?previous:\s*\(\)\s*=>\s*this\.prev\(\)/,
  );
  assert.doesNotMatch(
    bridgeSource,
    /\bSpicetify\b/,
    "the OS adapter must never call Spotify's player directly",
  );
});

test("player publishes metadata only for an attached current source before playback", () => {
  const load = sourceSlice(
    playerSource,
    "private async loadTrackInternal(",
    "async loadTrack(track",
  );
  const attachedGuard = load.indexOf("if (!attached || loadId !== this._loadId)");
  const activateIndex = load.indexOf(
    "this.activateLinuxMediaSession(track)",
    attachedGuard,
  );
  const startIndex = load.indexOf("this.startAudio(", attachedGuard);
  assert.ok(attachedGuard >= 0, "load generation needs an attached-source guard");
  assert.ok(
    activateIndex > attachedGuard,
    "failed/stale sources must not replace Linux OS metadata",
  );
  assert.ok(
    startIndex > activateIndex,
    "metadata and action handlers must exist before autoplay begins",
  );

  const projection = sourceSlice(
    playerSource,
    "private activateLinuxMediaSession(track: SCTrack): void",
    "private seekToSeconds(seconds: number): void",
  );
  assert.match(projection, /soundCloudTrackArtworkUrl\(/);
  assert.match(projection, /["']t500x500["']/);
  assert.match(projection, /WAVELINK_TRACK_FALLBACK_ARTWORK/);
  assert.match(projection, /title:\s*track\.title/);
  assert.match(projection, /artist:\s*track\.user\.username/);
});

test("a rejected cover refreshes Linux metadata to the shared WaveLink fallback", () => {
  const coverError = sourceSlice(
    playerSource,
    "private readonly _onCoverImageError",
    "private _panelSurfaces",
  );
  const rejected = coverError.indexOf("this._failedCoverSources.add(");
  const refresh = coverError.indexOf("this.activateLinuxMediaSession(", rejected);
  const visualRefresh = coverError.indexOf("this.applyTrackInfo()", rejected);
  assert.ok(rejected >= 0, "the rejected artwork URL must be remembered");
  assert.ok(
    refresh > rejected,
    "the OS metadata must immediately switch to fallback artwork",
  );
  assert.ok(
    visualRefresh > rejected,
    "Spotify's own WaveLink surfaces must refresh through the same failure path",
  );
});

test("audio lifecycle drives Linux playback and timeline state without the 250ms render loop", () => {
  const events = sourceSlice(
    playerSource,
    "private bindAudioEvents(): void",
    "private muteSpotifyAudio(",
  );
  const eventBlock = (event, nextEvent) =>
    sourceSlice(
      events,
      `this.audio.addEventListener("${event}"`,
      `this.audio.addEventListener("${nextEvent}"`,
    );
  assert.match(
    eventBlock("play", "pause"),
    /this\.linuxMediaSession\.syncPlayback\(\)/,
  );
  assert.match(
    eventBlock("pause", "ended"),
    /this\.linuxMediaSession\.syncPlayback\(\)/,
  );
  for (const [event, nextEvent] of [
    ["loadedmetadata", "durationchange"],
    ["durationchange", "canplay"],
    ["timeupdate", "seeked"],
    ["seeked", "ratechange"],
  ]) {
    assert.match(
      eventBlock(event, nextEvent),
      /this\.linuxMediaSession\.syncPosition\(/,
      `${event} must refresh the exported MPRIS timeline`,
    );
  }

  const timer = sourceSlice(
    playerSource,
    "private startTimer(): void",
    "private stopTimer(): void",
  );
  assert.doesNotMatch(
    timer,
    /linuxMediaSession[\s\S]*?sync(Position|Playback)/,
    "the existing 250ms DOM loop must not spam the OS media service",
  );
});

test("source replacement stays owned, while failure, stop, handoff, and destroy clean up", () => {
  const reset = sourceSlice(
    playerSource,
    "private resetMediaSource(): void",
    "private restoreSpotifyVolumeProfile(): void",
  );
  assert.doesNotMatch(
    reset,
    /linuxMediaSession[\s\S]*?release\(/,
    "A→B WaveLink source replacement must not make the Linux widget flicker",
  );

  const release = sourceSlice(
    playerSource,
    "private releaseSpotifyControl(): void",
    "private restoreNativeBar(): void",
  );
  assert.match(release, /this\.linuxMediaSession\.release\(\)/);

  const fail = sourceSlice(
    playerSource,
    "private failPlayback(message: string): void",
    "private async attachMedia(",
  );
  assert.match(fail, /this\.releaseSpotifyControl\(\)/);

  const stop = sourceSlice(playerSource, "stop(): void", "seek(ratio: number)");
  assert.match(stop, /this\.releaseSpotifyControl\(\)/);

  const handoff = sourceSlice(
    playerSource,
    "private handoffToSpotify(",
    "private hookSpotifyPlayer(): void",
  );
  const stopIndex = handoff.indexOf("this.stop()");
  const spotifyPlayIndex = handoff.indexOf("Spicetify.Player.play()", stopIndex);
  assert.ok(stopIndex >= 0 && spotifyPlayIndex > stopIndex);

  const destroy = sourceSlice(
    playerSource,
    "destroy(): void",
    "// Cross-bundle singleton",
  );
  assert.match(destroy, /linuxMediaSession[\s\S]*?destroy\(/);
});
