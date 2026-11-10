import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(
  new URL("../src/services/player.ts", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "player.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS,
);
const player = parsed.statements.find(
  (node) => ts.isClassDeclaration(node) && node.name?.text === "SoundCloudPlayer",
);
const methods = [
  "playerBarWidgets",
  "findExactMetadataHost",
  "findPanelArtistHost",
  "collectMetadataTargets",
  "collectCoverTargets",
  "findPanelVideoCoverHost",
  "spotifyCoverRecoverySurfaces",
  "reconcileBarSurface",
  "releaseBarSurface",
  "hideNativeElement",
  "restoreHiddenNative",
  "releaseUnusedHiddenNative",
  "stalePanelSections",
  "applyTrackInfo",
  "cinemaRoots",
  "restoreNativeInteraction",
  "findPanelHeader",
  "cinemaControlTarget",
  "reconcileCinemaControls",
  "injectStyles",
];
const declarations = parsed.statements.filter((node) =>
  (ts.isVariableStatement(node) && node.declarationList.declarations.some(
    (declaration) => /^SEL_|^CINEMA_ROOT_SELECTOR$|^PAUSE_ICON_URL$/.test(declaration.name.getText(parsed)),
  )) ||
  (ts.isFunctionDeclaration(node) && [
    "q", "qWithin", "qAllUnique", "restoreAttribute",
  ].includes(node.name?.text)),
);
const selectedMethods = methods.map((name) => {
  const member = player.members.find((node) => node.name?.getText(parsed) === name);
  assert.ok(member, `Player method missing: ${name}`);
  return member.getText(parsed);
});
const compiled = ts.transpileModule([
  ...declarations.map((node) => node.getText(parsed)),
  `class Harness { ${selectedMethods.join("\n")} }`,
  "return Harness;",
].join("\n"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;

// Deliberately map only semantic Spotify fixture selectors. Missing/new selector
// support must therefore change the actual returned surfaces, not just a regex.
class FixtureElement {
  constructor(text = "") {
    this.textContent = text;
    this.children = [];
    this.parentElement = null;
    this.isConnected = true;
    this.queries = new Map();
    this.attributes = new Map();
    this.inert = false;
    const classes = new Set();
    this.classList = {
      contains: (name) => classes.has(name),
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
    };
  }
  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      this.children.push(child);
    }
  }
  appendChild(child) { this.append(child); return child; }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    }
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  removeEventListener() {}
  getBoundingClientRect() { return this.rect ?? { width: 0, height: 0 }; }
  matches(selector) {
    if (selector.includes(",")) return selector.split(",").some((part) => this.matches(part.trim()));
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const present = selector.match(/^\[([^=\]]+)\]$/);
    if (present) return this.hasAttribute(present[1]);
    const attribute = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
    return !!attribute && this.getAttribute(attribute[1]) === attribute[2];
  }
  expose(selector, ...elements) {
    this.queries.set(selector, elements);
    return this;
  }
  querySelectorAll(selector) { return this.queries.get(selector) ?? []; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  contains(element) {
    return this === element || this.children.some((child) => child.contains(element));
  }
  closest(selector) {
    if (this.matches(selector)) return this;
    return this.parentElement?.closest(selector) ?? null;
  }
}

function createHarness(document) {
  const Harness = new Function(
    "document", "HTMLElement", "normalizeMetadataText", "trackKey", "window", compiled,
  )(
    document,
    FixtureElement,
    (text) => String(text ?? "").replace(/\s+/g, " ").trim(),
    (track) => String(track.id),
    { innerWidth: 1600, innerHeight: 900 },
  );
  const instance = new Harness();
  instance.panelRoots = () => [];
  instance._semanticCinemaRoots = new Set();
  instance.nativePanelActionKind = () => null;
  instance.getNativeMetadata = () => ({ title: "Last Spotify song", artists: ["Spotify artist"] });
  return instance;
}

function currentBarFixture() {
  const document = new FixtureElement();
  const bar = new FixtureElement();
  const widget = new FixtureElement();
  widget.setAttribute("data-testid", "now-playing-widget-v2");
  document.append(bar);
  bar.append(widget);
  document.expose('[data-testid="now-playing-bar"]', bar);
  document.expose('.Root__now-playing-bar', bar);
  document.expose('[data-testid="now-playing-widget-v2"]', widget);
  bar.expose('[data-testid="now-playing-widget-v2"]', widget);
  return { document, bar, widget, harness: createHarness(document) };
}

