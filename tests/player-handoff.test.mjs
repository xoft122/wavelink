import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/playerHandoffModel.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const model = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const image = (src, srcset = src, sizes = null, alt = src) => ({
  src,
  srcset,
  sizes,
  alt,
});

test("stale Spotify context menus are limited to WaveLink visual surfaces", () => {
  for (const surface of [
    { wavelinkActive: true, coverSurface: true, cinemaSurface: false },
    { wavelinkActive: true, coverSurface: false, cinemaSurface: true },
    { wavelinkActive: true, coverSurface: true, cinemaSurface: true },
  ]) {
    assert.equal(model.shouldBlockStaleSpotifyContextMenu(surface), true);
  }
  for (const surface of [
    { wavelinkActive: false, coverSurface: true, cinemaSurface: true },
    { wavelinkActive: true, coverSurface: false, cinemaSurface: false },
    { wavelinkActive: false, coverSurface: false, cinemaSurface: false },
  ]) {
    assert.equal(model.shouldBlockStaleSpotifyContextMenu(surface), false);
  }
});

test("WaveLink-owned bottom-bar metadata blocks only its stale Spotify menu", () => {
  assert.equal(
    model.shouldBlockStaleSpotifyContextMenu({
      wavelinkActive: true,
      coverSurface: false,
      cinemaSurface: false,
      playerBarMetadataSurface: true,
    }),
    true,
    "the replaced SoundCloud title/artist must not expose the last Spotify track's menu",
  );
  assert.equal(
    model.shouldBlockStaleSpotifyContextMenu({
      wavelinkActive: false,
      coverSurface: false,
      cinemaSurface: false,
      playerBarMetadataSurface: true,
    }),
    false,
    "handoff/inactive metadata must immediately regain normal Spotify behavior",
  );
  assert.equal(
    model.shouldBlockStaleSpotifyContextMenu({
      wavelinkActive: true,
      coverSurface: false,
      cinemaSurface: false,
      playerBarMetadataSurface: false,
    }),
    false,
    "unrelated native Spotify surfaces must keep their own context menus",
  );
});

test("WaveLink-owned right-panel metadata blocks stale routes without affecting Spotify", () => {
  assert.equal(
    model.shouldBlockStaleSpotifyContextMenu({
      wavelinkActive: true,
      coverSurface: false,
      cinemaSurface: false,
      playerBarMetadataSurface: false,
      panelMetadataSurface: true,
    }),
    true,
    "a native artist link hidden below WaveLink panel metadata must not open the last Spotify artist",
  );
  assert.equal(
    model.shouldBlockStaleSpotifyContextMenu({
      wavelinkActive: false,
      coverSurface: false,
      cinemaSurface: false,
      playerBarMetadataSurface: false,
      panelMetadataSurface: true,
    }),
    false,
    "the exact same panel region must be native again after WaveLink releases it",
  );
  assert.equal(
    model.shouldBlockStaleSpotifyContextMenu({
      wavelinkActive: true,
      coverSurface: false,
      cinemaSurface: false,
      playerBarMetadataSurface: false,
      panelMetadataSurface: false,
    }),
    false,
    "ordinary Spotify surfaces outside replaced metadata remain untouched",
  );
});

test("path-aware metadata interaction model catches sibling hitboxes only inside the owned area", () => {
  assert.equal(
    typeof model.shouldBlockStaleSpotifyMetadataInteraction,
    "function",
    "the persistent XPUI hitbox needs one pure decision shared by click and contextmenu capture",
  );
  const decide = model.shouldBlockStaleSpotifyMetadataInteraction;
  const base = {
    wavelinkActive: true,
    eventType: "click",
    directOwnedMetadataPath: false,
    candidateInsideMetadataBoundary: true,
    safePanelMetadataBoundary: true,
    metadataBoundaryContainsOwnedTitle: true,
    metadataBoundaryContainsOwnedArtist: true,
    waveLinkOwnedPath: false,
  };

  for (const eventType of ["click", "auxclick", "contextmenu"]) {
    assert.equal(
      decide({ ...base, eventType }),
      true,
      `${eventType} on a sibling native hitbox in the replaced metadata area must be inert`,
    );
  }
  assert.equal(
    decide({
      ...base,
      candidateInsideMetadataBoundary: false,
      directOwnedMetadataPath: true,
    }),
    true,
    "a descendant whose composed path reaches the role-qualified host is owned directly",
  );

  for (const patch of [
    { wavelinkActive: false },
    { eventType: "pointerdown" },
    { candidateInsideMetadataBoundary: false },
    { safePanelMetadataBoundary: false },
    { metadataBoundaryContainsOwnedTitle: false },
    { metadataBoundaryContainsOwnedArtist: false },
    { waveLinkOwnedPath: true },
  ]) {
    assert.equal(
      decide({ ...base, ...patch }),
      false,
      "inactive, foreign-root, unsupported, and ordinary Spotify paths must remain native",
    );
  }

  assert.equal(
    decide({
      ...base,
      directOwnedMetadataPath: true,
      waveLinkOwnedPath: true,
    }),
    false,
    "a real WaveLink control wins over even a role-host path and must stay clickable",
  );
});

