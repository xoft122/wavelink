import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import { gunzipSync } from "node:zlib";

import ts from "typescript";

const [
  softwareSource,
  playerSource,
  installerSource,
  readmeSource,
  packageSource,
  payloadSource,
  generatorSource,
] = await Promise.all([
  readFile(
    new URL("../src/services/softwareAacPlayback.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  readFile(new URL("../scripts/install.ps1", import.meta.url), "utf8"),
  readFile(new URL("../README.md", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8"),
  readFile(
    new URL(
      "../src/vendor/soundkit/soundkit_wasm_payload.js",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../scripts/generate-soundkit-payload.mjs", import.meta.url),
    "utf8",
  ),
]);

const parserHarnessSource = softwareSource
  .replace(
    /import initSoundKit,[\s\S]*?from "\.\.\/vendor\/soundkit\/soundkit_wasm\.js";/,
    `const initSoundKit = async () => {};
     class WasmAacLcDecoder {}
     class WasmAudioTrackDemuxer {}`,
  )
  .replace(
    /import \{ soundCloudMediaProxyUrl \} from "\.\/directSoundcloud";/,
    `const soundCloudMediaProxyUrl = (value) => {
       const url = new URL(String(value));
       if (
         url.protocol !== "https:" || url.port || url.username || url.password ||
         !(
           url.hostname === "sndcdn.com" ||
           url.hostname.endsWith(".sndcdn.com") ||
           url.hostname === "playback.media-streaming.soundcloud.cloud"
         )
       ) throw new Error("blocked media URL");
       return "https://cors-proxy.spicetify.app/" + url;
     };`,
  )
  .replace(
    /import \{[\s\S]*?SOUNDKIT_WASM_GZIP_BASE64,[\s\S]*?SOUNDKIT_WASM_SIZE,[\s\S]*?\} from "\.\.\/vendor\/soundkit\/soundkit_wasm_payload\.js";/,
    `const SOUNDKIT_WASM_GZIP_BASE64 = "";
     const SOUNDKIT_WASM_SIZE = 0;`,
  );
const parserCompiled = ts.transpileModule(parserHarnessSource + "\nexport { decodeAacOperation };", {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const software = await import(
  `data:text/javascript;base64,${Buffer.from(parserCompiled).toString("base64")}`
);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function runtimeHarness(segmentCount = 1) {
  const starts = [];
  const nodes = [];
  const events = [];
  const fatal = [];
  const media = new EventTarget();
  media.volume = 1;
  media.muted = false;
  for (const type of ["play", "playing", "pause", "waiting", "ended"]) {
    media.addEventListener(type, () => events.push(type));
  }
  const context = {
    currentTime: 0,
    state: "running",
    destination: {},
    createGain() {
      return {
        gain: { setValueAtTime() {} },
        connect() {},
        disconnect() {},
      };
    },
    createBufferSource() {
      const node = {
        buffer: null,
        onended: null,
        connect() {},
        disconnect() {},
        stop() {},
        start(when, offset) {
          starts.push({ when, offset });
        },
      };
      nodes.push(node);
      return node;
    },
    async resume() {
      context.state = "running";
    },
    async close() {},
  };
  const segments = Array.from({ length: segmentCount }, (_, index) => ({
    index,
    url: `https://cf-hls-media.sndcdn.com/${index}.m4s`,
    start: index * 10,
    duration: 10,
  }));
  const playback = new software.SoftwareAacPlayback(
    {
      mediaElement: media,
      audioContext: context,
      sourceUrl: "https://playback.media-streaming.soundcloud.cloud/list.m3u8",
      rendition: 96,
      onFatalError: (message) => fatal.push(message),
    },
    {
      initUrl: "https://cf-hls-media.sndcdn.com/init.mp4",
      duration: segmentCount * 10,
      segments,
    },
    new Uint8Array([1]),
    context,
  );
  const decoded = (index) => ({
    index,
    start: index * 10,
    duration: 10,
    buffer: { duration: 10 },
  });
  return { context, decoded, events, fatal, media, nodes, playback, starts };
}

const nativeWindow = globalThis.window;
globalThis.window = {
  setInterval: () => 1,
  clearInterval: () => undefined,
};

test("SoundCloud AAC VOD manifests preserve the init map and full timeline", () => {
  const sourceUrl =
    "https://playback.media-streaming.soundcloud.cloud/media/playlist.m3u8?Policy=signed";
  const parsed = software.parseSoftwareAacManifest(
    [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      '#EXT-X-MAP:URI="init.mp4?token=a,b"',
      "#EXTINF:10.005,",
      "segment-0.m4s?token=one",
      "#EXTINF:9.995,",
      "https://cf-hls-media.sndcdn.com/media/segment-1.m4s?token=two",
      "#EXT-X-ENDLIST",
    ].join("\n"),
    sourceUrl,
  );

  assert.equal(
    parsed.initUrl,
    "https://playback.media-streaming.soundcloud.cloud/media/init.mp4?token=a,b",
  );
  assert.equal(parsed.duration, 20);
  assert.deepEqual(
    parsed.segments.map(({ index, start, duration }) => ({
      index,
      start,
      duration,
    })),
    [
      { index: 0, start: 0, duration: 10.005 },
      { index: 1, start: 10.005, duration: 9.995 },
    ],
  );
});

test("software AAC manifest validation rejects live, encrypted and foreign media", () => {
  const sourceUrl =
    "https://playback.media-streaming.soundcloud.cloud/media/playlist.m3u8";
  const base = [
    "#EXTM3U",
    '#EXT-X-MAP:URI="init.mp4"',
    "#EXTINF:10,",
    "segment.m4s",
  ];
  assert.throws(
    () => software.parseSoftwareAacManifest(base.join("\n"), sourceUrl),
    /finite SoundCloud stream/,
  );
  assert.throws(
    () =>
      software.parseSoftwareAacManifest(
        [...base.slice(0, 1), '#EXT-X-KEY:METHOD=AES-128,URI="key"', ...base.slice(1), "#EXT-X-ENDLIST"].join("\n"),
        sourceUrl,
      ),
    /Encrypted SoundCloud HLS/,
  );
  assert.throws(
    () =>
      software.parseSoftwareAacManifest(
        [
          "#EXTM3U",
          '#EXT-X-MAP:URI="https://example.com/init.mp4"',
          "#EXTINF:10,",
          "segment.m4s",
          "#EXT-X-ENDLIST",
        ].join("\n"),
        sourceUrl,
      ),
    /blocked media URL/,
  );
  for (const unsupportedTag of [
    "#EXT-X-BYTERANGE:100@0",
    "#EXT-X-GAP",
    "#EXT-X-DISCONTINUITY",
  ]) {
    assert.throws(
      () =>
        software.parseSoftwareAacManifest(
          [
            "#EXTM3U",
            '#EXT-X-MAP:URI="init.mp4"',
            "#EXTINF:10,",
            unsupportedTag,
            "segment.m4s",
            "#EXT-X-ENDLIST",
          ].join("\n"),
          sourceUrl,
        ),
      /not supported/,
    );
  }
});

test("software AAC scheduling seeks once and keeps future segments aligned", () => {
  const resumed = software.calculateSoftwareAacSegmentSchedule(
    100,
    100.035,
    5,
    0,
    10,
  );
  assert.ok(Math.abs(resumed.when - 100.01) < 1e-9);
  assert.ok(Math.abs(resumed.offset - 4.975) < 1e-9);
  assert.deepEqual(
    software.calculateSoftwareAacSegmentSchedule(100, 100.035, 5, 10, 10),
    { when: 105.035, offset: 0 },
  );
});

test("pause cancels a software AAC play still waiting for decode", async () => {
  const harness = runtimeHarness();
  const gate = deferred();
  harness.playback.ensureDecoded = () => gate.promise;
  const pendingPlay = harness.playback.play();
  harness.playback.pause();
  gate.resolve(harness.decoded(0));
  await assert.rejects(
    pendingPlay,
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(harness.starts.length, 0);
  assert.deepEqual(harness.events, []);
  harness.playback.destroy();
});

test("pause cancels a software AAC play while AudioContext resumes", async () => {
  const harness = runtimeHarness();
  const gate = deferred();
  harness.playback.decoded.set(0, harness.decoded(0));
  harness.context.state = "suspended";
  harness.context.resume = async () => {
    await gate.promise;
    harness.context.state = "running";
  };
  const pendingPlay = harness.playback.play();
  await Promise.resolve();
  harness.playback.pause();
  gate.resolve();
  await assert.rejects(
    pendingPlay,
    (error) => error instanceof DOMException && error.name === "AbortError",
  );
  assert.equal(harness.starts.length, 0);
  assert.deepEqual(harness.events, []);
  harness.playback.destroy();
});

test("software AAC underrun freezes time and resumes the immediate segment", async () => {
  const harness = runtimeHarness(2);
  const nextGate = deferred();
  harness.playback.decoded.set(0, harness.decoded(0));
  harness.playback.ensureDecoded = (index) =>
    index === 1 ? nextGate.promise : Promise.resolve(harness.decoded(index));
  harness.playback._paused = false;
  harness.playback.anchorContextSeconds = 0;
  harness.playback.anchorPositionSeconds = 0;
  harness.playback.scheduleAvailable();
  assert.equal(harness.nodes.length, 1);

  harness.context.currentTime = 10.1;
  harness.nodes[0].onended();
  assert.equal(harness.playback.buffering, true);
  assert.equal(harness.playback.currentTime, 10);
  assert.deepEqual(harness.events, ["waiting"]);

  harness.context.currentTime = 15;
  assert.equal(harness.playback.currentTime, 10);
  const next = harness.decoded(1);
  harness.playback.decoded.set(1, next);
  nextGate.resolve(next);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.playback.buffering, false);
  assert.equal(harness.nodes.length, 2);
  assert.ok(Math.abs(harness.starts[1].offset) < 1e-9);
  assert.deepEqual(harness.events, ["waiting", "playing"]);
  harness.playback.destroy();
});

test("player selects bundled AAC only when Spotify lacks native AAC MSE", () => {
  const attachStart = playerSource.indexOf("private async attachMedia(");
  const attachEnd = playerSource.indexOf("// ── Timer", attachStart);
  const attach = playerSource.slice(attachStart, attachEnd);
  assert.match(
    attach,
    /MediaSource\.isTypeSupported\('audio\/mp4; codecs="mp4a\.40\.2"'\)/,
  );
  assert.match(attach, /source\.codec === "aac" && !nativeAacMseSupported/);
  assert.match(attach, /SoftwareAacPlayback\.create\(/);
  assert.match(attach, /audioContext: this\.ensureSoftwareAacContext\(\)/);
  assert.match(attach, /softwareAac\.notifyReady\(\)/);
  assert.match(playerSource, /installSoftwareAacMediaFacade\(this\.audio/);
  assert.match(playerSource, /this\.softwareAac\?\.syncGain\(\)/);
  assert.match(playerSource, /if \(autoPlay\) this\.primeSoftwareAacOutput\(\)/);
  assert.match(playerSource, /this\._onSoftwareAacUnlockIntent/);
  assert.match(softwareSource, /Promise\.all\(\[this\.ensureDecoded\(index\), resume\]\)/);
});

test("WASM string failures become typed AAC decode errors with their real message", () => {
  assert.throws(
    () => software.decodeAacOperation(() => { throw "invalid AAC bitstream: invalid fill element length"; }),
    error => error instanceof software.SoftwareAacDecodeError &&
      /invalid fill element length/.test(error.message),
  );
  assert.equal(software.decodeAacOperation(() => 42), 42);
});

function playerAttachHarness(create) {
  const parsed = ts.createSourceFile("player.ts", playerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const player = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "SoundCloudPlayer");
  const methods = ["attachMedia", "handleSoftwareAacFailure", "playbackResumePositionMs", "applyPendingPlaybackResumeSeek", "pause"].map(name =>
    player.members.find(node => node.name?.getText(parsed) === name).getText(parsed),
  );
  const code = ts.transpileModule(`class Harness { ${methods.join("\n")} }\nreturn Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const requests = [];
  const Harness = new Function("createMediaSession", "MediaSource", "SoftwareAacPlayback", "SoftwareAacDecodeError", "trackKey", "warn", "log", "resumePositionSeconds", code)(
    async (track, options) => {
      requests.push({ track: track.id, ...options });
      const order = options.preferStandardAac ? [96, 160] : [160, 96];
      const aacRendition = order.find((rendition) => rendition !== options.excludeAacRendition);
      return { kind: "hls", codec: "aac", url: `aac${aacRendition}`, aacRendition };
    },
    { isTypeSupported: () => false },
    { create },
    software.SoftwareAacDecodeError,
    track => track.id,
    () => {},
    () => {},
    (positionMs, durationMs) => positionMs >= durationMs - 5000 ? 0 : positionMs / 1000,
  );
  const harness = new Harness();
  harness.audio = { paused: true, currentTime: 0, readyState: 0, pause() { this.paused = true; } };
  harness._loadId = 1;
  harness._softwareAacFallbackTracks = new Map();
  harness.resetMediaSource = () => {
    harness.softwareAac?.destroy();
    harness.softwareAac = null;
    harness.audio.paused = true;
    harness.audio.currentTime = 0;
    harness.audio.readyState = 0;
  };
  harness.ensureSoftwareAacContext = () => ({});
  harness.emit = () => {};
  harness.syncSpotifyProgress = () => {};
  harness.persistPlaybackResume = () => {};
  return { harness, requests };
}

test("software playback starts directly with the compatible AAC rendition", async () => {
  const opened = [];
  const { harness, requests } = playerAttachHarness(async options => {
    opened.push(options.rendition);
    return { rendition: options.rendition, notifyReady() {}, destroy() {} };
  });
  assert.equal(await harness.attachMedia({ id: "stromae-instrumental" }, 1), true);
  assert.deepEqual(opened, [96], "the software decoder must never start this track on AAC160 first");
  assert.equal(requests[0].preferStandardAac, true);
  assert.equal(requests[0].excludeAacRendition, undefined);
});

test("AAC decode fallback retries a distinct rendition and remembers only the affected track", async () => {
  let ready = 0;
  const { harness, requests } = playerAttachHarness(async options => {
    if (options.rendition === 96) throw new software.SoftwareAacDecodeError("invalid fill element length");
    return { notifyReady() { ready++; }, destroy() {} };
  });
  const track = { id: "incompatible-standard", title: "AAC fallback fixture", duration: 176060 };
  assert.equal(await harness.attachMedia(track, 1), true);
  assert.deepEqual(requests.map(r => r.excludeAacRendition), [undefined, 96]);
  assert.equal(ready, 1);
  await harness.attachMedia(track, 1);
  assert.equal(requests.at(-1).excludeAacRendition, 96, "replaying the affected track must start on the known working rendition");
  assert.equal(harness._softwareAacFallbackTracks.has("other-track"), false);
});

test("AAC fallback is bounded and does not retry networking or stale failures", async () => {
  const failed = playerAttachHarness(async () => { throw new software.SoftwareAacDecodeError("bad frame"); });
  await assert.rejects(failed.harness.attachMedia({ id: "bad" }, 1), software.SoftwareAacDecodeError);
  assert.equal(failed.requests.length, 2, "a broken alternate rendition must not recurse forever");

  const network = playerAttachHarness(async () => { throw new Error("SoundCloud media request failed (503)."); });
  await assert.rejects(network.harness.attachMedia({ id: "network" }, 1), /503/);
  assert.equal(network.requests.length, 1);
  assert.equal(network.harness._softwareAacFallbackTracks.size, 0);

  const stale = playerAttachHarness(async () => {
    stale.harness._loadId = 2;
    throw new software.SoftwareAacDecodeError("superseded frame");
  });
  assert.equal(await stale.harness.attachMedia({ id: "stale" }, 1), false);
  assert.equal(stale.requests.length, 1);
  assert.equal(stale.harness._softwareAacFallbackTracks.size, 0);
});

test("a late prefetch error retains its decode type and is reported only once", async () => {
  const runtime = runtimeHarness(7);
  const error = new software.SoftwareAacDecodeError("invalid fill element length");
  runtime.playback.decodeSegment = async (index) => {
    if (index === 4) throw error;
    return runtime.decoded(index);
  };
  await runtime.playback.play();
  assert.equal(runtime.playback.paused, false);
  await runtime.playback.prefetchAround(1, runtime.playback.operationGeneration);
  await runtime.playback.prefetchAround(1, runtime.playback.operationGeneration);
  assert.deepEqual(runtime.fatal, [error]);
  runtime.playback.destroy();
});

test("late AAC failure swaps media once, resumes at the same time and keeps the queue load", async () => {
  const track = { id: "stromae-instrumental", title: "Tous Les Mêmes", duration: 231000 };
  const opened = [];
  const resumes = [];
  const failures = [];
  const { harness, requests } = playerAttachHarness(async (options) => {
    opened.push(options);
    return {
      paused: options.rendition === 160,
      rendition: options.rendition,
      destroy() {},
      notifyReady() {
        harness.audio.readyState = 4;
        harness.audio.duration = 231;
        harness.applyPendingPlaybackResumeSeek();
      },
    };
  });
  harness._track = track;
  harness._historyAttemptedLoadId = 1;
  harness.queue = [track];
  const queue = harness.queue;
  harness.startAudio = async (loadId) => resumes.push([loadId, harness.audio.currentTime]);
  harness.failPlayback = (message) => failures.push(message);
  await harness.attachMedia(track, 1);
  // Restarting a saved near-end session is fine; a live recovery must not
  // replay the entire track instead of finishing it.
  harness.audio.currentTime = 227.285;
  const error = new software.SoftwareAacDecodeError("invalid fill element length");
  opened[0].onFatalError(error);
  opened[0].onFatalError(error);
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(requests.map(r => r.excludeAacRendition), [undefined, 96]);
  assert.deepEqual(resumes, [[1, 227.285]]);
  assert.deepEqual(failures, []);
  assert.equal(harness._isLoading, false);
  assert.equal(harness._historyAttemptedLoadId, 1);
  assert.equal(harness.queue, queue);

  opened[1].onFatalError(error);
  assert.equal(requests.length, 2, "an alternate-rendition failure is terminal");
  assert.match(failures[0], /invalid fill element length/);
});

test("AAC recovery honors pause and does not take over a newer track", async () => {
  for (const change of ["paused", "pause-during-retry", "new-track"]) {
    const gate = deferred();
    const preparingAlternate = deferred();
    const track = { id: "1", title: "First track", duration: 30000 };
    let fatal;
    let starts = 0;
    let alternativeDestroyed = false;
    const { harness } = playerAttachHarness(async (options) => {
      if (options.rendition === 96) {
        fatal = options.onFatalError;
        return { rendition: options.rendition, paused: change === "paused", notifyReady() {}, destroy() {} };
      }
      preparingAlternate.resolve();
      await gate.promise;
      return {
        rendition: options.rendition,
        notifyReady() { harness.audio.readyState = 4; harness.audio.duration = 30; },
        destroy() { alternativeDestroyed = true; },
      };
    });
    harness._track = track;
    harness.startAudio = async () => { starts++; };
    harness.failPlayback = assert.fail;
    await harness.attachMedia(track, 1);
    harness.audio.currentTime = 6;
    fatal(new software.SoftwareAacDecodeError("invalid bitstream"));
    await preparingAlternate.promise;
    if (change === "pause-during-retry") harness.pause();
    if (change === "new-track") {
      harness._loadId = 2;
      harness._track = { id: "2" };
    }
    gate.resolve();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(starts, 0);
    assert.equal(alternativeDestroyed, change === "new-track");
    if (change !== "new-track") assert.equal(harness.audio.currentTime, 6);
  }
});

test("bundled WASM decoder is embedded without an XPUI asset fetch", async () => {
  const wasmUrl = new URL(
    "../src/vendor/soundkit/soundkit_wasm_bg.wasm",
    import.meta.url,
  );
  const wasm = await readFile(wasmUrl);
  const metadata = await stat(wasmUrl);
  assert.deepEqual(Array.from(wasm.subarray(0, 4)), [0x00, 0x61, 0x73, 0x6d]);
  assert.ok(metadata.size > 100_000 && metadata.size < 8 * 1024 * 1024);

  const base64 = payloadSource.match(
    /SOUNDKIT_WASM_GZIP_BASE64\s*=\s*"([A-Za-z0-9+/=]+)"/,
  )?.[1];
  const size = Number(
    payloadSource.match(/SOUNDKIT_WASM_SIZE\s*=\s*(\d+)/)?.[1],
  );
  const sha256 = payloadSource.match(
    /SOUNDKIT_WASM_SHA256\s*=\s*"([a-f0-9]{64})"/,
  )?.[1];
  assert.ok(base64, "generated embedded SoundKit payload is missing");
  const embedded = gunzipSync(Buffer.from(base64, "base64"));
  assert.equal(size, wasm.byteLength);
  assert.deepEqual(embedded, wasm);
  assert.equal(createHash("sha256").update(embedded).digest("hex"), sha256);

  assert.match(softwareSource, /new DecompressionStream\("gzip"\)/);
  assert.match(softwareSource, /initSoundKit\(\{ module_or_path: bytes \}\)/);
  assert.doesNotMatch(softwareSource, /soundKitWasmUrl|fetch\([^)]*soundkit/i);
  assert.doesNotMatch(readmeSource, /dist\/soundkit_wasm_bg\.wasm/);
  assert.doesNotMatch(
    installerSource,
    /@\([^)]*"soundkit_wasm_bg\.wasm"[^)]*\)/,
  );
  assert.match(installerSource, /\$obsoleteDecoderAsset/);
  assert.match(generatorSource, /dist\/soundkit_wasm_bg\.wasm/);
  assert.match(generatorSource, /rm\(obsoleteDistAsset, \{ force: true \}\)/);
  const scripts = JSON.parse(packageSource).scripts;
  assert.equal(scripts.prebuild, "node scripts/generate-soundkit-payload.mjs");
  assert.equal(scripts.prewatch, "node scripts/generate-soundkit-payload.mjs");
  assert.equal(
    scripts["prebuild:install"],
    "node scripts/generate-soundkit-payload.mjs",
  );
  assert.equal(scripts.postbuild, undefined);
  assert.equal(scripts["postbuild:install"], undefined);
});

test.after(() => {
  if (nativeWindow === undefined) delete globalThis.window;
  else globalThis.window = nativeWindow;
});
