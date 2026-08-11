import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/recentHistoryDisclosure.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const disclosure = await import(moduleUrl);

test("recent history stays compact through the eight-track boundary", () => {
  const eight = Array.from({ length: 8 }, (_, index) => index + 1);

  assert.deepEqual(disclosure.visibleRecentHistory([], false), []);
  assert.deepEqual(disclosure.visibleRecentHistory(eight, false), eight);
  assert.equal(disclosure.canExpandRecentHistory([]), false);
  assert.equal(disclosure.canExpandRecentHistory(eight), false);
});

test("recent history expands from eight tracks to every available track", () => {
  const nine = Array.from({ length: 9 }, (_, index) => index + 1);
  const hundred = Array.from({ length: 100 }, (_, index) => index + 1);

  assert.deepEqual(disclosure.visibleRecentHistory(nine, false), nine.slice(0, 8));
  assert.deepEqual(disclosure.visibleRecentHistory(nine, true), nine);
  assert.deepEqual(disclosure.visibleRecentHistory(hundred, false), hundred.slice(0, 8));
  assert.deepEqual(disclosure.visibleRecentHistory(hundred, true), hundred);
  assert.equal(disclosure.canExpandRecentHistory(nine), true);
  assert.equal(disclosure.canExpandRecentHistory(hundred), true);
});

test("recent history disclosure preserves ordering and never exposes its input array", () => {
  const input = Array.from({ length: 10 }, (_, index) => ({ id: index + 1 }));
  const expanded = disclosure.visibleRecentHistory(input, true);
  const compact = disclosure.visibleRecentHistory(input, false);

  expanded.reverse();
  compact.pop();

  assert.deepEqual(input.map((item) => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.notEqual(expanded, input);
  assert.notEqual(compact, input);
});