test("a playing different Spotify URI yields WaveLink immediately", () => {
  assert.equal(
    model.classifySpotifyHandoff(
      "spotify:track:old",
      "spotify:track:new",
      true,
    ),
    "yield-now",
  );
});

test("a first late Spotify URI yields only when it is already playing", () => {
  assert.equal(
    model.classifySpotifyHandoff(null, "spotify:track:late", true),
    "yield-now",
  );
  assert.equal(
    model.classifySpotifyHandoff(null, "spotify:track:late", false),
    "keep-wavelink",
  );
});

test("a paused different URI is validated while the baseline stays WaveLink-owned", () => {
  assert.equal(
    model.classifySpotifyHandoff(
      "spotify:track:old",
      "spotify:track:new",
      false,
    ),
    "validate-stable-uri",
  );
  assert.equal(
    model.classifySpotifyHandoff(
      "spotify:track:old",
      "spotify:track:old",
      true,
    ),
    "keep-wavelink",
  );
});

test("a captured first-click play intent survives WaveLink's pause race", () => {
  assert.equal(
    model.shouldCompleteStableSpotifyHandoff(
      7,
      7,
      "spotify:track:new",
      "spotify:track:new",
      true,
    ),
    true,
  );
});

test("stable handoff rejects stale WaveLink loads and paused changes without play intent", () => {
  assert.equal(
    model.shouldCompleteStableSpotifyHandoff(
      7,
      8,
      "spotify:track:new",
      "spotify:track:new",
      true,
    ),
    false,
  );
  assert.equal(
    model.shouldCompleteStableSpotifyHandoff(
      7,
      7,
      "spotify:track:new",
      "spotify:track:new",
      false,
    ),
    false,
  );
});

test("native Spotify Play intent is distinguished from WaveLink and transport controls", () => {
  assert.equal(
    model.isNativeSpotifyPlayIntent({
      className: "main-trackList-rowImagePlayButton",
    }),
    true,
    "the stable Spotify track-row play class must work in every locale",
  );
  assert.equal(
    model.isNativeSpotifyPlayIntent({
      ariaLabel: "Play Fading Light by SHAW BRIJA RAELL",
    }),
    true,
  );
  assert.equal(
    model.isNativeSpotifyPlayIntent({ testId: "card-play-button" }),
    true,
  );
  assert.equal(
    model.isNativeSpotifyPlayIntent({
      clickCount: 2,
      insideTrackRow: true,
      interactiveTarget: false,
    }),
    true,
    "double-clicking empty track-row space is also native play intent",
  );

  for (const candidate of [
    { ariaLabel: "Play SoundCloud track", excluded: true },
    { ariaLabel: "Play", transportControl: true },
    { ariaLabel: "Add to playlist" },
    { ariaLabel: "Follow" },
    {
      clickCount: 2,
      insideTrackRow: true,
      interactiveTarget: true,
    },
  ]) {
    assert.equal(model.isNativeSpotifyPlayIntent(candidate), false);
  }
});

test("switching SC covers never promotes the previous SC cover to native", () => {
  const spotify = image("old-spotify.jpg");
  const scA = image("soundcloud-a.jpg");
  const scB = image("soundcloud-b.jpg");

  let snapshot = model.updateImageOverlaySnapshot(undefined, spotify, scA);
  snapshot = model.updateImageOverlaySnapshot(snapshot, scA, scB);

  assert.deepEqual(snapshot.native, spotify);
  assert.deepEqual(
    model.releaseImageOverlay(snapshot, scB),
    { kind: "reconcile", state: spotify },
  );
});

