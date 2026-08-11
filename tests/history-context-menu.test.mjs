import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const positionSource = await readFile(
  new URL("../src/services/historyContextMenu.ts", import.meta.url),
  "utf8",
);
const compiledPosition = ts.transpileModule(positionSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const positionModuleUrl =
  `data:text/javascript;base64,${Buffer.from(compiledPosition).toString("base64")}`;
const { clampHistoryContextMenuPosition } = await import(positionModuleUrl);

test("history context menu stays at the pointer when it fits", () => {
  assert.deepEqual(
    clampHistoryContextMenuPosition(240, 180, 1280, 720, 190, 50),
    { left: 240, top: 180 },
  );
});

test("history context menu is clamped inside every viewport edge", () => {
  assert.deepEqual(
    clampHistoryContextMenuPosition(-20, -30, 1280, 720, 190, 50),
    { left: 8, top: 8 },
  );
  assert.deepEqual(
    clampHistoryContextMenuPosition(1275, 718, 1280, 720, 190, 50),
    { left: 1082, top: 662 },
  );
});

test("history context menu position sanitizes invalid geometry", () => {
  assert.deepEqual(
    clampHistoryContextMenuPosition(
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "bad",
      null,
      -1,
      -1,
    ),
    { left: 8, top: 8 },
  );
});

test("Recently played wires Delete only to WaveLink rows", async () => {
  const [homeSource, collectionSource, itemSource, menuSource] =
    await Promise.all([
      readFile(new URL("../src/components/HomeView.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/components/TrackCollection.tsx", import.meta.url),
        "utf8",
      ),
      readFile(new URL("../src/components/TrackItem.tsx", import.meta.url), "utf8"),
      readFile(
        new URL("../src/components/HistoryContextMenu.tsx", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(homeSource, /removeLocalPlayHistoryTrack\(/);
  assert.match(
    homeSource,
    /historySource === "wavelink"\s*\?\s*openHistoryContextMenu\s*:\s*undefined/,
  );
  assert.match(homeSource, /playedAt:\s*historyEntry\.playedAt/);
  assert.match(homeSource, /setLocalRecent\(loadLocalPlayHistory\(\)\)/);
  assert.match(collectionSource, /onContextMenu=\{onTrackContextMenu\}/);
  assert.match(itemSource, /onContextMenu=\{\(event\) => \{/);
  assert.match(itemSource, /event\.preventDefault\(\)/);
  assert.match(itemSource, /event\.stopPropagation\(\)/);
  assert.match(menuSource, /role="menu"/);
  assert.match(menuSource, /role="menuitem"/);
  assert.match(menuSource, /data-wl-owned="true"/);
  assert.match(menuSource, /Spicetify\.ReactDOM\.createPortal\(/);
  assert.match(menuSource, /<span>Delete<\/span>/);
  assert.match(menuSource, /event\.key === "Escape"/);
  assert.match(menuSource, /focus\(\{ preventScroll: true \}\)/);
});
