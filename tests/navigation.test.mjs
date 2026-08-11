import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/navigation.ts", import.meta.url),
  "utf8",
);
const appSource = await readFile(
  new URL("../src/app.tsx", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const navigation = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function createNavigationWindow() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, handler) {
      const current = listeners.get(name) ?? new Set();
      current.add(handler);
      listeners.set(name, current);
    },
    removeEventListener(name, handler) {
      listeners.get(name)?.delete(handler);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) ?? []) handler(event);
      return true;
    },
  };
}

const owner = {
  id: "soundcloud:users:1",
  urn: "soundcloud:users:1",
};
const artist = {
  id: "soundcloud:users:7",
  urn: "soundcloud:users:7",
  username: "artist",
};
const playlist = {
  id: "soundcloud:playlists:8",
  urn: "soundcloud:playlists:8",
  title: "Queue source",
  user: artist,
};

test("WaveLink navigation accepts only known internal routes", () => {
  assert.equal(
    navigation.isWaveLinkNavigationTarget({ kind: "main", tab: "library" }),
    true,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({ kind: "main", tab: "admin" }),
    false,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "main",
      tab: "search",
      query: "Crystal Castles",
    }),
    true,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "main",
      tab: "library",
      query: "not valid here",
    }),
    false,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "main",
      tab: "search",
      query: "Crystal Castles",
      searchDraft: "Crystal Castles",
      searchTab: "users",
    }),
    true,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "main",
      tab: "search",
      searchTab: "albums",
    }),
    false,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "main",
      tab: "library",
      libraryTab: "followings",
    }),
    true,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "user",
      user: { urn: "soundcloud:users:7", username: "artist" },
    }),
    true,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "user",
      user: { urn: "soundcloud:users:7" },
    }),
    false,
  );
});

test("WaveLink restores the full route stack inside one Spotify window", () => {
  globalThis.window = createNavigationWindow();
  assert.deepEqual(navigation.restoreWaveLinkRouteStack(owner), [
    { kind: "main", tab: "home" },
  ]);

  const routes = [
    { kind: "main", tab: "library", libraryTab: "followings" },
    { kind: "user", user: artist, profileTab: "likes" },
    { kind: "playlist", playlist },
  ];
  navigation.rememberWaveLinkRouteStack(owner, routes);

  const restored = navigation.restoreWaveLinkRouteStack(owner);
  assert.deepEqual(restored, routes);
  restored.pop();
  assert.deepEqual(navigation.restoreWaveLinkRouteStack(owner), routes);

  navigation.rememberWaveLinkRouteStack(owner, routes.slice(0, -1));
  assert.deepEqual(navigation.restoreWaveLinkRouteStack(owner), routes.slice(0, -1));
});

test("a new Spotify window and a different account both start on Home", () => {
  globalThis.window = createNavigationWindow();
  navigation.rememberWaveLinkRouteStack(owner, [
    {
      kind: "main",
      tab: "search",
      query: "burial",
      searchDraft: "burial",
      searchTab: "playlists",
    },
  ]);
  assert.equal(navigation.restoreWaveLinkRouteStack(owner)[0].tab, "search");

  globalThis.window = createNavigationWindow();
  assert.deepEqual(navigation.restoreWaveLinkRouteStack(owner), [
    { kind: "main", tab: "home" },
  ]);

  navigation.rememberWaveLinkRouteStack(owner, [
    { kind: "main", tab: "settings" },
  ]);
  assert.deepEqual(
    navigation.restoreWaveLinkRouteStack({
      id: "soundcloud:users:2",
      urn: "soundcloud:users:2",
    }),
    [{ kind: "main", tab: "home" }],
  );
});