test("v2 bottom-player discovery stays scoped away from an unrelated widget", () => {
  const { document, widget, harness } = currentBarFixture();
  const unrelated = new FixtureElement();
  document.append(unrelated);
  document.expose('[data-testid="now-playing-widget-v2"]', unrelated, widget);
  assert.deepEqual(harness.playerBarWidgets(), [widget]);
});

test("widget discovery retains legacy markup and standalone v2 fallback", () => {
  const document = new FixtureElement();
  const widget = new FixtureElement();
  document.append(widget);
  document.expose('[data-testid="now-playing-widget-v2"]', widget);
  assert.deepEqual(createHarness(document).playerBarWidgets(), [widget]);
  document.expose('[data-testid="now-playing-widget-v2"]');
  document.expose('[data-testid="now-playing-widget"]', widget);
  assert.deepEqual(createHarness(document).playerBarWidgets(), [widget]);
});

test("v2 title and byline are replaced and remain discoverable after takeover", () => {
  const { widget, harness } = currentBarFixture();
  const title = new FixtureElement("Last Spotify song");
  const artist = new FixtureElement("Spotify artist");
  widget.append(title, artist);
  widget.expose('a, [data-encore-id="text"], span, div', title, artist);
  widget.expose('[data-testid="now-playing-widget-v2-byline"]', artist);
  const expected = [
    { host: title, role: "title", surface: "bar" },
    { host: artist, role: "artist", surface: "bar" },
  ];
  assert.deepEqual(harness.collectMetadataTargets(), expected);
  title.textContent = "SoundCloud song";
  artist.textContent = "SoundCloud uploader";
  widget.expose('.wl-sc-meta-title', title);
  widget.expose('.wl-sc-meta-artist', artist);
  assert.deepEqual(harness.collectMetadataTargets(), expected);
});

test("v2 cover and missing-art slot share the same collection and recovery host", () => {
  const { widget, harness } = currentBarFixture();
  const host = new FixtureElement();
  const image = new FixtureElement();
  widget.append(host);
  host.append(image);
  widget.expose('[data-testid="cover-art-container"]', host);
  widget.expose('[data-testid="cover-art-container"] img:not([data-wl-owned])', image);
  const released = [];
  harness.releaseOwnedCover = (root) => released.push(root);
  harness.releaseUnusedOwnedCovers = () => {};
  assert.deepEqual(harness.collectCoverTargets(), [image]);
  assert.deepEqual(released, [widget]);
  assert.deepEqual(harness.spotifyCoverRecoverySurfaces(), [{ host, note: null }]);

  widget.expose('[data-testid="cover-art-container"] img:not([data-wl-owned])');
  const fallback = new FixtureElement();
  harness.ensureOwnedCover = (root, actualHost) => {
    assert.equal(root, widget);
    assert.equal(actualHost, host);
    return fallback;
  };
  assert.deepEqual(harness.collectCoverTargets(), [fallback]);
  assert.deepEqual(harness.spotifyCoverRecoverySurfaces(), [{ host, note: null }]);
});

test("v2 stale saved-track actions yield to one SoundCloud like and restore on handoff", () => {
  const { document, widget, harness } = currentBarFixture();
  const art = new FixtureElement();
  art.setAttribute("data-testid", "cover-art-container");
  const metadata = new FixtureElement();
  const byline = new FixtureElement();
  metadata.append(byline);
  metadata.expose('[data-testid="now-playing-widget-v2-byline"]', byline);
  const actions = new FixtureElement();
  const spotifyLike = new FixtureElement();
  actions.append(spotifyLike);
  actions.expose('button, [role="button"]', spotifyLike);
  widget.append(art, metadata, actions);
  const ownedLike = new FixtureElement();
  ownedLike.setAttribute("data-wl-owned", "panel-like");
  harness._barSurfaces = new Map();
  harness._hiddenNative = new Map();
  harness.ensureOwnUser = () => {};
  let likeState = { liked: false, busy: false };
  harness.ensureLikeState = () => likeState;
  let creations = 0;
  harness.createPanelLikeButton = () => { creations += 1; return ownedLike; };
  const renders = [];
  harness.renderPanelLikeButton = (button, state) => renders.push({ button, ...state });

  const activeHidden = new Set();
  const track = { id: 42, title: "SoundCloud song", user: { username: "Uploader" } };
  harness.reconcileBarSurface(widget, track, activeHidden);
  assert.deepEqual([...activeHidden], [actions]);
  assert.equal(actions.classList.contains("wl-sc-native-hidden"), true);
  assert.equal(actions.getAttribute("aria-hidden"), "true");
  assert.equal(actions.inert, true);
  assert.equal(ownedLike.parentElement, widget);
  assert.equal(metadata.classList.contains("wl-sc-native-hidden"), false);
  assert.equal(art.classList.contains("wl-sc-native-hidden"), false);

  // The appended WaveLink button must not become the next tick's native group.
  harness.reconcileBarSurface(widget, track, new Set());
  likeState = { liked: true, busy: false };
  harness.reconcileBarSurface(widget, track, new Set());
  assert.equal(creations, 1);
  assert.deepEqual(renders.map((render) => render.liked), [false, true]);

  harness.releaseBarSurface(harness._barSurfaces.get(widget));
  harness.releaseUnusedHiddenNative(new Set());
  assert.equal(ownedLike.parentElement, null);
  assert.equal(harness._barSurfaces.size, 0);
  assert.equal(actions.classList.contains("wl-sc-native-hidden"), false);
  assert.equal(actions.hasAttribute("aria-hidden"), false);
  assert.equal(actions.inert, false);
  assert.equal(document.contains(spotifyLike), true);
});

