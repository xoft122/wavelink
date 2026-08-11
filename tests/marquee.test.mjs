import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/marquee.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const marquee = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

test("marquee remains disabled when text fits", () => {
  assert.equal(marquee.calculateMarqueeMotion(-10), null);
  assert.equal(marquee.calculateMarqueeMotion(0), null);
  assert.equal(marquee.calculateMarqueeMotion(1), null);
});

test("marquee timeline pauses at both ends and returns to the start", () => {
  const motion = marquee.calculateMarqueeMotion(120);
  assert.ok(motion);
  assert.equal(motion.distancePx, 120);
  assert.equal(motion.durationMs, 22_000);
  assert.deepEqual(motion.offsets, [
    0,
    1_000 / 22_000,
    11_000 / 22_000,
    12_000 / 22_000,
    1,
  ]);
  assert.equal(
    motion.offsets.every((offset, index, all) =>
      index === 0 || offset >= all[index - 1],
    ),
    true,
  );
});

test("marquee rounds fractional overflow and enforces readable travel time", () => {
  const motion = marquee.calculateMarqueeMotion(2.2);
  assert.ok(motion);
  assert.equal(motion.distancePx, 3);
  assert.equal(motion.durationMs, 5_000);
});
