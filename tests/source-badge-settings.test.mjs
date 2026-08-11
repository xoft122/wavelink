import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const modelSource = await readFile(
  new URL("../src/services/sourceBadgeModel.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(modelSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const badge = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const [playerSource, settingsSource, hookSource] = await Promise.all([
  readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  readFile(
    new URL("../src/components/SettingsView.tsx", import.meta.url),
    "utf8",
  ),
  readFile(new URL("../src/hooks/usePlayer.ts", import.meta.url), "utf8"),
]);

test("source indicator preferences normalize persisted values and safe defaults", () => {
  assert.deepEqual(badge.normalizeSourceBadgePreferences(null), {
    enabled: true,
    side: "left",
    dodgeOnHover: false,
    linkEnabled: true,
    displayMode: "icon-text",
    hideWithFullscreenPlayer: false,
  });
  assert.deepEqual(
    badge.normalizeSourceBadgePreferences({
      enabled: "false",
      side: "right",
      dodgeOnHover: "true",
      linkEnabled: false,
      displayMode: "icon-only",
      hideWithFullscreenPlayer: true,
    }),
    {
      enabled: false,
      side: "right",
      dodgeOnHover: true,
      linkEnabled: false,
      displayMode: "icon-only",
      hideWithFullscreenPlayer: true,
    },
  );
  assert.deepEqual(
    badge.normalizeSourceBadgePreferences({
      enabled: "yes",
      side: "center",
      dodgeOnHover: 1,
      linkEnabled: "no",
      displayMode: "large",
      hideWithFullscreenPlayer: {},
    }),
    badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
  );
});

test("hover dodge moves to the opposite side only while enabled", () => {
  assert.equal(badge.oppositeSourceBadgeSide("left"), "right");
  assert.equal(badge.oppositeSourceBadgeSide("right"), "left");
  assert.equal(
    badge.sourceBadgeSideForHomeArea("left", false, true),
    "left",
  );
  assert.equal(
    badge.sourceBadgeSideForHomeArea("left", true, true),
    "right",
  );
  assert.equal(
    badge.sourceBadgeSideForHomeArea("left", true, true),
    "right",
  );
  assert.equal(
    badge.sourceBadgeSideForHomeArea("left", true, false),
    "left",
  );
  assert.equal(
    badge.sourceBadgeSideForHomeArea("right", true, true),
    "left",
  );
  assert.equal(
    badge.sourceBadgeSideForHomeArea("right", true, false),
    "right",
  );
  assert.equal(
    badge.sourceBadgeSideForHomeArea("unexpected", true, false),
    "left",
  );
});

test("fullscreen collapse follows the active playback owner", () => {
  assert.equal(
    badge.sourceBadgeFullscreenPlayerHidden({
      source: "soundcloud",
      soundCloudPlayerHidden: true,
      spotifyPlayerHidden: false,
    }),
    true,
  );
  assert.equal(
    badge.sourceBadgeFullscreenPlayerHidden({
      source: "soundcloud",
      soundCloudPlayerHidden: false,
      spotifyPlayerHidden: true,
    }),
    false,
    "a stale native Spotify class must not hide a SoundCloud indicator",
  );
  assert.equal(
    badge.sourceBadgeFullscreenPlayerHidden({
      source: "spotify",
      soundCloudPlayerHidden: false,
      spotifyPlayerHidden: true,
    }),
    true,
  );
  assert.equal(
    badge.sourceBadgeFullscreenPlayerHidden({
      source: "spotify",
      soundCloudPlayerHidden: true,
      spotifyPlayerHidden: false,
    }),
    false,
    "a stale WaveLink body class must not move a Spotify indicator",
  );
  assert.equal(
    badge.sourceBadgeFullscreenPlayerHidden({
      source: null,
      soundCloudPlayerHidden: true,
      spotifyPlayerHidden: true,
    }),
    false,
  );
});