test("current non-v2 widget replaces the entire multi-artist row without legacy classes", () => {
  const { document, widget, harness } = currentBarFixture();
  widget.setAttribute("data-testid", "now-playing-widget");
  document.expose('[data-testid="now-playing-widget-v2"]');
  document.expose('[data-testid="now-playing-widget"]', widget);
  const title = new FixtureElement("Last Spotify song");
  const artists = new FixtureElement("First artist, Second artist");
  const first = new FixtureElement("First artist");
  const second = new FixtureElement("Second artist");
  first.setAttribute("href", "/artist/first");
  second.setAttribute("href", "/artist/second");
  artists.append(first, second);
  widget.append(title, artists);
  widget.expose('a, [data-encore-id="text"], span, div', title, artists, first, second);
  widget.expose('a, [href], [role="link"], [data-testid="context-item-info-artist"]', first, second);
  harness.getNativeMetadata = () => ({ title: "Last Spotify song", artists: ["First artist", "Second artist"] });
  assert.deepEqual(harness.collectMetadataTargets(), [
    { host: title, role: "title", surface: "bar" },
    { host: artists, role: "artist", surface: "bar" },
  ]);
});

test("current cover slots update both player surfaces and can receive missing-art overlays", () => {
  const { widget, harness } = currentBarFixture();
  const button = new FixtureElement();
  const barImage = new FixtureElement();
  widget.append(button);
  button.append(barImage);
  widget.expose('[data-testid="cover-art-button"]', button);
  widget.expose('[data-testid="CoverSlotCollapsed__container"] img:not([data-wl-owned])', barImage);
  const panel = new FixtureElement();
  const slot = new FixtureElement();
  const panelImage = new FixtureElement();
  panel.append(slot);
  slot.append(panelImage);
  panel.expose('[data-testid="cover-art-slot"]', slot);
  panel.expose('[data-testid="cover-art-slot"] img:not([data-wl-owned])', panelImage);
  harness.panelRoots = () => [panel];
  harness.releaseOwnedCover = () => {};
  harness.releaseUnusedOwnedCovers = () => {};
  const barOverlay = new FixtureElement();
  const panelOverlay = new FixtureElement();
  harness.ensureOwnedCover = (root) => root === widget ? barOverlay : panelOverlay;
  assert.deepEqual(harness.collectCoverTargets(), [barOverlay, panelOverlay]);
  assert.equal(barImage.parentElement, button, "native bar image stays React-owned");
  assert.equal(panelImage.parentElement, slot, "native panel image stays React-owned");
  assert.deepEqual(harness.spotifyCoverRecoverySurfaces(), [
    { host: button, note: null }, { host: slot, note: null },
  ]);
  const overlayHosts = [];
  harness.ensureOwnedCover = (_, host) => { overlayHosts.push(host); return new FixtureElement(); };
  harness.collectCoverTargets(true);
  assert.deepEqual(overlayHosts, [button, slot]);
});

