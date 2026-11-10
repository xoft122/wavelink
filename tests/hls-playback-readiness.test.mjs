import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const [helperSource, playerSource] = await Promise.all([
  readFile(new URL("../src/services/hlsPlayback.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
]);

const compiledHelper = ts.transpileModule(helperSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const helper = await import(
  `data:text/javascript;base64,${Buffer.from(compiledHelper).toString("base64")}`
);

function sourceSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

test("SourceBuffer codec creation failures are classified as terminal", () => {
  assert.equal(helper.isHlsSourceBufferCodecError("bufferAddCodecError"), true);
  assert.equal(
    helper.isHlsSourceBufferCodecError("bufferIncompatibleCodecsError"),
    true,
  );
  assert.equal(helper.isHlsSourceBufferCodecError("bufferAppendingError"), false);
  assert.equal(helper.isHlsSourceBufferCodecError("fragLoadError"), false);
  assert.equal(helper.isHlsSourceBufferCodecError(undefined), false);
});

test("attachMedia waits for a real SourceBuffer instead of only a manifest", () => {
  const attach = sourceSlice(
    playerSource,
    "private async attachMedia(",
    "// ── Timer",
  );

  assert.match(attach, /hls\.on\(Hls\.Events\.BUFFER_CREATED/);
  assert.doesNotMatch(attach, /hls\.on\(Hls\.Events\.MANIFEST_PARSED/);

  const readyIndex = attach.indexOf("Hls.Events.BUFFER_CREATED");
  const resolveIndex = attach.indexOf("resolve(true)", readyIndex);
  assert.ok(
    readyIndex >= 0 && resolveIndex > readyIndex,
    "HLS setup must resolve only after SourceBuffer creation",
  );
});

test("Spotify HLS uses standard MSE and destroyed stale attempts settle immediately", () => {
  const attach = sourceSlice(
    playerSource,
    "private async attachMedia(",
    "// ── Timer",
  );

  assert.match(attach, /preferManagedMediaSource:\s*false/);
  const destroyingIndex = attach.indexOf("Hls.Events.DESTROYING");
  const staleResolveIndex = attach.indexOf("resolve(false)", destroyingIndex);
  assert.ok(
    destroyingIndex >= 0 && staleResolveIndex > destroyingIndex,
    "destroying a superseded HLS instance must settle its attachment as stale",
  );
  assert.match(
    attach.slice(destroyingIndex, staleResolveIndex),
    /window\.clearTimeout\(timeout\)/,
  );
});

test("bufferAddCodecError bypasses both the fatal guard and media recovery", () => {
  const attach = sourceSlice(
    playerSource,
    "private async attachMedia(",
    "// ── Timer",
  );
  const errorHandlerStart = attach.indexOf("hls.on(Hls.Events.ERROR");
  const errorHandler = attach.slice(errorHandlerStart);
  const codecGuard = errorHandler.indexOf("isHlsSourceBufferCodecError(data.details)");
  const fatalGuard = errorHandler.indexOf("if (!data.fatal) return");
  const mediaRecovery = errorHandler.indexOf("hls.recoverMediaError()");

  assert.ok(errorHandlerStart >= 0, "missing hls.js error handler");
  assert.ok(codecGuard >= 0, "missing terminal SourceBuffer error guard");
  assert.ok(
    codecGuard < fatalGuard,
    "the initially non-fatal bufferAddCodecError must be handled before the fatal guard",
  );
  assert.ok(
    fatalGuard < mediaRecovery,
    "recoverMediaError must remain limited to later recoverable media errors",
  );

  const codecBranch = errorHandler.slice(codecGuard, fatalGuard);
  assert.match(codecBranch, /hls\.destroy\(\)/);
  assert.match(codecBranch, /reject\(new Error\(message\)\)/);
  assert.doesNotMatch(codecBranch, /recoverMediaError/);
});
