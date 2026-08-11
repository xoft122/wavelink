import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [appCss, playlistDetailSource, userProfileSource, playlistsSource] =
  await Promise.all([
    readFile(new URL("../src/styles/app.css", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/PlaylistDetailView.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/UserProfileView.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../src/components/PlaylistsView.tsx", import.meta.url),
      "utf8",
    ),
  ]);
const appCssWithoutComments = appCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** Collect the declarations from every unqualified base rule for a selector. */
function selectorDeclarations(selector) {
  const declarations = [];
  for (const match of appCssWithoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((value) => value.trim());
    if (selectors.includes(selector)) declarations.push(match[2]);
  }
  assert.ok(declarations.length > 0, `Missing CSS rule for ${selector}`);
  return declarations.join("\n");
}

function lastDeclarationValue(declarations, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const values = [
    ...declarations.matchAll(new RegExp(`(?:^|[;\\s])${escaped}\\s*:\\s*([^;]+)`, "g")),
  ].map((match) => match[1].trim());
  assert.ok(values.length > 0, `Missing ${property} declaration`);
  return values.at(-1);
}

function assertSmallStickyOffset(declarations, selector) {
  const top = lastDeclarationValue(declarations, "top");
  const fallback = top.match(/var\([^,]+,\s*([\d.]+)(px|rem)\s*\)/);
  const literal = top.match(/^([\d.]+)(px|rem)$/);
  const match = fallback ?? literal;
  assert.ok(
    match,
    `${selector} must use a measurable small top offset (or a CSS variable with one)`,
  );
  const pixels = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
  assert.ok(
    pixels > 0 && pixels <= 24,
    `${selector} must stay just beneath the WaveLink topbar, not add its height again`,
  );
}

for (const selector of [".wl-back", ".sc-back-btn"]) {
  test(`${selector} stays reachable while its WaveLink view scrolls`, () => {
    const declarations = selectorDeclarations(selector);

    assert.equal(lastDeclarationValue(declarations, "position"), "sticky");
    assertSmallStickyOffset(declarations, selector);

    const zIndex = Number(lastDeclarationValue(declarations, "z-index"));
    assert.ok(Number.isInteger(zIndex) && zIndex > 0, `${selector} needs a positive z-index`);

    const background = lastDeclarationValue(declarations, "background");
    assert.doesNotMatch(background, /^(?:none|transparent)$/i);
    assert.match(declarations, /(?:-webkit-)?backdrop-filter\s*:\s*blur\(/);
    assert.match(lastDeclarationValue(declarations, "border-radius"), /(?:px|rem|%|var\()/);

    assert.equal(lastDeclarationValue(declarations, "pointer-events"), "auto");
    assert.equal(lastDeclarationValue(declarations, "-webkit-app-region"), "no-drag");
  });
}

test("every WaveLink view with an in-page Back control uses a sticky class", () => {
  assert.match(
    playlistDetailSource,
    /<button\s+type="button"\s+className="wl-back"\s+onClick=\{onBack\}>/,
  );
  assert.match(
    userProfileSource,
    /<button\s+type="button"\s+className="wl-back"\s+onClick=\{onBack\}>/,
  );
  assert.match(
    playlistsSource,
    /<button\s+className="sc-back-btn"\s+onClick=\{\(\) => setDetail\(null\)\}>/,
  );
});