test("Spotify reconciliation before a WaveLink tick becomes the new native cover", () => {
  const spotifyA = image("old-spotify.jpg");
  const spotifyB = image("new-spotify.jpg");
  const sc = image("soundcloud.jpg");

  let snapshot = model.updateImageOverlaySnapshot(undefined, spotifyA, sc);
  snapshot = model.updateImageOverlaySnapshot(snapshot, spotifyB, sc);

  assert.deepEqual(snapshot.native, spotifyB);
  assert.deepEqual(
    model.releaseImageOverlay(snapshot, sc),
    { kind: "reconcile", state: spotifyB },
  );
});

test("release preserves a Spotify cover reconciled after WaveLink's last tick", () => {
  const spotifyA = image("old-spotify.jpg");
  const spotifyB = image("new-spotify.jpg");
  const sc = image("soundcloud.jpg");
  const snapshot = model.updateImageOverlaySnapshot(undefined, spotifyA, sc);

  assert.deepEqual(
    model.releaseImageOverlay(snapshot, spotifyB),
    { kind: "reconcile", state: spotifyB },
  );
});

test("a failed SoundCloud cover can fall back without leaking into Spotify", () => {
  const spotify = image(
    "spotify.jpg",
    "spotify-320.jpg 320w",
    "56px",
    "Spotify cover",
  );
  const broken = image(
    "broken-soundcloud.jpg",
    "broken-soundcloud.jpg",
    "56px",
    "SoundCloud cover",
  );
  const fallback = image(
    "data:image/svg+xml,fallback",
    null,
    "56px",
    "SoundCloud cover",
  );

  let snapshot = model.updateImageOverlaySnapshot(undefined, spotify, broken);
  snapshot = model.updateImageOverlaySnapshot(snapshot, broken, fallback);

  assert.deepEqual(snapshot.native, spotify);
  assert.equal(snapshot.applied.srcset, null);
  assert.deepEqual(
    model.releaseImageOverlay(snapshot, fallback),
    { kind: "reconcile", state: spotify },
  );
});

test("only the released same Spotify item may recover a missing compact cover", () => {
  assert.equal(
    model.shouldRecoverSpotifyCover(
      "spotify:track:last",
      "spotify:track:last",
      false,
      false,
    ),
    true,
    "the same native item needs recovery when Spotify leaves its note placeholder behind",
  );
  for (const candidate of [
    {
      expectedUri: "spotify:track:last",
      currentUri: "spotify:track:other",
      wavelinkActive: false,
      hasNativeCover: false,
    },
    {
      expectedUri: "spotify:track:last",
      currentUri: "spotify:track:last",
      wavelinkActive: true,
      hasNativeCover: false,
    },
    {
      expectedUri: "spotify:track:last",
      currentUri: "spotify:track:last",
      wavelinkActive: false,
      hasNativeCover: true,
    },
  ]) {
    assert.equal(
      model.shouldRecoverSpotifyCover(
        candidate.expectedUri,
        candidate.currentUri,
        candidate.wavelinkActive,
        candidate.hasNativeCover,
      ),
      false,
    );
  }
});

test("Spotify recovery artwork accepts only Spotify image sources", () => {
  assert.equal(
    model.normalizeSpotifyArtworkUrl(
      "spotify:image:ab67616d00001e02d412b9e42d78d15f8d32f2e0",
    ),
    "https://i.scdn.co/image/ab67616d00001e02d412b9e42d78d15f8d32f2e0",
  );
  assert.equal(
    model.normalizeSpotifyArtworkUrl(
      "https://i.scdn.co/image/ab67616d00001e02d412b9e42d78d15f8d32f2e0",
    ),
    "https://i.scdn.co/image/ab67616d00001e02d412b9e42d78d15f8d32f2e0",
  );
  for (const unsafe of [
    "",
    "data:image/svg+xml,fallback",
    "http://i.scdn.co/image/demo",
    "https://example.com/cover.jpg",
    "spotify:image:not-hex",
  ]) {
    assert.equal(model.normalizeSpotifyArtworkUrl(unsafe), null);
  }
});

test("a srcset-only reconciliation cannot leave a SoundCloud src behind", () => {
  const spotify = image("cover.jpg", "cover-small.jpg");
  const sc = image("soundcloud.jpg");
  const snapshot = model.updateImageOverlaySnapshot(undefined, spotify, sc);
  const partialReactUpdate = {
    ...sc,
    srcset: "cover-large.jpg",
  };

  assert.deepEqual(
    model.releaseImageOverlay(snapshot, partialReactUpdate),
    {
      kind: "reconcile",
      state: {
        ...spotify,
        srcset: "cover-large.jpg",
      },
    },
  );
});

