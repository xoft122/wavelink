import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

async function importTypeScriptModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
}

const transportModel = await importTypeScriptModule(
  "../src/services/nativeTransportModel.ts",
);
const icons = await importTypeScriptModule(
  "../src/services/soundCloudIcons.ts",
);
const playerSource = await readFile(
  new URL("../src/services/player.ts", import.meta.url),
  "utf8",
);
const nowPlayingSource = await readFile(
  new URL("../src/components/NowPlaying.tsx", import.meta.url),
  "utf8",
);
const appCss = await readFile(
  new URL("../src/styles/app.css", import.meta.url),
  "utf8",
);

test("WaveLink extras are positioned outside Spotify transport flex sizing", () => {
  const centers = transportModel.nativeTransportControlCenters(
    100,
    { left: 420, right: 452 },
    { left: 468, right: 500 },
    { left: 516, right: 548 },
    32,
  );

  assert.deepEqual(centers, {
    shuffle: 288,
    repeat: 480,
    queue: 528,
  });
  assert.match(
    playerSource,
    /body\.sc-active \.wavelink-native-controls-host \{[\s\S]*?position:\s*relative;/,
  );
  assert.match(
    playerSource,
    /#wavelink-native-controls \{[\s\S]*?position:\s*absolute;[\s\S]*?pointer-events:\s*none;/,
  );
  assert.match(
    playerSource,
    /nativeTransportControlCenters\([\s\S]*?shuffle\.style\.left[\s\S]*?repeat\.style\.left[\s\S]*?queue\.style\.left/,
  );
});

test("transport positioning remains correct with fractional DPI coordinates", () => {
  assert.deepEqual(
    transportModel.nativeTransportControlCenters(
      19.25,
      { left: 300.75, right: 332.75 },
      { left: 340.25, right: 372.25 },
      { left: 379.75, right: 411.75 },
      32,
    ),
    {
      shuffle: 258,
      repeat: 416,
      queue: 455.5,
    },
  );
});

test("Spotify hover scaling cannot pull WaveLink controls toward the center", () => {
  const baseline = transportModel.nativeTransportControlCenters(
    100,
    { left: 420, right: 452 },
    { left: 468, right: 500 },
    { left: 516, right: 548 },
    32,
  );
  const previousHovered = transportModel.nativeTransportControlCenters(
    100,
    { left: 419.04, right: 452.96 },
    { left: 468, right: 500 },
    { left: 516, right: 548 },
    32,
  );
  const playHovered = transportModel.nativeTransportControlCenters(
    100,
    { left: 420, right: 452 },
    { left: 467.04, right: 500.96 },
    { left: 516, right: 548 },
    32,
  );
  const nextHovered = transportModel.nativeTransportControlCenters(
    100,
    { left: 420, right: 452 },
    { left: 468, right: 500 },
    { left: 515.04, right: 548.96 },
    32,
  );

  assert.deepEqual(previousHovered, baseline);
  assert.deepEqual(playHovered, baseline);
  assert.deepEqual(nextHovered, baseline);
});

test("hover and keyboard focus never move the positioned transport controls", () => {
  const hoverRule = playerSource.match(
    /#wavelink-native-controls \.wl-native-control:hover,[\s\S]*?\{([\s\S]*?)\}/,
  );
  assert.ok(hoverRule, "the owned controls need an explicit hover/focus rule");
  assert.match(hoverRule[1], /color:\s*var\(--text-base/);
  assert.doesNotMatch(hoverRule[1], /transform|scale|translate/);
  assert.match(
    playerSource,
    /#wavelink-native-controls \.wl-native-control \{[\s\S]*?transform:\s*translate\(-50%, -50%\);/,
  );
});

test("repeat and repeat-once use SoundCloud's original filled SVG geometry", () => {
  assert.equal(icons.SOUNDCLOUD_REPEAT_VIEW_BOX, "0 0 16 16");
  assert.equal(icons.SOUNDCLOUD_REPEAT_PATHS.length, 1);
  assert.equal(icons.SOUNDCLOUD_REPEAT_ONCE_PATHS.length, 3);
  assert.match(
    icons.SOUNDCLOUD_REPEAT_PATHS[0],
    /^M1\.25 8C1\.25 5\.37665/,
  );
  assert.match(
    icons.SOUNDCLOUD_REPEAT_ONCE_PATHS[0],
    /^M12\.5 8C14\.433 8 16 6\.433/,
  );
  assert.notDeepEqual(
    icons.SOUNDCLOUD_REPEAT_PATHS,
    icons.SOUNDCLOUD_REPEAT_ONCE_PATHS,
  );

  const repeat = icons.renderSoundCloudRepeatSvg(false, "repeat");
  const repeatOnce = icons.renderSoundCloudRepeatSvg(true, "repeat-once");
  assert.match(repeat, /viewBox="0 0 16 16"/);
  assert.match(repeat, /fill="currentColor"/);
  assert.match(repeatOnce, /class="repeat-once"/);
  assert.doesNotMatch(repeatOnce, />\s*1\s*</);
});

test("both WaveLink player surfaces switch to the real repeat-once asset", () => {
  assert.match(
    playerSource,
    /renderSoundCloudRepeatSvg\(false,[\s\S]*?renderSoundCloudRepeatSvg\(true,/,
  );
  assert.match(
    playerSource,
    /wl-native-repeat\[data-mode="one"\][\s\S]*?wl-native-repeat-icon--all[\s\S]*?display:\s*none;/,
  );
  assert.match(
    playerSource,
    /wl-native-repeat\[data-mode="one"\][\s\S]*?wl-native-repeat-icon--one[\s\S]*?display:\s*block;/,
  );
  assert.doesNotMatch(playerSource, /wl-native-repeat-one/);
  assert.match(
    nowPlayingSource,
    /soundCloudRepeatPaths\(repeatMode === "one"\)/,
  );
  assert.doesNotMatch(nowPlayingSource, /sc-now-playing__repeat-one/);
  assert.doesNotMatch(appCss, /\.sc-now-playing__repeat-one/);
});
