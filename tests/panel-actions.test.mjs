import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/panelActions.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const panelActions = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("classifies only the stale Spotify now-playing actions", () => {
  const cases = [
    ["Copy link to Song", "copy-song"],
    ["Copy link to track", "copy-song"],
    ["Hide in this album", "hide-album"],
    ["Hide from this playlist", "hide-album"],
    ["Add to Liked Songs", "spotify-like"],
    ["Remove from Liked Songs", "spotify-like"],
    ["Add to Your Library", "spotify-like"],
    ["Added to Your Library", "spotify-like"],
    ["Saved to Liked Songs", "spotify-like"],
    ["In Your Library", "spotify-like"],
    // Live Spotify 2.44 NPV snapshot: the green saved/check control exposes
    // this label even though the user perceives it as the liked indicator.
    ["Add to playlist", "spotify-like"],
    ["Remove from playlist", "spotify-like"],
    ["Share", "spotify-share"],
    ["Share track", "spotify-share"],
    ["Share this song", "spotify-share"],
    ["More options", "spotify-more"],
    ["More", "spotify-more"],
    ["More options for this song", "spotify-more"],
    ["More options for cachalot", "spotify-more"],
  ];
  for (const [ariaLabel, expected] of cases) {
    assert.equal(
      panelActions.classifyNativePanelAction({ ariaLabel }),
      expected,
      ariaLabel,
    );
  }

  assert.equal(
    panelActions.classifyNativePanelAction({ testId: "add-button" }),
    "spotify-like",
  );
  assert.equal(
    panelActions.classifyNativePanelAction({ testId: "remove-button" }),
    "spotify-like",
  );
  assert.equal(
    panelActions.classifyNativePanelAction({
      testId: "remove-from-library-button",
    }),
    "spotify-like",
  );
  assert.equal(
    panelActions.classifyNativePanelAction({
      ariaLabel: "Button",
      title: "Saved to Your Library",
    }),
    "spotify-like",
    "a generic aria-label must not mask a useful Spotify title",
  );
  assert.equal(
    panelActions.classifyNativePanelAction({ testId: "copy-track-link" }),
    "copy-song",
  );
  assert.equal(
    panelActions.classifyNativePanelAction({ testId: "share-button" }),
    "spotify-share",
  );
  assert.equal(
    panelActions.classifyNativePanelAction({
      testId: "now-playing-view-share-button",
    }),
    "spotify-share",
  );
  assert.equal(
    panelActions.classifyNativePanelAction({
      className: "Button-sc-y0gtbx-0 main-watchFeed-shareButtonHidden",
    }),
    "spotify-share",
  );
  for (const testId of [
    "more-button",
    "context-menu-button",
    "now-playing-view-more-button",
  ]) {
    assert.equal(
      panelActions.classifyNativePanelAction({ testId }),
      "spotify-more",
      testId,
    );
  }

  for (const ariaLabel of [
    "Copy artist link",
    "Hide announcement",
    "Add to queue",
    "Follow",
    "Play",
    "Open SoundCloud profile",
    "Share artist profile",
    "Open share settings",
  ]) {
    assert.equal(
      panelActions.classifyNativePanelAction({ ariaLabel }),
      null,
      ariaLabel,
    );
  }
});