test("route memory is bounded, rejects corruption, and never touches storage", () => {
  const fakeWindow = createNavigationWindow();
  Object.defineProperties(fakeWindow, {
    localStorage: {
      get() {
        throw new Error("localStorage must not be read");
      },
    },
    sessionStorage: {
      get() {
        throw new Error("sessionStorage must not be read");
      },
    },
  });
  globalThis.window = fakeWindow;

  const manyRoutes = [{ kind: "main", tab: "home" }];
  for (let index = 0; index < 50; index += 1) {
    manyRoutes.push({
      kind: "user",
      user: {
        id: `soundcloud:users:${100 + index}`,
        urn: `soundcloud:users:${100 + index}`,
        username: `artist-${index}`,
      },
    });
  }
  const bounded = navigation.rememberWaveLinkRouteStack(owner, manyRoutes);
  assert.equal(bounded.length, navigation.WAVELINK_ROUTE_STACK_LIMIT);
  assert.deepEqual(bounded[0], { kind: "main", tab: "home" });
  assert.equal(bounded.at(-1).user.username, "artist-49");

  fakeWindow.__waveLinkNavigation.routeSession.routes = [
    { kind: "user", user: artist },
  ];
  assert.deepEqual(navigation.restoreWaveLinkRouteStack(owner), [
    { kind: "main", tab: "home" },
  ]);

  navigation.rememberWaveLinkRouteStack(owner, [
    { kind: "main", tab: "library" },
  ]);
  navigation.clearWaveLinkRouteStack();
  assert.deepEqual(navigation.restoreWaveLinkRouteStack(owner), [
    { kind: "main", tab: "home" },
  ]);
});

test("a pending deep link is consumed synchronously and exactly once", () => {
  const fakeWindow = createNavigationWindow();
  const target = { kind: "user", user: artist, profileTab: "likes" };
  fakeWindow.__waveLinkNavigation = { pending: target };
  globalThis.window = fakeWindow;

  const handled = [];
  const unbind = navigation.bindWaveLinkNavigation((value) => {
    handled.push(value);
    const current = navigation.restoreWaveLinkRouteStack(owner);
    navigation.rememberWaveLinkRouteStack(
      owner,
      navigation.applyWaveLinkNavigationTarget(current, value),
    );
  });
  assert.deepEqual(handled, [target]);
  assert.equal(fakeWindow.__waveLinkNavigation.pending, null);
  assert.deepEqual(navigation.restoreWaveLinkRouteStack(owner).at(-1), target);
  unbind();

  navigation.bindWaveLinkNavigation((value) => handled.push(value))();
  assert.deepEqual(handled, [target]);
});

test("same-main navigation preserves substate and only closes detail pages", () => {
  const libraryRoot = {
    kind: "main",
    tab: "library",
    libraryTab: "followings",
  };
  const stack = [libraryRoot, { kind: "user", user: artist, profileTab: "likes" }];

  assert.deepEqual(
    navigation.applyWaveLinkNavigationTarget(stack, {
      kind: "main",
      tab: "library",
    }),
    [libraryRoot],
  );
  assert.deepEqual(
    navigation.applyWaveLinkNavigationTarget([libraryRoot], {
      kind: "main",
      tab: "library",
    }),
    [libraryRoot],
  );
});

test("page identity changes only when the mounted WaveLink page changes", () => {
  assert.equal(
    navigation.waveLinkPageIdentity({ kind: "main", tab: "home" }),
    "main:home",
  );
  assert.equal(
    navigation.waveLinkPageIdentity({ kind: "main", tab: "library" }),
    "main:library",
  );
  assert.equal(
    navigation.waveLinkPageIdentity({
      kind: "main",
      tab: "search",
      query: "first",
      searchDraft: "second",
      searchTab: "users",
    }),
    navigation.waveLinkPageIdentity({
      kind: "main",
      tab: "search",
      query: "updated",
      searchTab: "playlists",
    }),
  );
  assert.equal(
    navigation.waveLinkPageIdentity({
      kind: "main",
      tab: "library",
      libraryTab: "liked-tracks",
    }),
    navigation.waveLinkPageIdentity({
      kind: "main",
      tab: "library",
      libraryTab: "followings",
    }),
  );
  assert.equal(
    navigation.waveLinkPageIdentity({
      kind: "user",
      user: artist,
      profileTab: "tracks",
    }),
    navigation.waveLinkPageIdentity({
      kind: "user",
      user: { ...artist, username: "Updated artist" },
      profileTab: "likes",
    }),
  );
  assert.equal(
    navigation.waveLinkPageIdentity({
      kind: "playlist",
      playlist: { ...playlist, title: "Old title" },
    }),
    navigation.waveLinkPageIdentity({
      kind: "playlist",
      playlist: { ...playlist, title: "Updated title" },
    }),
  );
  assert.notEqual(
    navigation.waveLinkPageIdentity({ kind: "user", user: artist }),
    navigation.waveLinkPageIdentity({ kind: "playlist", playlist }),
  );
  assert.notEqual(
    navigation.waveLinkPageIdentity({ kind: "user", user: artist }),
    navigation.waveLinkPageIdentity({
      kind: "user",
      user: { ...artist, id: "99", urn: "soundcloud:users:99" },
    }),
  );
});

