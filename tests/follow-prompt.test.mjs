import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/followPrompt.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const prompt = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const user = {
  username: "Night Drive",
  permalink_url: "https://soundcloud.com/night-drive",
};

test("follow prompt clearly explains the manual SoundCloud handoff", () => {
  const model = prompt.createFollowPromptModel(user);
  assert.equal(model.title, "Follow on SoundCloud");
  assert.match(model.heading, /Follow Night Drive on SoundCloud/);
  assert.match(model.explanation, /WaveLink can’t change/i);
  assert.match(model.instruction, /select Follow there, then return to WaveLink/i);
  assert.deepEqual(model.actions, [
    { id: "cancel", label: "Cancel" },
    { id: "open", label: "Open SoundCloud profile" },
  ]);
});

test("following state uses the same safe handoff without promising a mutation", () => {
  const model = prompt.createFollowPromptModel(user, true);
  assert.equal(model.title, "Manage following on SoundCloud");
  assert.match(model.instruction, /change the follow status there/i);
  assert.doesNotMatch(model.explanation, /saved|updated successfully/i);
});

test("prompt accepts only HTTPS SoundCloud profile URLs", () => {
  assert.equal(
    prompt.normalizeSoundCloudProfileUrl("https://soundcloud.com/night-drive#tracks"),
    "https://soundcloud.com/night-drive",
  );
  assert.equal(
    prompt.normalizeSoundCloudProfileUrl("javascript:alert(1)"),
    "https://soundcloud.com/",
  );
  assert.equal(
    prompt.normalizeSoundCloudProfileUrl("https://soundcloud.example/night-drive"),
    "https://soundcloud.com/",
  );
  assert.equal(
    prompt.normalizeSoundCloudProfileUrl("https://evil.soundcloud.com.example/night-drive"),
    "https://soundcloud.com/",
  );
});

test("Open launches only the normalized profile and then closes", () => {
  const model = prompt.createFollowPromptModel(user);
  const events = [];
  prompt.performFollowPromptAction("open", model, {
    openExternal: (url) => events.push(["open", url]),
    close: () => events.push(["close"]),
  });
  assert.deepEqual(events, [
    ["open", "https://soundcloud.com/night-drive"],
    ["close"],
  ]);
});

test("Cancel closes without opening an external page", () => {
  const model = prompt.createFollowPromptModel(user);
  const events = [];
  prompt.performFollowPromptAction("cancel", model, {
    openExternal: (url) => events.push(["open", url]),
    close: () => events.push(["close"]),
  });
  assert.deepEqual(events, [["close"]]);
});

test("follow controls no longer import or call SoundCloud follow mutations", async () => {
  const [profileSource, playerSource] = await Promise.all([
    readFile(new URL("../src/components/UserProfileView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  ]);
  for (const candidate of [profileSource, playerSource]) {
    assert.doesNotMatch(candidate, /\bfollowUser\b/);
    assert.doesNotMatch(candidate, /\bunfollowUser\b/);
    assert.match(candidate, /\bshowSoundCloudFollowPrompt\b/);
  }
});