test("partial React updates before the next tick merge native attributes independently", () => {
  const spotify = image(
    "old-spotify.jpg",
    "old-spotify-srcset.jpg",
    "100vw",
    "Old Spotify",
  );
  const sc = image("soundcloud.jpg", "soundcloud.jpg", "100vw", "SoundCloud");
  const cases = [
    { attribute: "src", value: "new-spotify.jpg" },
    { attribute: "srcset", value: "new-spotify-srcset.jpg" },
    { attribute: "sizes", value: "50vw" },
    { attribute: "alt", value: "New Spotify" },
  ];

  for (const { attribute, value } of cases) {
    let snapshot = model.updateImageOverlaySnapshot(undefined, spotify, sc);
    const partialReactUpdate = { ...sc, [attribute]: value };
    const nextApplied = {
      ...partialReactUpdate,
      src: sc.src,
      srcset: sc.srcset,
      alt: sc.alt,
    };
    snapshot = model.updateImageOverlaySnapshot(
      snapshot,
      partialReactUpdate,
      nextApplied,
    );

    assert.notEqual(snapshot.native.src, sc.src);
    assert.equal(snapshot.native[attribute], value);
    const released = model.releaseImageOverlay(snapshot, nextApplied);
    assert.notEqual(released.state.src, sc.src);
    assert.equal(released.state[attribute], value);
  }
});

test("player wiring releases changed playback before pause suppression and can resume it", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const handlerStart = playerSource.indexOf(
    'Spicetify.Player.addEventListener("onplaypause"',
  );
  const handlerEnd = playerSource.indexOf("//removed onvolumechange", handlerStart);
  const handler = playerSource.slice(handlerStart, handlerEnd);

  assert.ok(handler.indexOf('handoff === "yield-now"') >= 0);
  assert.ok(
    handler.indexOf('handoff === "yield-now"') <
      handler.indexOf("Date.now() < this._suppressSpotifyEventsUntil"),
  );
  assert.match(
    playerSource,
    /const expectedLoadId = this\._loadId;/,
  );
  assert.match(
    playerSource,
    /shouldCompleteStableSpotifyHandoff\(\s*expectedLoadId,\s*this\._loadId,/,
  );
  assert.match(
    playerSource,
    /this\._track \|\|\s*!shouldResume \|\|\s*this\.spotifyItemUri\(\) !== observedUri/,
  );
  assert.match(
    playerSource,
    /if \(!Spicetify\.Player\.isPlaying\(\)\) Spicetify\.Player\.play\(\);/,
  );
});

