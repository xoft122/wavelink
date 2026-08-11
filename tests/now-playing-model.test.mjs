import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/nowPlayingModel.ts", import.meta.url),
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

test("next queue preview selects the next explicit item", () => {
  assert.equal(model.nextQueueIndex(4, 1, "off"), 2);
  assert.equal(model.nextQueueIndex(4, -1, "off"), 0);
});

test("next queue preview follows repeat semantics", () => {
  // Repeat-one changes automatic advancement, but the queue preview still
  // represents the next explicit item selected by Skip/Click.
  assert.equal(model.nextQueueIndex(4, 2, "one"), 3);
  assert.equal(model.nextQueueIndex(4, 3, "one"), null);
  assert.equal(model.nextQueueIndex(4, 3, "all"), 0);
  assert.equal(model.nextQueueIndex(4, 3, "off"), null);
  assert.equal(model.nextQueueIndex(0, 0, "all"), null);
});