test("hover dodge uses a stationary padded home zone for returning", () => {
  assert.deepEqual(
    badge.sourceBadgeHomeBounds(
      {
        left: 420,
        top: 620,
        right: 536,
        bottom: 650,
      },
      "left",
      1000,
    ),
    {
      left: 12,
      top: 620,
      right: 128,
      bottom: 650,
    },
  );
  assert.deepEqual(
    badge.sourceBadgeHomeBounds(
      {
        left: 420,
        top: 620,
        right: 536,
        bottom: 650,
      },
      "right",
      1000,
    ),
    {
      left: 872,
      top: 620,
      right: 988,
      bottom: 650,
    },
  );
  const zone = badge.createSourceBadgeHoverZone(
    {
      left: 12,
      top: 620,
      right: 128,
      bottom: 650,
    },
    8,
  );
  assert.deepEqual(zone, {
    left: 4,
    top: 612,
    right: 136,
    bottom: 658,
  });
  assert.equal(
    badge.isPointInsideSourceBadgeHoverZone(zone, 4, 612),
    true,
  );
  assert.equal(
    badge.isPointInsideSourceBadgeHoverZone(zone, 136, 658),
    true,
  );
  assert.equal(
    badge.isPointInsideSourceBadgeHoverZone(zone, 137, 640),
    false,
  );
  assert.equal(
    badge.isPointInsideSourceBadgeHoverZone(zone, Number.NaN, 640),
    false,
  );
  assert.equal(
    badge.createSourceBadgeHoverZone({
      left: 20,
      top: 20,
      right: 20,
      bottom: 30,
    }),
    null,
  );
});

test("disabled and source-less indicators stay hidden", () => {
  const disabled = badge.sourceBadgePresentation(
    {
      ...badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
      enabled: false,
    },
    {
      source: "soundcloud",
      runtimeSide: "left",
      fullscreenPlayerHidden: false,
      soundCloudUrl: "https://soundcloud.com/artist/track",
      trackTitle: "Track",
    },
  );
  assert.equal(disabled.visible, false);
  assert.equal(disabled.href, null);
  assert.equal(disabled.pointerInteractive, false);
  assert.equal(disabled.ariaHidden, true);

  const noSource = badge.sourceBadgePresentation(
    badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
    {
      source: null,
      runtimeSide: "left",
      fullscreenPlayerHidden: false,
    },
  );
  assert.equal(noSource.visible, false);
  assert.equal(noSource.ariaHidden, true);
});

test("only an enabled safe SoundCloud target becomes a link", () => {
  const soundCloud = badge.sourceBadgePresentation(
    badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
    {
      source: "soundcloud",
      runtimeSide: "right",
      fullscreenPlayerHidden: false,
      soundCloudUrl: "https://soundcloud.com/artist/track#comments",
      trackTitle: "Midnight Echo",
    },
  );
  assert.equal(
    soundCloud.href,
    "https://soundcloud.com/artist/track#comments",
  );
  assert.equal(soundCloud.side, "right");
  assert.equal(soundCloud.pointerInteractive, true);
  assert.equal(
    soundCloud.ariaLabel,
    "Open Midnight Echo on SoundCloud",
  );

  const spotify = badge.sourceBadgePresentation(
    badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
    {
      source: "spotify",
      runtimeSide: "left",
      fullscreenPlayerHidden: false,
      soundCloudUrl: "https://soundcloud.com/artist/track",
    },
  );
  assert.equal(spotify.href, null);
  assert.equal(spotify.pointerInteractive, false);

  const dodgeWithoutLink = badge.sourceBadgePresentation(
    {
      ...badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
      dodgeOnHover: true,
      linkEnabled: false,
    },
    {
      source: "soundcloud",
      runtimeSide: "left",
      fullscreenPlayerHidden: false,
      soundCloudUrl: "javascript:alert(1)",
    },
  );
  assert.equal(dodgeWithoutLink.href, null);
  assert.equal(dodgeWithoutLink.pointerInteractive, true);
});

