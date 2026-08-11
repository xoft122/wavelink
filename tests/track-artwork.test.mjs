import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const artworkSource = await readFile(
  new URL("../src/services/trackArtwork.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(artworkSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const artwork = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const expectedFallback =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 44'%3E%3Crect width='44' height='44' fill='%23333'/%3E%3Ccircle cx='22' cy='22' r='8' fill='%23ff5500' opacity='.6'/%3E%3Ccircle cx='22' cy='22' r='3' fill='%23ff5500'/%3E%3C/svg%3E";

test("track artwork uses the exact orange WaveLink list fallback", () => {
  assert.equal(artwork.WAVELINK_TRACK_FALLBACK_ARTWORK, expectedFallback);
  for (const missing of [undefined, null, "", "   "]) {
    assert.equal(
      artwork.soundCloudTrackArtworkUrl(missing, "t500x500"),
      expectedFallback,
    );
  }
});

test("SoundCloud artwork is upgraded to the requested rendition", () => {
  assert.equal(
    artwork.soundCloudTrackArtworkUrl(
      "https://i1.sndcdn.com/artworks-demo-large.jpg",
      "t500x500",
    ),
    "https://i1.sndcdn.com/artworks-demo-t500x500.jpg",
  );
});

test("native player cover recovery owns Spotify note placeholders safely", async () => {
  const [playerSource, trackItemSource] = await Promise.all([
    readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/TrackItem.tsx", import.meta.url), "utf8"),
  ]);
  const applyStart = playerSource.indexOf("private applyTrackInfo(): void");
  const applyEnd = playerSource.indexOf("// ── Media attachment", applyStart);
  const applyTrackInfo = playerSource.slice(applyStart, applyEnd);
  const collectStart = playerSource.indexOf("private collectCoverTargets(");
  const collectEnd = playerSource.indexOf(
    "private imageState(",
    collectStart,
  );
  const collectCoverTargets = playerSource.slice(collectStart, collectEnd);

  assert.match(playerSource, /private ensureOwnedCover\(/);
  assert.match(playerSource, /\.cover-art-icon/);
  assert.match(playerSource, /data-wl-owned", "cover"/);
  assert.match(playerSource, /this\._failedCoverSources\.add\(failedSource\);[\s\S]{0,220}this\.applyTrackInfo\(\);/);
  assert.match(playerSource, /removeEventListener\("error", this\._onCoverImageError\)/);
  assert.match(playerSource, /for \(const root of Array\.from\(this\._ownedCoverBindings\.keys\(\)\)\)/);
  assert.match(
    collectCoverTargets,
    /!cover && structuralHost[\s\S]{0,120}useTarget\(panelRoot, null, structuralHost\);[\s\S]{0,60}continue;/,
    "a Spotify note placeholder must receive an owned cover immediately",
  );
  assert.match(
    collectCoverTargets,
    /\[data-testid=\\?"track-visual-enhancement\\?"\]/,
  );
  assert.match(
    collectCoverTargets,
    /\.main-nowPlayingView-coverArtContainer/,
  );
  assert.doesNotMatch(
    collectCoverTargets,
    /panelRoot\.querySelectorAll<HTMLImageElement>\("img"\)|image\.naturalWidth|images\[0\]/,
    "hidden Credits/About images must never be mistaken for the main cover",
  );
  assert.match(applyTrackInfo, /soundCloudTrackArtworkUrl\(\s*track\.artwork_url,\s*"t500x500"/);
  assert.match(
    applyTrackInfo,
    /art === WAVELINK_TRACK_FALLBACK_ARTWORK \? null : art/,
  );
  assert.match(
    applyTrackInfo,
    /this\.collectCoverTargets\(\s*art === WAVELINK_TRACK_FALLBACK_ARTWORK,?\s*\)/,
    "the local fallback must use an owned overlay instead of mutating Spotify's native image",
  );
  assert.match(
    collectCoverTargets,
    /preferOwnedCover && host[\s\S]{0,180}this\.ensureOwnedCover\(root, host\)/,
  );
  assert.doesNotMatch(applyTrackInfo, /track\.user\.avatar_url/);
  assert.doesNotMatch(applyTrackInfo, /if \(art\)/);

  assert.match(trackItemSource, /soundCloudTrackArtworkUrl\(track\.artwork_url, "t67x67"\)/);
  assert.doesNotMatch(trackItemSource, /const FALLBACK_ART/);
});