test("current non-v2 saved action is hidden and the unrelated lyrics div is removed", () => {
  const { widget, harness } = currentBarFixture();
  widget.setAttribute("data-testid", "now-playing-widget");
  widget.setAttribute("aria-label", "Now playing: Native track");
  const actions = new FixtureElement();
  const savedButton = new FixtureElement();
  actions.append(savedButton);
  actions.expose('button, [role="button"]', savedButton);
  widget.append(actions);
  harness._barSurfaces = new Map();
  harness._hiddenNative = new Map();
  harness.ensureOwnUser = () => {};
  harness.ensureLikeState = () => ({ liked: true, busy: false });
  harness.createPanelLikeButton = () => {
    const button = new FixtureElement();
    button.setAttribute("data-wl-owned", "true");
    return button;
  };
  harness.renderPanelLikeButton = () => {};
  const active = new Set();
  harness.reconcileBarSurface(widget, { id: 1, title: "SoundCloud song", user: { username: "Uploader" } }, active);
  assert.equal(active.has(actions), true);
  assert.equal(widget.getAttribute("aria-label"), "Now playing: SoundCloud song by Uploader on SoundCloud");
  harness.releaseBarSurface(harness._barSurfaces.get(widget));
  assert.equal(widget.getAttribute("aria-label"), "Now playing: Native track");

  const panel = new FixtureElement();
  const lyrics = new FixtureElement();
  panel.append(lyrics);
  panel.expose('[data-testid="lyrics-npv-section"], div:has(> [data-testid="npv-artist-bio-button"]), .wYZcnNTqrjqNPCkIwTZt', lyrics);
  assert.deepEqual(harness.stalePanelSections(panel), [lyrics]);
});

test("the Spotify artist bio card is hidden as a whole and restored on handoff", () => {
  const document = new FixtureElement();
  const harness = createHarness(document);
  harness._hiddenNative = new Map();
  const panel = new FixtureElement();
  const rail = new FixtureElement();
  const bio = new FixtureElement();
  bio.classList.add("wYZcnNTqrjqNPCkIwTZt");
  const heading = new FixtureElement("About the artist");
  const credits = new FixtureElement();
  credits.setAttribute("data-wl-owned", "true");
  const creditsHeading = new FixtureElement("Credits");
  document.append(panel);
  panel.append(rail);
  rail.append(bio, credits);
  bio.append(heading);
  credits.append(creditsHeading);
  panel.expose("h2, h3", heading, creditsHeading);
  panel.expose('[data-testid="lyrics-npv-section"], div:has(> [data-testid="npv-artist-bio-button"]), .wYZcnNTqrjqNPCkIwTZt', bio);

  const stale = harness.stalePanelSections(panel);
  assert.deepEqual(stale, [bio], "select the div card, not its heading or the shared rail");
  const active = new Set();
  for (const section of stale) harness.hideNativeElement(section, active);
  assert.equal(bio.classList.contains("wl-sc-native-hidden"), true);
  assert.equal(bio.getAttribute("aria-hidden"), "true");
  assert.equal(bio.inert, true);
  assert.equal(credits.classList.contains("wl-sc-native-hidden"), false);

  harness.releaseUnusedHiddenNative(new Set());
  assert.equal(bio.classList.contains("wl-sc-native-hidden"), false);
  assert.equal(bio.getAttribute("aria-hidden"), null);
  assert.equal(bio.inert, false);
  assert.equal(bio.parentElement, rail, "Spotify keeps its own bio tree");
});

test("video-only Canvas uses its square artwork ancestor without changing the native video", () => {
  const document = new FixtureElement();
  const harness = createHarness(document);
  const panel = new FixtureElement();
  panel.rect = { width: 282, height: 664, top: 64 };
  const square = new FixtureElement();
  square.rect = { width: 250, height: 250, top: 128 };
  const overflow = new FixtureElement();
  overflow.rect = { width: 282, height: 501, top: 64 };
  const video = new FixtureElement();
  video.rect = overflow.rect;
  video.setAttribute("src", "unchanged-native-video");
  panel.append(square);
  square.append(overflow);
  overflow.append(video);
  panel.expose("video", video);
  harness.panelRoots = () => [panel];
  const cover = new FixtureElement();
  let mountedHost;
  harness.ensureOwnedCover = (_, host) => { mountedHost = host; return cover; };
  harness.releaseUnusedOwnedCovers = active => assert.equal(active.has(panel), true);
  assert.deepEqual(harness.collectCoverTargets(), [cover]);
  assert.equal(mountedHost, square, "the overflowing portrait video must not stretch or crop SoundCloud artwork");
  assert.equal(video.getAttribute("src"), "unchanged-native-video");
  assert.equal(video.parentElement, overflow, "Spotify must retain its own video tree for handoff");
});

