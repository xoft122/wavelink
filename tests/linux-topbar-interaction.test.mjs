import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const [interactionSource, appSource, appCss] = await Promise.all([
  readFile(
    new URL("../src/services/topbarInteraction.ts", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/styles/app.css", import.meta.url), "utf8"),
]);
const compiled = ts.transpileModule(interactionSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const interaction = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function fakeBody() {
  const tokens = new Set();
  return {
    tokens,
    classList: {
      add(token) {
        tokens.add(token);
      },
      remove(token) {
        tokens.delete(token);
      },
      contains(token) {
        return tokens.has(token);
      },
    },
  };
}

function isolationCss() {
  const startMarker = "/* WaveLink native topbar isolation";
  const endMarker = "/* end WaveLink native topbar isolation */";
  const start = appCss.indexOf(startMarker);
  const end = appCss.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0 && end > start);
  return appCss.slice(start, end + endMarker.length);
}

test("the body marker has reference-counted and idempotent ownership", () => {
  const body = fakeBody();
  assert.equal(body.classList.contains("wl-header-interactive"), false);

  const releaseApp = interaction.acquireWaveLinkHeaderInteraction(body);
  const releaseRemount = interaction.acquireWaveLinkHeaderInteraction(body);
  assert.equal(body.classList.contains("wl-header-interactive"), true);

  releaseApp();
  releaseApp();
  assert.equal(body.classList.contains("wl-header-interactive"), true);

  releaseRemount();
  assert.equal(body.classList.contains("wl-header-interactive"), false);
});

test("AccountShell owns the marker for its exact mounted lifetime", () => {
  assert.match(
    appSource,
    /useLayoutEffect\(\s*\(\) => acquireWaveLinkHeaderInteraction\(document\.body\),\s*\[\],\s*\);/,
  );
});

test("the active route removes both native Linux hit-test overlays", () => {
  const css = isolationCss();
  assert.match(
    css,
    /body\.wl-header-interactive \.body-drag-top,[\s\S]{0,180}body\.wl-header-interactive \.main-topBar-container[\s\S]{0,220}display:\s*none !important;/,
  );
  assert.match(
    css,
    /\.main-topBar-container \*,[\s\S]{0,180}\.main-topBar-background[\s\S]{0,220}pointer-events:\s*none !important;/,
  );
  assert.match(css, /-webkit-app-region:\s*no-drag !important;/);
});

test("WaveLink controls remain explicit top-layer pointer targets", () => {
  const css = isolationCss();
  assert.match(
    css,
    /body\.wl-header-interactive \.wl-topbar,[\s\S]{0,220}:is\(button, a, input, select, textarea, \[role="button"\]\)[\s\S]{0,220}pointer-events:\s*auto !important;/,
  );
});

test("native overlay changes are marker-scoped and do not depend on :has", () => {
  const css = isolationCss();
  assert.doesNotMatch(css, /:has\(/);
  assert.doesNotMatch(css, /(?:^|\})\s*\.body-drag-top\s*\{/);
  assert.doesNotMatch(
    css,
    /(?:^|\})\s*\.main-topBar-container(?:\s*,|\s*\{)/,
  );
  assert.match(css, /body\.wl-header-interactive \.body-drag-top/);
});