test("icon-only keeps an accessible source name without rendering its label", () => {
  const presentation = badge.sourceBadgePresentation(
    {
      ...badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
      displayMode: "icon-only",
      linkEnabled: false,
    },
    {
      source: "soundcloud",
      runtimeSide: "left",
      fullscreenPlayerHidden: false,
    },
  );
  assert.equal(presentation.labelVisible, false);
  assert.equal(presentation.ariaHidden, false);
  assert.equal(presentation.ariaLabel, "SoundCloud playback source");
});

test("fullscreen collapse either fades the indicator or docks it to the screen edge", () => {
  for (const source of ["soundcloud", "spotify"]) {
    const fading = badge.sourceBadgePresentation(
      {
        ...badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
        hideWithFullscreenPlayer: true,
      },
      {
        source,
        runtimeSide: "left",
        fullscreenPlayerHidden: true,
      },
    );
    assert.equal(fading.fadeWithFullscreenPlayer, true);
    assert.equal(fading.dockAtViewportEdge, false);
    assert.equal(fading.ariaHidden, true);

    const docked = badge.sourceBadgePresentation(
      badge.DEFAULT_SOURCE_BADGE_PREFERENCES,
      {
        source,
        runtimeSide: "right",
        fullscreenPlayerHidden: true,
      },
    );
    assert.equal(docked.fadeWithFullscreenPlayer, false);
    assert.equal(docked.dockAtViewportEdge, true);
    assert.equal(docked.ariaHidden, false);
  }
});

test("Settings and player wire every source indicator preference live", () => {
  for (const label of [
    "Playback source indicator",
    "Show playback source indicator",
    "Bottom left",
    "Bottom right",
    "Icon + text",
    "Icon only",
    "Move to the opposite side on hover",
    "Open SoundCloud track on click",
    "Fade with fullscreen player controls",
  ]) {
    assert.match(settingsSource, new RegExp(label.replace("+", "\\+")));
  }

  for (const setter of [
    "setSourceBadgeEnabled",
    "setSourceBadgeSide",
    "setSourceBadgeDodgeOnHover",
    "setSourceBadgeLinkEnabled",
    "setSourceBadgeDisplayMode",
    "setSourceBadgeHideWithFullscreenPlayer",
  ]) {
    assert.match(settingsSource, new RegExp(`\\b${setter}\\b`));
    assert.match(hookSource, new RegExp(`\\b${setter}\\b`));
    assert.match(playerSource, new RegExp(`\\b${setter}\\s*\\(`));
  }

  for (const storageKey of [
    "wavelink:source-badge-enabled",
    "wavelink:source-badge-position",
    "wavelink:source-badge-dodge-on-hover",
    "wavelink:source-badge-clickable",
    "wavelink:source-badge-display-mode",
    "wavelink:source-badge-hide-with-cinema-player",
  ]) {
    assert.match(playerSource, new RegExp(storageKey));
  }
  assert.match(playerSource, /sourceBadgePreferences:\s*\{\s*\.\.\.this\._sourceBadgePreferences\s*\}/);
});