test("video discovery ignores WaveLink-owned and below-fold recommendation videos", () => {
  const document = new FixtureElement();
  const harness = createHarness(document);
  const panel = new FixtureElement();
  panel.rect = { width: 282, height: 664, top: 64 };
  const owned = new FixtureElement();
  owned.setAttribute("data-wl-owned", "true");
  const ownedVideo = new FixtureElement();
  ownedVideo.rect = { width: 282, height: 500, top: 64 };
  owned.append(ownedVideo);
  const recommendation = new FixtureElement();
  recommendation.rect = { width: 282, height: 200, top: 620 };
  panel.append(owned, recommendation);
  panel.expose("video", ownedVideo, recommendation);
  assert.equal(harness.findPanelVideoCoverHost(panel), null);
});

test("late profile callbacks cannot remount unstyled overlays after a failed load or handoff", () => {
  const document = new FixtureElement();
  document.body = new FixtureElement();
  const harness = createHarness(document);
  harness._track = { id: 42, title: "Retriable failed track", user: { username: "Uploader" } };
  let reconciliations = 0;
  harness.playerBarWidgets = () => { reconciliations += 1; return []; };
  harness.applyTrackInfo();
  assert.equal(reconciliations, 0);
  document.body.classList.add("sc-active");
  harness.applyTrackInfo();
  assert.equal(reconciliations, 1);
  document.body.classList.remove("sc-active");
  harness.applyTrackInfo();
  assert.equal(reconciliations, 1);
});

test("fullscreen discovery accepts Spotify's hashed root and drops its marker on exit", () => {
  const document = new FixtureElement();
  document.body = new FixtureElement();
  const root = new FixtureElement();
  root.rect = { width: 1520, height: 768 };
  const header = new FixtureElement();
  header.rect = { width: 1520, height: 72 };
  const group = new FixtureElement();
  group.expose('[role="radio"][value="artwork"]', new FixtureElement());
  group.expose('[role="radio"][value="hero"]', new FixtureElement());
  document.body.append(root);
  root.append(header);
  header.append(group);
  document.expose('[role="radiogroup"]', group);
  const harness = createHarness(document);
  assert.deepEqual(harness.cinemaRoots(), [root]);
  assert.equal(root.getAttribute("data-wl-cinema-root"), "true");
  document.expose('[role="radiogroup"]');
  assert.deepEqual(harness.cinemaRoots(), []);
  assert.equal(root.hasAttribute("data-wl-cinema-root"), false);
});

test("handoff preserves Spotify's new title and link when React reuses native nodes", () => {
  const document = new FixtureElement();
  const harness = createHarness(document);
  const root = new FixtureElement();
  root.setAttribute("aria-label", "Now playing: New Spotify song");
  harness._barSurfaces = new Map();
  harness.releaseBarSurface({ root, likeButton: new FixtureElement(), originalAriaLabel: "Old song", appliedAriaLabel: "SoundCloud song" });
  assert.equal(root.getAttribute("aria-label"), "Now playing: New Spotify song");
  const link = new FixtureElement();
  link.setAttribute("href", "/track/new");
  link.setAttribute("tabindex", "0");
  link.setAttribute("aria-disabled", "false");
  harness._blockedNative = new Map();
  harness.restoreNativeInteraction({ element: link, href: "/track/old", tabIndex: null, ariaDisabled: null, inert: false, block: () => {}, blockKey: () => {} });
  assert.equal(link.getAttribute("href"), "/track/new");
  assert.equal(link.getAttribute("tabindex"), "0");
  assert.equal(link.getAttribute("aria-disabled"), "false");
});

test("fullscreen context stays discoverable after WaveLink prepends its background", () => {
  const document = new FixtureElement();
  const harness = createHarness(document);
  const root = new FixtureElement();
  root.setAttribute("data-wl-cinema-root", "true");
  const ownBackground = new FixtureElement();
  ownBackground.setAttribute("data-wl-owned", "true");
  const header = new FixtureElement();
  const context = new FixtureElement("Liked Songs");
  const options = new FixtureElement();
  const modes = new FixtureElement();
  root.append(ownBackground, header);
  header.append(context, options);
  options.append(modes);
  root.expose('[role="radiogroup"]:has([role="radio"][value="artwork"])', modes);
  header.expose('a[href]:not([data-wl-owned])', context);
  assert.equal(harness.findPanelHeader(root), context);
  assert.equal(harness.findPanelHeader(root), context);
});

