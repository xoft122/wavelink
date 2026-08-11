import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const playerSource = await readFile(
  new URL("../src/services/player.ts", import.meta.url),
  "utf8",
);

function methodSource(startMarker, endMarker) {
  const start = playerSource.indexOf(startMarker);
  const end = playerSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `${startMarker} must exist`);
  assert.ok(end > start, `${endMarker} must follow ${startMarker}`);
  return playerSource.slice(start, end);
}

test("right-panel Spotify recovery mounts in the native missing-cover slot", () => {
  const discovery = methodSource(
    "private spotifyCoverRecoverySurfaces()",
    "private ensureSpotifyCoverRecoveryOverlay(",
  );
  const panelStart = discovery.indexOf(
    "for (const panelRoot of this.panelRoots())",
  );
  assert.notEqual(panelStart, -1);
  const panelDiscovery = discovery.slice(panelStart);

  assert.match(
    panelDiscovery,
    /note\?\.closest<HTMLElement>\(\s*["']\.cover-art["']\s*\)/,
    "the panel note must resolve Spotify's exact native cover-art slot",
  );
  assert.match(
    panelDiscovery,
    /img\.cover-art-image[^\n]*:not\(\[data-wl-owned\]\)[\s\S]{0,500}\.closest<HTMLElement>\(\s*["']\.cover-art["']\s*\)/,
    "a surviving native Spotify image may donate its exact cover-art slot",
  );

  const hostExpression = panelDiscovery.match(
    /const host\s*=([\s\S]*?);/,
  );
  assert.ok(hostExpression, "panel recovery must select one cover host");
  const host = hostExpression[1];
  const exactSlot = host.search(/cover-art|native(?:Cover|Image|Artwork)(?:Host|Slot)/i);
  const noteParent = host.indexOf("note?.parentElement");
  const structuralFallback = host.search(/structural|enhancement/i);
  assert.ok(exactSlot >= 0, "the exact native cover slot must be preferred");
  assert.ok(noteParent >= 0, "the note parent must remain a compatibility fallback");
  assert.ok(
    structuralFallback >= 0,
    "the broad structural container must remain only as the final fallback",
  );
  assert.ok(
    exactSlot < noteParent && noteParent < structuralFallback,
    "host precedence must be exact .cover-art slot, note parent, then broad NPV structure",
  );

  assert.match(
    panelDiscovery,
    /useSurface\(\s*host,\s*note\s*\)/,
    "the native note slot and its visibility signal must describe the same surface",
  );
});

test("recovered Spotify artwork uses the native cover image class", () => {
  const recovery = methodSource(
    "private ensureSpotifyCoverRecoveryOverlay(",
    "private reconcileSpotifyCoverRecovery(",
  );

  assert.match(
    recovery,
    /image\.(?:className\s*=|classList\.add\()[\s\S]{0,120}cover-art-image/,
    "the replacement must use Spotify's cover-art-image geometry instead of a bare absolute NPV overlay",
  );
  assert.match(
    recovery,
    /image\.(?:className\s*=|classList\.add\()[\s\S]{0,160}wl-spotify-cover-recovery/,
    "the native-looking replacement must remain WaveLink-owned for cleanup",
  );
});

test("right-panel recovery never falls back to an unrelated NPV image", () => {
  const discovery = methodSource(
    "private spotifyCoverRecoverySurfaces()",
    "private ensureSpotifyCoverRecoveryOverlay(",
  );
  const panelStart = discovery.indexOf(
    "for (const panelRoot of this.panelRoots())",
  );
  assert.notEqual(panelStart, -1);
  const panelDiscovery = discovery.slice(panelStart);

  assert.doesNotMatch(
    panelDiscovery,
    /panelRoot\.querySelector(?:All)?<HTMLImageElement>\([\s\S]{0,80}["']img(?:\[|["'])/,
    "Credits/About images cannot be geometry donors for the main NPV artwork",
  );
  for (const semanticHost of [
    "track-visual-enhancement",
    "main-nowPlayingView-coverArtVisualEnhancement",
    "main-nowPlayingView-coverArt",
    "main-nowPlayingView-coverArtContainer",
  ]) {
    assert.match(
      panelDiscovery,
      new RegExp(semanticHost),
      `the recovery fallback must still recognize ${semanticHost}`,
    );
  }
});