test("runtime badge rendering returns from its stationary hover zone without oscillation", () => {
  assert.match(
    playerSource,
    /sourceBadgeHomeBounds\(\s*badge\.getBoundingClientRect\(\),\s*this\._sourceBadgePreferences\.side,\s*window\.innerWidth/,
  );
  assert.match(
    playerSource,
    /addEventListener\(\s*"pointermove",\s*this\._onSourceBadgeDocumentPointerMove/,
  );
  assert.match(
    playerSource,
    /isPointInsideSourceBadgeHoverZone\(\s*this\._sourceBadgeHoverReturnZone,\s*event\.clientX,\s*event\.clientY/,
  );
  assert.match(
    playerSource,
    /this\._sourceBadgeHoverReturnZone\s*=\s*null;\s*this\._sourceBadgeRuntimeSide\s*=\s*sourceBadgeSideForHomeArea\(\s*this\._sourceBadgePreferences\.side,[\s\S]{0,120}false,/,
  );
  assert.match(
    playerSource,
    /removeEventListener\(\s*"pointermove",\s*this\._onSourceBadgeDocumentPointerMove/,
  );
  assert.match(
    settingsSource,
    /returns to your selected side automatically/,
  );
  assert.doesNotMatch(
    playerSource,
    /element\.addEventListener\(\s*"pointer(?:enter|leave)",\s*this\._onSourceBadge/,
  );
  assert.doesNotMatch(
    playerSource,
    /#wavelink-source-badge:hover[\s\S]{0,300}(?:left|right|transform)\s*:/,
  );
});

test("runtime badge rendering uses fullscreen presentation classes", () => {
  assert.match(playerSource, /wl-source-badge__label/);
  assert.match(playerSource, /data-display-mode="icon-only"/);
  assert.match(playerSource, /is-fullscreen-hidden/);
  assert.match(playerSource, /is-fullscreen-docked/);
  assert.match(
    playerSource,
    /sourceBadgeFullscreenPlayerHidden\(\{[\s\S]{0,320}soundCloudPlayerHidden:[\s\S]{0,120}"wl-cinema-player-idle"[\s\S]{0,220}spotifyPlayerHidden:[\s\S]{0,160}"Root__cinema-view--controls-hidden"/,
  );
  assert.match(
    playerSource,
    /#wavelink-source-badge\.is-fullscreen-hidden\s*\{[\s\S]{0,140}opacity:\s*0;[\s\S]{0,140}pointer-events:\s*none !important;/,
  );
  assert.match(
    playerSource,
    /#wavelink-source-badge\.is-fullscreen-docked\s*\{[\s\S]{0,120}bottom:\s*max\(12px,/,
  );
});

test("native Spotify fullscreen class changes refresh the badge immediately", () => {
  assert.match(
    playerSource,
    /new MutationObserver\(\s*this\._onSourceBadgeCinemaMutations/,
  );
  assert.match(
    playerSource,
    /observer\.observe\(document\.body,\s*\{\s*childList:\s*true,\s*subtree:\s*true\s*\}\)/,
  );
  assert.match(
    playerSource,
    /observer\.observe\(root,\s*\{\s*attributes:\s*true,\s*attributeFilter:\s*\["class"\]/,
  );
  assert.match(
    playerSource,
    /if \(rootsChanged\) this\.observeSourceBadgeCinemaRoots\(\);[\s\S]{0,180}this\.applySourceBadgePresentation\(\)/,
  );
  assert.match(playerSource, /this\.startSourceBadgeCinemaObserver\(\)/);
  assert.match(playerSource, /this\.stopSourceBadgeCinemaObserver\(\)/);
});

test("native Spotify badge collapse follows Spotify's delayed panel motion", () => {
  assert.match(
    playerSource,
    /#wavelink-source-badge\.sc-badge--spotify:is\([\s\S]{0,140}\.is-fullscreen-hidden,[\s\S]{0,100}\.is-fullscreen-docked[\s\S]{0,120}transition-delay:\s*0ms,\s*0ms,\s*500ms,\s*500ms;/,
  );
  assert.match(
    playerSource,
    /#wavelink-source-badge\.sc-badge--spotify\s*\{[\s\S]{0,100}--wl-cinema-player-fade-ms:\s*300ms;/,
    "Spotify docking must also use the native 300 ms transition duration",
  );
  assert.doesNotMatch(
    playerSource,
    /#wavelink-source-badge\.sc-badge--soundcloud[^{]*\{[^}]*transition-delay:/,
    "WaveLink's own fullscreen timing must remain unchanged",
  );
});