test("fullscreen does not inject a second cover into Spotify's animated image host", () => {
  const document = new FixtureElement();
  const harness = createHarness(document);
  const cinema = new FixtureElement();
  cinema.setAttribute("data-wl-cinema-root", "true");
  harness.panelRoots = () => [cinema];
  harness.ensureOwnedCover = () => assert.fail("fullscreen already owns its sharp cover");
  harness.releaseUnusedOwnedCovers = active => assert.equal(active.size, 0);
  assert.deepEqual(harness.collectCoverTargets(true), []);
});

test("fullscreen hides the complete Lyrics option and restores it on Spotify handoff", () => {
  const document = new FixtureElement();
  const harness = createHarness(document);
  const root = new FixtureElement();
  const group = new FixtureElement();
  root.append(group);
  root.expose('[role="radiogroup"]:not(.wl-cinema-avatar-position)', group);
  const artwork = new FixtureElement();
  group.append(artwork);
  group.expose('[role="radio"][value="artwork"]:not([data-wl-owned])', artwork);
  const wrappers = [];
  for (const value of ["canvas", "lyrics"]) {
    const wrapper = new FixtureElement();
    const radio = new FixtureElement();
    wrapper.append(radio);
    wrapper.expose('[role="radio"]', radio);
    group.append(wrapper);
    group.expose(`[role="radio"][value="${value}"]:not([data-wl-owned])`, radio);
    wrappers.push(wrapper);
  }
  harness._cinemaModeInitialized = true;
  harness._hiddenNative = new Map();
  harness.syncCinemaArtistControlState = () => {};
  harness.reconcileCinemaNativeModeButtons = () => {};
  harness.findCinemaControlsLayer = () => null;
  harness.reconcileCinemaForegroundLayers = () => {};
  const active = new Set();
  harness.reconcileCinemaControls({ root, artistModeButton: null, artistInteractionTarget: null, artworkButton: artwork, controlsLayer: null }, active);
  assert.deepEqual(active, new Set(wrappers));
  for (const wrapper of wrappers) {
    assert.equal(wrapper.inert, true);
    assert.equal(wrapper.getAttribute("aria-hidden"), "true");
    assert.equal(wrapper.classList.contains("wl-sc-native-hidden"), true);
    harness.restoreHiddenNative(wrapper, harness._hiddenNative.get(wrapper));
    assert.equal(wrapper.inert, false);
    assert.equal(wrapper.getAttribute("aria-hidden"), null);
  }
});

test("native artwork is masked before cinema markers mount without changing its geometry", () => {
  const document = new FixtureElement();
  const harness = createHarness(document);
  let style;
  document.getElementById = () => null;
  document.createElement = () => ({ id: "", textContent: "" });
  document.head = { appendChild: element => { style = element; } };
  harness.injectStyles();
  assert.match(style.textContent, /body\.sc-active \.wl-sc-meta-bar \{[^}]*margin: 0 !important/, "the native -6px title marquee inset must not clip WaveLink's bottom metadata");
  const rule = style.textContent.match(/body\.sc-active :is\([\s\S]+?\) :is\(img, video\):not\(\.wl-sc-cover\):not\(\[data-wl-owned\]\):not\(\[data-wl-owned\] \*\) \{([^}]+)\}/);
  assert.ok(rule, "the pre-paint guard must exclude both owned images and their descendants");
  assert.match(rule[0], /\.Root__top-container > :has\(\[role="radiogroup"\] \[role="radio"\]\[value="artwork"\]\)/, "new cinema roots must be covered before JavaScript marks them");
  assert.match(rule[0], /\[data-npv-root\]/, "returning to a newly mounted compact panel must be covered too");
  assert.match(rule[1], /visibility: hidden !important/);
  assert.match(style.textContent, /body\.sc-active \.wl-sc-cover-host:has\(video\) > \.wl-sc-cover-owned \{[^}]*border-radius: var\(--encore-corner-radius-larger-2, 8px\) !important/, "video replacements must match the regular NPV artwork's rounded corners even when their host has zero radius");
  assert.match(rule[0], /:is\(img, video\)/, "Canvas videos and their poster frames need the same first-paint guard as static covers");
  assert.doesNotMatch(rule[1], /display:|height:|width:/, "native rectangles must remain usable by fullscreen positioning");
  assert.match(style.textContent, /body\.sc-active \[role="radiogroup"\]:has\([\s\S]{0,140}\[value="lyrics"\]/);
});