test("panel Like presentation uses the WaveLink heart and truthful ARIA state", async () => {
  assert.deepEqual(panelActions.WAVELINK_HEART_ICON, {
    viewBox: "0 0 24 24",
    width: 18,
    height: 18,
    path: "M12 21.3C10.8 20.2 3.5 14 3.5 8.5A4.5 4.5 0 0 1 12 6.4a4.5 4.5 0 0 1 8.5 2.1c0 5.5-7.3 11.7-8.5 12.8Z",
    strokeWidth: 1.7,
  });

  assert.deepEqual(panelActions.createPanelLikePresentation(false), {
    ariaLabel: "Like on SoundCloud",
    title: "Like on SoundCloud",
    ariaPressed: "false",
    ariaHasPopup: "dialog",
    ariaBusy: null,
    disabled: false,
    filled: false,
  });
  assert.deepEqual(panelActions.createPanelLikePresentation(true), {
    ariaLabel: "Unlike on SoundCloud",
    title: "Unlike on SoundCloud",
    ariaPressed: "true",
    ariaHasPopup: null,
    ariaBusy: null,
    disabled: false,
    filled: true,
  });
  assert.equal(
    panelActions.createPanelLikePresentation(true, true).disabled,
    true,
  );
  assert.equal(
    panelActions.createPanelLikePresentation(true, true).ariaBusy,
    "true",
  );

  const [trackItem, nowPlaying] = await Promise.all([
    readFile(new URL("../src/components/TrackItem.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/NowPlaying.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(trackItem, /\bWAVELINK_HEART_ICON\b/);
  assert.match(nowPlaying, /\bWAVELINK_HEART_ICON\b/);
});

test("unliked action opens the protected handoff without a mutation", async () => {
  let prompts = 0;
  let unlikes = 0;
  const result = await panelActions.performPanelLikeAction(false, {
    showPrompt: () => {
      prompts += 1;
    },
    unlike: async () => {
      unlikes += 1;
    },
  });
  assert.equal(result, "prompted");
  assert.equal(prompts, 1);
  assert.equal(unlikes, 0);
});

test("liked action performs only SoundCloud Unlike and propagates failure", async () => {
  let prompts = 0;
  let unlikes = 0;
  const result = await panelActions.performPanelLikeAction(true, {
    showPrompt: () => {
      prompts += 1;
    },
    unlike: async () => {
      unlikes += 1;
    },
  });
  assert.equal(result, "unliked");
  assert.equal(prompts, 0);
  assert.equal(unlikes, 1);

  const failure = new Error("SoundCloud rejected Unlike");
  await assert.rejects(
    panelActions.performPanelLikeAction(true, {
      showPrompt: () => {
        throw new Error("prompt must not open for a liked track");
      },
      unlike: async () => {
        throw failure;
      },
    }),
    (error) => error === failure,
  );
});

test("compact and cinema panels share one owned-action lifecycle", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  assert.match(playerSource, /\.Root__cinema-view/);
  assert.match(
    playerSource,
    /for\s*\(\s*const root of panelRoots\s*\)[\s\S]{0,180}\breconcilePanelSurface\s*\(\s*root\s*,/,
  );
  assert.match(playerSource, /\blikeButton:\s*HTMLButtonElement\s*\|\s*null/);
  assert.match(playerSource, /binding\.likeButton\?\.remove\(\)/);
  assert.match(playerSource, /\bhideNativeElement\s*\(\s*nativeAction/);
  assert.match(playerSource, /\breleaseUnusedHiddenNative\s*\(/);
  assert.doesNotMatch(
    playerSource,
    /\blikeTrack\b/,
    "the panel must not attempt SoundCloud's protected Like mutation",
  );
});

test("liked Spotify saved/check action seeds WaveLink takeover", async () => {
  assert.equal(
    panelActions.classifyNativePanelAction({
      ariaLabel: null,
      title: null,
      textContent: "",
      testId: "add-button",
    }),
    "spotify-like",
  );

  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const start = playerSource.indexOf("private findNativePanelActionCluster");
  const end = playerSource.indexOf("private createPanelLikeButton", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const discovery = playerSource.slice(start, end);

  assert.match(discovery, /\bexcludedSections\s*=\s*this\.stalePanelSections/);
  assert.match(discovery, /\bnativePanelActionKind\(\s*element\s*\)/);
  assert.doesNotMatch(
    discovery,
    /nativePanelActionKind\(\s*element\s*,\s*false\s*\)/,
    "saved/check discovery must not discard data-testid",
  );
  assert.match(
    playerSource,
    /\.wl-sc-panel-surface \[data-testid="add-button"\]:not\(\[data-wl-owned\]\)/,
  );
  assert.match(
    playerSource,
    /\.wl-sc-panel-surface \[data-testid="remove-button"\]:not\(\[data-wl-owned\]\)/,
  );
  assert.match(
    playerSource,
    /\.wl-sc-panel-surface \[aria-label="Add to playlist"\]:not\(\[data-wl-owned\]\)/,
  );
  assert.match(
    playerSource,
    /body\.sc-active \.wl-sc-native-hidden\s*\{\s*display:\s*none !important;/,
  );
});

test("WaveLink removes the transient Spotify Share control from every NPV surface", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    playerSource,
    /\.wl-sc-panel-surface \.main-watchFeed-shareButtonHidden:not\(\[data-wl-owned\]\)/,
  );
  assert.match(
    playerSource,
    /\.wl-sc-panel-surface \[data-testid="share-button"\]:not\(\[data-wl-owned\]\)/,
  );
  assert.match(
    playerSource,
    /className:\s*element\.getAttribute\("class"\)/,
  );
});

test("WaveLink removes the top-right Spotify More options control without using it as a Like anchor", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );

  for (const selector of [
    'data-testid="more-button"',
    'data-testid="context-menu-button"',
    'data-testid="now-playing-view-more-button"',
    'aria-label="More options"',
    'aria-label^="More options for "',
  ]) {
    assert.match(
      playerSource,
      new RegExp(`\\.wl-sc-panel-surface \\[${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]:not\\(\\[data-wl-owned\\]\\)`),
      selector,
    );
  }

  const clusterStart = playerSource.indexOf("private findNativePanelActionCluster");
  const clusterEnd = playerSource.indexOf("private createPanelLikeButton", clusterStart);
  const cluster = playerSource.slice(clusterStart, clusterEnd);
  assert.match(cluster, /kind && kind !== "spotify-more"/);

  const reconcileStart = playerSource.indexOf("private reconcilePanelSurface");
  const reconcileEnd = playerSource.indexOf("private releasePanelSurface", reconcileStart);
  const reconcile = playerSource.slice(reconcileStart, reconcileEnd);
  assert.match(reconcile, /nativePanelActionKind\(candidate\) === "spotify-more"/);
  assert.match(reconcile, /hideNativeElement\(candidate, activeHidden\)/);
});

test("replaced panel metadata blocks every nested Spotify link and restores it later", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const start = playerSource.indexOf("private blockNativeInteraction(");
  const end = playerSource.indexOf(
    "private restoreNativeInteraction",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const blocking = playerSource.slice(start, end);

  assert.match(
    blocking,
    /host\.querySelectorAll<HTMLElement>\(\s*selector\s*\)/,
  );
  assert.match(
    blocking,
    /'a, \[href\], button, \[role="link"\], \[role="button"\]'/,
  );
  assert.match(blocking, /if \(elements\.size === 0\) elements\.add\(host\)/);
  assert.match(blocking, /this\.blockNativeInteractionElement\(element, active\)/);
  assert.match(
    blocking,
    /element\.addEventListener\("click", block, true\)/,
  );
  assert.match(
    blocking,
    /element\.addEventListener\("contextmenu", block, true\)/,
    "delegated Spotify artist menus must be stopped at every blocked native anchor/action",
  );
  assert.match(
    playerSource,
    /\.wl-sc-meta-panel > :not\(\.wl-marquee-viewport\) \*/,
  );
  assert.match(playerSource, /pointer-events:\s*none !important;/);

  const restoreStart = playerSource.indexOf(
    "private restoreNativeInteraction",
  );
  const restoreEnd = playerSource.indexOf(
    "private releaseUnusedNativeInteractions",
    restoreStart,
  );
  const restore = playerSource.slice(restoreStart, restoreEnd);
  assert.match(restore, /restoreAttribute\(element, "href", binding\.href\)/);
  assert.match(restore, /element\.removeEventListener\("click", binding\.block, true\)/);
  assert.match(
    restore,
    /element\.removeEventListener\("contextmenu", binding\.block, true\)/,
    "handoff must restore ordinary Spotify right-click behavior",
  );
  assert.match(restore, /\)\.inert = binding\.inert/);
});

test("multi-artist panel discovery always promotes a partial native seed to the whole region", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const collectStart = playerSource.indexOf("private collectMetadataTargets()");
  const collectEnd = playerSource.indexOf(
    "private scheduleMetadataMeasure",
    collectStart,
  );
  assert.notEqual(collectStart, -1);
  assert.notEqual(collectEnd, -1);
  const collect = playerSource.slice(collectStart, collectEnd);

  const artistSeed = collect.indexOf("let artist =");
  const promotion = collect.indexOf("this.findPanelArtistHost(", artistSeed);
  const artistPushMatch = /push\(\s*artist\s*,\s*["']artist["']\s*,\s*["']panel["'](?:\s*,\s*metaRoot)?\s*\)/.exec(
    collect.slice(promotion),
  );
  const artistPush = artistPushMatch
    ? promotion + artistPushMatch.index
    : -1;
  assert.ok(artistSeed >= 0 && promotion > artistSeed && artistPush > promotion);
  const promotionAssignment = collect.lastIndexOf("artist =", promotion);
  const promotionEnd = collect.indexOf("title ??=", promotion);
  assert.ok(
    promotionAssignment >= artistSeed &&
      promotionEnd > promotion &&
      promotionEnd < artistPush,
  );
  const promotionStatement = collect.slice(promotionAssignment, promotionEnd);
  assert.match(
    promotionStatement,
    /artist\s*=\s*this\.findPanelArtistHost\(/,
    "promotion must run even when a semantic selector found only the first artist anchor",
  );
  assert.doesNotMatch(
    promotionStatement,
    /artist\s*\?\?=/,
    "a truthy but too-thin multi-artist seed must not bypass region promotion",
  );
  assert.match(
    promotionStatement,
    /this\.findPanelArtistHost\(\s*panelRoot,\s*native\.title,\s*native\.artists,\s*artist\s*,?\s*\)/,
    "the helper needs the existing semantic/fallback seed so it can expand around every sibling link",
  );

  const helperStart = playerSource.indexOf("private findPanelArtistHost(");
  const helperEnd = playerSource.indexOf("private panelRoots()", helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  const helper = playerSource.slice(helperStart, helperEnd);
  assert.match(helper, /seed(?:Host)?\??:\s*HTMLElement\s*\|\s*null/);
  assert.match(
    helper,
    /a(?:\[href\])?|\[href\]|\[role=["']link["']\]/,
    "promotion must reason about every native artist link, not text width alone",
  );
  assert.match(
    helper,
    /contains\(/,
    "the promoted region must actually enclose the discovered native actions",
  );
  const artistActionsStart = helper.indexOf("const artistActions =");
  const semanticRow = helper.indexOf("const semanticRow =", artistActionsStart);
  assert.ok(artistActionsStart >= 0 && semanticRow > artistActionsStart);
  assert.match(
    helper.slice(artistActionsStart, semanticRow),
    /\[data-testid=["']context-item-info-artist["']\]/,
    "artist actions must remain discoverable through their semantic test id after href removal",
  );
  assert.match(
    helper,
    /element\.getAttribute\("data-testid"\)\s*===\s*["']context-item-info-artist["']/,
  );

  const semanticReturn = helper.indexOf("if (semanticRow) return semanticRow", semanticRow);
  const exactFallback = helper.indexOf("this.findExactMetadataHost(", semanticReturn);
  assert.ok(
    semanticRow >= 0 &&
      semanticReturn > semanticRow &&
      exactFallback > semanticReturn,
    "the full semantic subtitle row must win before any exact-text fallback",
  );
  assert.match(
    helper.slice(semanticRow, semanticReturn),
    /\[data-testid=["']context-item-info-subtitles["']\]/,
  );
});