test("explicit navigation state replaces the mounted main route intact", () => {
  const current = [
    {
      kind: "main",
      tab: "search",
      query: "old",
      searchDraft: "old draft",
      searchTab: "users",
    },
  ];
  const target = {
    kind: "main",
    tab: "search",
    query: "new",
    searchDraft: "new draft",
    searchTab: "playlists",
  };
  assert.deepEqual(
    navigation.applyWaveLinkNavigationTarget(current, target),
    [target],
  );
  assert.deepEqual(
    navigation.applyWaveLinkNavigationTarget(
      current,
      { kind: "main", tab: "search" },
      { forceExact: true },
    ),
    [{ kind: "main", tab: "search" }],
  );
});

test("an exact deep link replaces the same detail leaf instead of duplicating it", () => {
  const original = { ...playlist, title: "Old title" };
  const updated = { ...playlist, title: "Updated title" };
  const stack = [
    { kind: "main", tab: "library" },
    { kind: "playlist", playlist: original },
  ];
  assert.deepEqual(
    navigation.applyWaveLinkNavigationTarget(
      stack,
      { kind: "playlist", playlist: updated },
      { forceExact: true },
    ),
    [
      { kind: "main", tab: "library" },
      { kind: "playlist", playlist: updated },
    ],
  );
});

test("AccountShell forwards complete targets and remounts explicit view state", () => {
  assert.match(appSource, /bindWaveLinkNavigation\(navigateExternalTarget\)/);
  assert.match(
    appSource,
    /applyWaveLinkNavigationTarget\(current, target, \{ forceExact: true \}\)/,
  );
  assert.match(appSource, /setExternalRouteRevision/);
  assert.match(appSource, /externalRouteRevision\}:search:/);
  assert.match(appSource, /externalRouteRevision\}:library:/);
  assert.match(appSource, /route\.profileTab \?\? "tracks"/);
});

test("AccountShell resets the shared scroller only for a new semantic page", () => {
  assert.match(appSource, /const mainRef = useRef<HTMLElement \| null>\(null\)/);
  assert.match(appSource, /const pageIdentity = waveLinkPageIdentity\(route\)/);
  assert.match(
    appSource,
    /useLayoutEffect\(\(\) => \{\s*mainRef\.current\?\.scrollTo\(\{\s*top: 0,\s*left: 0,\s*behavior: "auto",\s*\}\);\s*\}, \[pageIdentity\]\)/,
  );
  assert.match(appSource, /<main ref=\{mainRef\} className="wl-main">/);
});

test("playlist navigation requires a playlist identity, title, and owner", () => {
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "playlist",
      playlist: {
        urn: "soundcloud:playlists:8",
        title: "Queue source",
        user: { urn: "soundcloud:users:7" },
      },
    }),
    true,
  );
  assert.equal(
    navigation.isWaveLinkNavigationTarget({
      kind: "playlist",
      playlist: { urn: "soundcloud:playlists:8", title: "Queue source" },
    }),
    false,
  );
});
