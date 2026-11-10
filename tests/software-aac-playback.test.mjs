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
  const method = player.members.find(node => node.name?.getText(parsed) === "attachMedia");
  const code = ts.transpileModule(`class Harness { ${method.getText(parsed)} }\nreturn Harness;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const requests = [];
  const Harness = new Function("createMediaSession", "MediaSource", "SoftwareAacPlayback", "SoftwareAacDecodeError", "trackKey", "warn", code)(
    async (track, options) => {
      requests.push({ track: track.id, fallback: options.excludeHighQualityAac });
      return { kind: "hls", codec: "aac", url: options.excludeHighQualityAac ? "aac96" : "aac160" };
    },
    { isTypeSupported: () => false },
    { create },
    software.SoftwareAacDecodeError,
    track => track.id,
    () => {},
  );
  const harness = new Harness();
  harness.audio = {};
  harness._loadId = 1;
  harness._softwareAacFallbackTracks = new Set();
  harness.resetMediaSource = () => {};
  harness.ensureSoftwareAacContext = () => ({});
  return { harness, requests };
}

test("AAC decode fallback retries once and remembers only the affected track", async () => {
  let ready = 0;
  const { harness, requests } = playerAttachHarness(async options => {
    if (options.sourceUrl === "aac160") throw new software.SoftwareAacDecodeError("invalid fill element length");
    return { notifyReady() { ready++; }, destroy() {} };
  });
  const track = { id: "anime-trip", title: "АНИМЭ ТРИП", duration: 176060 };
  assert.equal(await harness.attachMedia(track, 1), true);
  assert.deepEqual(requests.map(r => r.fallback), [false, true]);
  assert.equal(ready, 1);
  await harness.attachMedia(track, 1);
  assert.equal(requests.at(-1).fallback, true, "replaying the affected track must start on the known working rendition");
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
