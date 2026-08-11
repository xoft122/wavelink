import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [appCss, appSource, navigationSource] = await Promise.all([
  readFile(new URL("../src/styles/app.css", import.meta.url), "utf8"),
  readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
  readFile(
    new URL("../src/components/Navigation.tsx", import.meta.url),
    "utf8",
  ),
]);

function sourceSlice(startMarker, endMarker) {
  const start = appCss.indexOf(startMarker);
  const end = appCss.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing CSS marker: ${startMarker}`);
  assert.ok(end > start, `Missing CSS marker after ${startMarker}`);
  return appCss.slice(start, end);
}

test("topbar responds to the WaveLink pane instead of the Spotify viewport", () => {
  const shellRule = sourceSlice(".wl-shell {", ".wl-topbar {");
  assert.match(shellRule, /container-name:\s*wavelink-shell;/);
  assert.match(shellRule, /container-type:\s*inline-size;/);

  const responsiveHeader = sourceSlice(
    "@container wavelink-shell (max-width: 1100px)",
    "@media (max-width: 1100px)",
  );
  assert.match(responsiveHeader, /@container wavelink-shell/);
  assert.match(
    responsiveHeader,
    /\.wl-topbar\s*\{[\s\S]*?grid-template-columns:/,
  );
  const topbarRule = sourceSlice(".wl-topbar {", ".wl-guest-shell .wl-topbar {");
  assert.match(topbarRule, /width:\s*100%;/);
  assert.match(topbarRule, /min-width:\s*0;/);
});

test("topbar sheds secondary labels progressively before navigation compacts", () => {
  const compact = sourceSlice(
    "@container wavelink-shell (max-width: 980px)",
    "@container wavelink-shell (max-width: 880px)",
  );
  const account = sourceSlice(
    "@container wavelink-shell (max-width: 880px)",
    "@container wavelink-shell (max-width: 760px)",
  );
  const brand = sourceSlice(
    "@container wavelink-shell (max-width: 760px)",
    "@container wavelink-shell (max-width: 620px)",
  );

  assert.match(compact, /\.wl-brand small\s*\{[\s\S]*?display:\s*none;/);
  assert.match(account, /\.wl-user-chip span\s*\{[\s\S]*?display:\s*none;/);
  assert.match(
    account,
    /grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto;/,
  );
  assert.match(brand, /\.wl-brand > span\s*\{[\s\S]*?display:\s*none;/);
});

test("very narrow panes use bounded icon controls without overflowing their pills", () => {
  const narrow = sourceSlice(
    "@container wavelink-shell (max-width: 620px)",
    "@container wavelink-shell (max-width: 430px)",
  );
  const tiny = sourceSlice(
    "@container wavelink-shell (max-width: 430px)",
    "@media (max-width: 1100px)",
  );

  assert.match(narrow, /\.wl-nav__item span\s*\{[\s\S]*?display:\s*none;/);
  assert.match(
    narrow,
    /\.wl-nav__item\s*\{[\s\S]*?width:\s*35px;[\s\S]*?padding:\s*0;/,
  );
  assert.match(
    narrow,
    /\.wl-user-chip\s*\{[\s\S]*?padding:\s*2px;/,
  );
  assert.match(tiny, /\.wl-nav\s*\{[\s\S]*?width:\s*100%;[\s\S]*?justify-self:\s*stretch;/);
  assert.match(tiny, /\.wl-nav__item\s*\{[\s\S]*?flex:\s*1 1 0;/);
});

test("icon-only header controls retain accessible and hover-visible names", () => {
  assert.match(navigationSource, /aria-label=\{item\.label\}/);
  assert.match(navigationSource, /title=\{item\.label\}/);
  assert.match(appSource, /aria-label="Open WaveLink Home"/);
  assert.match(
    appSource,
    /aria-label=\{`Open \$\{user\.username\} SoundCloud profile`\}/,
  );
});

test("viewport media queries no longer own authenticated header geometry", () => {
  const viewportResponsive = sourceSlice(
    "@media (max-width: 1100px)",
    "@media (prefers-reduced-motion: reduce)",
  );
  assert.doesNotMatch(
    viewportResponsive,
    /^  \.wl-(?:topbar|nav(?:__item)?|user-chip|brand)(?:\s|,|\{)/m,
  );
});