test("native Spotify Play clicks release WaveLink in capture phase", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const handlerStart = playerSource.indexOf(
    "private readonly _onNativeSpotifyPlaybackClick",
  );
  const handlerEnd = playerSource.indexOf(
    "private readonly _onFollowingStatusRefresh",
    handlerStart,
  );
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  const handler = playerSource.slice(handlerStart, handlerEnd);

  assert.match(handler, /if \(!this\._track \|\| event\.button !== 0\) return/);
  assert.match(handler, /\bisNativeSpotifyPlayIntent\s*\(/);
  assert.match(handler, /\.wl-app/);
  assert.match(handler, /\[data-wl-owned\]/);
  assert.match(handler, /\bSEL_PLAYPAUSE\.join\(/);
  assert.match(handler, /\bthis\.stop\(\)/);
  assert.match(handler, /\bSpicetify\.Player\.seek\(0\)/);
  assert.match(handler, /const releasedSpotifyUri = this\.spotifyItemUri\(\)/);
  assert.match(
    handler,
    /this\._track \|\|\s*!releasedSpotifyUri \|\|\s*this\.spotifyItemUri\(\) !== releasedSpotifyUri/,
  );
  const uriIndex = handler.indexOf(
    "const releasedSpotifyUri = this.spotifyItemUri()",
  );
  const stopIndex = handler.indexOf("this.stop()");
  const guardIndex = handler.indexOf(
    "this.spotifyItemUri() !== releasedSpotifyUri",
  );
  const seekIndex = handler.indexOf("Spicetify.Player.seek(0)");
  assert.ok(
    uriIndex < stopIndex && stopIndex < guardIndex && guardIndex < seekIndex,
    "capture must snapshot, release, guard, then rewind before Spotify handles Play",
  );
  assert.doesNotMatch(handler, /preventDefault|stopPropagation/);
  assert.equal(
    playerSource.match(/Spicetify\.Player\.seek\(0\)/g)?.length,
    1,
    "only an explicit native Play may restart Spotify from zero",
  );

  assert.match(
    playerSource,
    /document\.addEventListener\(\s*"click",\s*this\._onNativeSpotifyPlaybackClick,\s*true,\s*\)/,
    "document capture must run before Spotify's target click handler",
  );
  assert.match(
    playerSource,
    /document\.removeEventListener\(\s*"click",\s*this\._onNativeSpotifyPlaybackClick,\s*true,\s*\)/,
  );
});

test("same-item Spotify handoff schedules compact-cover recovery after the native click", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const handlerStart = playerSource.indexOf(
    "private readonly _onNativeSpotifyPlaybackClick",
  );
  const handlerEnd = playerSource.indexOf(
    "private readonly _onFollowingStatusRefresh",
    handlerStart,
  );
  assert.notEqual(handlerStart, -1);
  assert.notEqual(handlerEnd, -1);
  const handler = playerSource.slice(handlerStart, handlerEnd);

  const seekIndex = handler.indexOf("Spicetify.Player.seek(0)");
  const recoveryIndex = handler.indexOf(
    "this.scheduleSpotifyCoverRecovery(releasedSpotifyUri)",
  );
  assert.ok(
    seekIndex >= 0 && recoveryIndex > seekIndex,
    "recovery must be armed after WaveLink restores the native bar and rewinds the released item",
  );

  const recoveryStart = playerSource.indexOf(
    "private removeSpotifyCoverRecoveryOverlay(",
  );
  assert.notEqual(recoveryStart, -1);
  assert.ok(handlerStart > recoveryStart);
  const recovery = playerSource.slice(recoveryStart, handlerStart);

  assert.match(recovery, /shouldRecoverSpotifyCover\s*\(/);
  assert.match(recovery, /spotifyCoverRecoverySurfaces\s*\(/);
  assert.match(recovery, /\.cover-art-icon/);
  assert.match(
    recovery,
    /setTimeout|requestAnimationFrame/,
    "the check must run after Spotify's target click/React commit, not during capture",
  );
});

test("same-item Spotify cover recovery repairs right-panel note placeholders and cleans up", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const subsystemStart = playerSource.indexOf(
    "private removeSpotifyCoverRecoveryOverlay(",
  );
  const handlerStart = playerSource.indexOf(
    "private readonly _onNativeSpotifyPlaybackClick",
    subsystemStart,
  );
  assert.notEqual(subsystemStart, -1);
  assert.ok(handlerStart > subsystemStart);
  const subsystem = playerSource.slice(subsystemStart, handlerStart);

  const recoveryStart = subsystem.indexOf(
    "private reconcileSpotifyCoverRecovery(",
  );
  const scheduleStart = subsystem.indexOf(
    "private scheduleSpotifyCoverRecovery(",
    recoveryStart,
  );
  assert.notEqual(recoveryStart, -1);
  assert.ok(scheduleStart > recoveryStart);
  const recovery = subsystem.slice(recoveryStart, scheduleStart);

  assert.match(
    recovery,
    /candidate\.uri\s*!==\s*expectedUri/,
    "a stale recovery candidate must never paint a different Spotify item",
  );
  assert.match(recovery, /const currentUri = this\.spotifyItemUri\(\)/);
  assert.match(
    recovery,
    /if \(this\._track \|\| currentUri !== expectedUri\)\s*{\s*this\.cancelSpotifyCoverRecovery\(\)/,
    "a new WaveLink load or different Spotify URI must cancel every recovery surface",
  );

  assert.match(
    subsystem,
    /for\s*\(\s*const panelRoot of this\.panelRoots\(\)\s*\)/,
    "the same-URI repair must inspect every right Now Playing panel root",
  );
  assert.match(
    subsystem,
    /panelRoot\.querySelector<HTMLElement>\("\.cover-art-icon"\)/,
  );
  for (const structuralSelector of [
    "track-visual-enhancement",
    "main-nowPlayingView-coverArtVisualEnhancement",
    "main-nowPlayingView-coverArt",
    "main-nowPlayingView-coverArtContainer",
  ]) {
    assert.match(
      subsystem,
      new RegExp(structuralSelector),
      `right-panel recovery must recognize ${structuralSelector}`,
    );
  }
  assert.match(
    subsystem,
    /data-wl-owned["']?\s*,\s*["']spotify-cover-recovery/,
    "the repaired panel artwork must remain a disposable WaveLink-owned overlay",
  );

  assert.match(subsystem, /this\._spotifyCoverRecoveryBindings/);
  assert.match(
    subsystem,
    /for \(const \[bindingHost, binding\] of Array\.from\(\s*this\._spotifyCoverRecoveryBindings,\s*\)\)/,
    "global cleanup must release every bar/panel binding, not only one image",
  );
  assert.match(subsystem, /binding\.image\.remove\(\)/);
  assert.match(subsystem, /binding\.host\.classList\.remove\(\s*"wl-spotify-cover-recovery-host"/);
  assert.match(
    subsystem,
    /this\._spotifyCoverRecoveryBindings\.delete\(bindingHost\)/,
  );
  assert.match(subsystem, /this\._spotifyCoverRecoveryCandidate\s*=\s*null/);

  assert.match(
    recovery,
    /shouldRecoverSpotifyCover\(\s*expectedUri,\s*currentUri,\s*this\._track !== null,\s*hasNativeCover,\s*\)/,
    "bar and panel recovery must share the exact-URI/native-cover guard",
  );
  assert.match(
    recovery,
    /!shouldRecoverSpotifyCover\([\s\S]{0,180}this\.removeSpotifyCoverRecoveryOverlay\(host\)/,
    "a restored native Spotify image must remove only that surface's overlay",
  );
  assert.match(
    recovery,
    /for \(const host of Array\.from\(this\._spotifyCoverRecoveryBindings\.keys\(\)\)\)[\s\S]{0,220}!activeHosts\.has\(host\) \|\| !host\.isConnected[\s\S]{0,120}this\.removeSpotifyCoverRecoveryOverlay\(host\)/,
    "stale and disconnected right-panel bindings must be released independently",
  );
});

test("WaveLink covers, bar/panel metadata, and cinema suppress stale Spotify menus", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const start = playerSource.indexOf(
    "private readonly _onStaleSpotifyContextMenu",
  );
  const end = playerSource.indexOf(
    "private readonly _onCoverImageError",
    start,
  );
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const handler = playerSource.slice(start, end);

  assert.match(handler, /"\.wl-sc-cover"/);
  assert.match(handler, /"\.wl-sc-cover-host"/);
  assert.match(handler, /"\.main-nowPlayingWidget-coverArt"/);
  assert.match(handler, /"\.main-coverSlotCollapsed-container"/);
  assert.match(handler, /track-visual-enhancement/);
  assert.match(handler, /\.main-nowPlayingView-coverArtVisualEnhancement/);
  assert.match(handler, /\.main-nowPlayingView-coverArtContainer/);
  assert.match(handler, /closest\(CINEMA_ROOT_SELECTOR\)/);
  assert.match(playerSource, /CINEMA_ROOT_SELECTOR = "\.Root__cinema-view, \[data-wl-cinema-root\]"/);
  assert.match(
    handler,
    /closest\(\s*["']\.wl-sc-meta-host\.wl-sc-meta-bar["']\s*,?\s*\)/,
    "only metadata hosts currently owned by WaveLink's bottom bar should be added",
  );
  assert.match(
    handler,
    /playerBarMetadataSurface\s*[:,]/,
    "the DOM classification must reach the pure handoff decision",
  );
  const panelSelectorStart = handler.indexOf("const panelMetadataSelector =");
  const panelSelectorEnd = handler.indexOf("if (", panelSelectorStart);
  assert.ok(panelSelectorStart >= 0 && panelSelectorEnd > panelSelectorStart);
  const panelSelector = handler.slice(panelSelectorStart, panelSelectorEnd);
  assert.match(
    handler,
    /\.wl-sc-meta-host\.wl-sc-meta-panel\[data-wl-meta=["']title["']\]/,
  );
  assert.match(
    handler,
    /\.wl-sc-meta-host\.wl-sc-meta-panel\[data-wl-meta=["']artist["']\]/,
  );
  assert.match(
    panelSelector,
    /panelTitleSelector|\.wl-sc-meta-host\.wl-sc-meta-panel\[data-wl-meta=["']title["']\]/,
  );
  assert.match(
    panelSelector,
    /panelArtistSelector|\.wl-sc-meta-host\.wl-sc-meta-panel\[data-wl-meta=["']artist["']\]/,
  );
  assert.match(
    panelSelector,
    /element\.closest\(panelMetadataSelector\)/,
    "right-panel context blocking must be limited to owned title/artist metadata hosts",
  );
  assert.doesNotMatch(
    panelSelector,
    /\.wl-sc-panel-surface/,
    "blank panel gaps and ordinary structural space must retain native context behavior",
  );
  assert.match(
    handler,
    /panelMetadataSurface\s*[:,]/,
    "the right-panel DOM classification must reach the pure decision",
  );
  assert.match(
    handler,
    /wavelinkActive:[\s\S]{0,100}this\._track !== null[\s\S]{0,100}document\.body\.classList\.contains\("sc-active"\)/,
    "a retained retry track must not block Spotify after control is released",
  );
  assert.match(handler, /shouldBlockStaleSpotifyContextMenu\s*\(/);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.match(handler, /event\.stopImmediatePropagation\(\)/);
  assert.match(
    playerSource,
    /document\.addEventListener\(\s*"contextmenu",\s*this\._onStaleSpotifyContextMenu,\s*true,\s*\)/,
    "capture must stop Spotify's delegated stale-track handler",
  );
  assert.match(
    playerSource,
    /document\.removeEventListener\(\s*"contextmenu",\s*this\._onStaleSpotifyContextMenu,\s*true,\s*\)/,
    "destroy must restore normal Spotify context menus",
  );
});

test("persistent panel metadata hitboxes are captured from the composed path and same owned area", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const handlerName = "_onStaleSpotifyMetadataInteraction";
  const start = playerSource.indexOf(`private readonly ${handlerName}`);
  const end = playerSource.indexOf("private readonly _onCoverImageError", start);
  assert.ok(
    start >= 0 && end > start,
    "click and contextmenu need one path-aware guard instead of target-only contextmenu code",
  );
  const handler = playerSource.slice(start, end);
  const boundaryStart = playerSource.indexOf(
    "private panelMetadataInteractionBoundary(",
  );
  const boundaryEnd = playerSource.indexOf(
    `private readonly ${handlerName}`,
    boundaryStart,
  );
  assert.ok(
    boundaryStart >= 0 && boundaryEnd > boundaryStart,
    "the narrow structural boundary must stay isolated and auditable",
  );
  const boundary = playerSource.slice(boundaryStart, boundaryEnd);

  assert.match(
    handler,
    /event\.composedPath\(\)/,
    "a sibling/overlay XPUI hitbox may expose the owned metadata area only through its composed path",
  );
  assert.match(
    handler,
    /event\.target/,
    "synthetic/older events with an empty composed path still need a target fallback",
  );
  assert.match(handler, /candidate instanceof Element|node instanceof Element/);
  assert.match(
    handler,
    /(?:path|candidates|elements)\.some\([\s\S]{0,220}closest\(\s*["']\[data-wl-owned\]["']\s*\)/,
    "clicks on real WaveLink buttons/links must never be swallowed as stale Spotify metadata",
  );
  assert.match(
    handler,
    /closest<HTMLElement>\(\s*["']\.wl-sc-panel-surface["']\s*\)/,
  );
  assert.match(
    handler,
    /\.wl-sc-meta-host\.wl-sc-meta-panel\[data-wl-meta=["']title["']\]/,
  );
  assert.match(
    handler,
    /\.wl-sc-meta-host\.wl-sc-meta-panel\[data-wl-meta=["']artist["']\]/,
  );
  assert.match(
    boundary,
    /if\s*\(\s*!(?:titleHost|title)\s*\|\|\s*!(?:artistHost|artist)\s*\)\s*(?:continue|return\s+null)/,
    "a structural capture fence is valid only when both role-tagged title and artist exist",
  );
  assert.match(
    boundary,
    /(?:closest|querySelector)(?:<HTMLElement>)?\(\s*["']\.main-nowPlayingView-trackInfo["']\s*\)/,
    "Spotify's exact trackInfo row is the only preferred structural boundary",
  );
  assert.match(
    boundary,
    /\.contains\((?:titleHost|title)\)/,
    "the preferred boundary must contain the currently owned title",
  );
  assert.match(
    boundary,
    /\.contains\((?:artistHost|artist)\)/,
    "the preferred boundary must contain the currently owned artist",
  );
  assert.match(
    boundary,
    /let\s+(?:common|boundary|candidate)\s*=[\s\S]{0,320}while\s*\([\s\S]{0,380}\.contains\([\s\S]{0,380}parentElement/,
    "classless XPUI may fall back only to the title/artist lowest common ancestor",
  );
  assert.match(
    boundary,
    /(?:common|area|boundary|candidate)\.(?:matches\(\s*["']\.main-nowPlayingView-contextItemInfo["']\s*\)|classList\.contains\(\s*["']main-nowPlayingView-contextItemInfo["']\s*\))/,
    "the action-bearing contextItemInfo wrapper must be rejected explicitly if it becomes the LCA",
  );
  assert.match(
    boundary,
    /(?:common|area|boundary|candidate)\s*!==\s*(?:panelRoot|root)|(?:panelRoot|root)\s*!==\s*(?:common|area|boundary|candidate)/,
    "the panel root itself can never become a metadata interaction boundary",
  );
  assert.match(
    handler,
    /(?:metadataArea|metadataBoundary|area|boundary)\!?\.contains\(candidate\)/,
    "an unrelated candidate elsewhere in the panel must not inherit metadata ownership",
  );
  assert.match(
    handler,
    /metadataBoundaryContainsOwnedTitle/,
    "the pure decision must receive title ownership independently",
  );
  assert.match(
    handler,
    /metadataBoundaryContainsOwnedArtist/,
    "the pure decision must receive artist ownership independently",
  );
  assert.match(
    handler,
    /waveLinkOwnedPath/,
    "WaveLink-owned controls must stay excluded in the path-aware pure decision",
  );
  assert.doesNotMatch(
    boundary,
    /SEL_PANEL_META_ROOT/,
    "the selector family also includes the action-bearing contextItemInfo wrapper and is too broad here",
  );
  assert.doesNotMatch(
    boundary,
    /closest(?:<HTMLElement>)?\(\s*["']\.main-nowPlayingView-contextItemInfo["']\s*\)/,
    "contextItemInfo may be recognized only to reject it, never promoted as a boundary",
  );

  const trackInfoIndex = boundary.indexOf(".main-nowPlayingView-trackInfo");
  const lcaIndex = boundary.search(/let\s+(?:common|boundary|candidate)\s*=/);
  assert.ok(
    trackInfoIndex >= 0 && lcaIndex > trackInfoIndex,
    "the exact semantic trackInfo row must be attempted before the LCA fallback",
  );

  assert.match(handler, /shouldBlockStaleSpotifyMetadataInteraction\s*\(/);
  assert.match(handler, /event\.preventDefault\(\)/);
  assert.match(handler, /event\.stopImmediatePropagation\(\)/);

  for (const type of ["click", "auxclick", "contextmenu"]) {
    assert.match(
      playerSource,
      new RegExp(
        `document\\.addEventListener\\(\\s*["']${type}["']\\s*,\\s*this\\.${handlerName}\\s*,\\s*true\\s*,?\\s*\\)`,
      ),
      `${type} must be stopped before Spotify's delegated stale route`,
    );
    assert.match(
      playerSource,
      new RegExp(
        `document\\.removeEventListener\\(\\s*["']${type}["']\\s*,\\s*this\\.${handlerName}\\s*,\\s*true\\s*,?\\s*\\)`,
      ),
      `destroy must remove the ${type} capture guard`,
    );
  }
});

test("metadata and per-anchor ownership are fully released on Spotify handoff", async () => {
  const playerSource = await readFile(
    new URL("../src/services/player.ts", import.meta.url),
    "utf8",
  );
  const metadataReleaseStart = playerSource.indexOf(
    "private releaseMetadataBinding",
  );
  const metadataReleaseEnd = playerSource.indexOf(
    "private syncMetadataTarget",
    metadataReleaseStart,
  );
  const metadataRelease = playerSource.slice(
    metadataReleaseStart,
    metadataReleaseEnd,
  );
  assert.match(metadataRelease, /classList\.remove\([\s\S]*?"wl-sc-meta-panel"/);
  assert.match(metadataRelease, /removeAttribute\("data-wl-meta"\)/);

  const nativeReleaseStart = playerSource.indexOf(
    "private restoreNativeInteraction",
  );
  const nativeReleaseEnd = playerSource.indexOf(
    "private releaseUnusedNativeInteractions",
    nativeReleaseStart,
  );
  const nativeRelease = playerSource.slice(nativeReleaseStart, nativeReleaseEnd);
  for (const type of ["click", "auxclick", "contextmenu"]) {
    assert.match(
      nativeRelease,
      new RegExp(
        `element\\.removeEventListener\\(["']${type}["'],\\s*binding\\.block,\\s*true\\)`,
      ),
    );
  }
  assert.match(nativeRelease, /restoreAttribute\(element, "href", binding\.href\)/);
  assert.match(nativeRelease, /\)\.inert = binding\.inert/);

  const restoreBarStart = playerSource.indexOf("private restoreNativeBar()");
  const restoreBarEnd = playerSource.indexOf("private failPlayback", restoreBarStart);
  const restoreBar = playerSource.slice(restoreBarStart, restoreBarEnd);
  assert.match(restoreBar, /this\.releaseMetadataBinding\(binding\)/);
  assert.match(restoreBar, /this\.restoreNativeInteraction\(binding\)/);
});
