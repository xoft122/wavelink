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

const track = {
  id: "soundcloud:tracks:55",
  urn: "soundcloud:tracks:55",
  title: "Midnight Echo",
  permalink_url: "https://soundcloud.com/night-drive/midnight-echo",
};

function modelTargetUrl(model) {
  return model.trackUrl ?? model.targetUrl ?? model.profileUrl;
}

test("Like prompt clearly explains the manual SoundCloud handoff", () => {
  const model = prompt.createLikePromptModel(track);

  assert.match(model.title, /Like.*SoundCloud/i);
  assert.match(model.heading, /Midnight Echo/);
  assert.match(model.explanation, /WaveLink can(?:'|вЂ™|’)t/i);
  assert.match(model.explanation, /Like|Likes/i);
  assert.match(model.instruction, /open/i);
  assert.match(model.instruction, /SoundCloud/i);
  assert.match(model.instruction, /Like/i);
  assert.match(model.instruction, /return to WaveLink/i);
  assert.equal(
    modelTargetUrl(model),
    "https://soundcloud.com/night-drive/midnight-echo",
  );
  assert.deepEqual(model.actions, [
    { id: "cancel", label: "Cancel" },
    { id: "open", label: "Open track on SoundCloud" },
  ]);
});

test("Like prompt accepts only safe HTTPS SoundCloud track URLs", () => {
  const safe = prompt.createLikePromptModel({
    ...track,
    permalink_url:
      "https://soundcloud.com/night-drive/midnight-echo#comments",
  });
  assert.equal(
    modelTargetUrl(safe),
    "https://soundcloud.com/night-drive/midnight-echo",
  );

  for (const unsafeUrl of [
    "http://soundcloud.com/night-drive/midnight-echo",
    "javascript:alert(1)",
    "https://soundcloud.example/night-drive/midnight-echo",
    "https://evil.soundcloud.com.example/night-drive/midnight-echo",
    "https://user:password@soundcloud.com/night-drive/midnight-echo",
    "https://soundcloud.com:8443/night-drive/midnight-echo",
  ]) {
    const model = prompt.createLikePromptModel({
      ...track,
      permalink_url: unsafeUrl,
    });
    assert.equal(
      modelTargetUrl(model),
      "https://soundcloud.com/",
      unsafeUrl,
    );
  }
});

test("playlist likes use the same protected-action handoff", async () => {
  const model = prompt.createLikePromptModel(
    {
      title: "Night Drive Set",
      permalink_url: "https://soundcloud.com/night-drive/sets/night-drive",
    },
    "playlist",
  );
  assert.match(model.instruction, /Open the playlist/i);
  assert.deepEqual(model.actions, [
    { id: "cancel", label: "Cancel" },
    { id: "open", label: "Open playlist on SoundCloud" },
  ]);

  const playlistSource = await readFile(
    new URL("../src/components/PlaylistDetailView.tsx", import.meta.url),
    "utf8",
  );
  assert.match(playlistSource, /\bshowSoundCloudPlaylistLikePrompt\b/);
  assert.match(playlistSource, /\bunlikePlaylist\b/);
  assert.doesNotMatch(playlistSource, /\blikePlaylist\b/);
});

test("showSoundCloudLikePrompt is wired to the Like model and a Spotify modal", () => {
  assert.match(
    source,
    /export\s+function\s+showSoundCloudLikePrompt\s*\(/,
  );

  const functionStart = source.indexOf(
    "export function showSoundCloudLikePrompt",
  );
  assert.notEqual(functionStart, -1);
  const implementation = source.slice(functionStart);
  assert.match(implementation, /\bcreateLikePromptModel\s*\(/);
  assert.match(source, /\bSpicetify\.PopupModal\.display\s*\(/);
});

test("unliked tracks use the manual prompt while liked tracks retain real Unlike", async () => {
  const hookSource = await readFile(
    new URL("../src/hooks/useLikedTracks.ts", import.meta.url),
    "utf8",
  );

  assert.match(hookSource, /\bshowSoundCloudLikePrompt\b/);
  assert.match(hookSource, /\bunlikeTrack\b/);
  assert.doesNotMatch(
    hookSource,
    /\blikeTrack\b/,
    "the unliked path must not attempt a protected SoundCloud Like mutation",
  );

  assert.match(
    hookSource,
    /if\s*\(\s*!wasLiked\s*\)[\s\S]{0,500}\bshowSoundCloudLikePrompt\s*\(/,
    "the unliked branch opens the manual Like prompt",
  );
  const manualBranch = /if\s*\(\s*!wasLiked\s*\)/.exec(hookSource);
  assert.ok(manualBranch);
  const promptIndex = hookSource.indexOf(
    "showSoundCloudLikePrompt(",
    manualBranch.index,
  );
  const unlikeIndex = hookSource.indexOf("await unlikeTrack(", promptIndex);
  assert.equal(promptIndex > manualBranch.index, true);
  assert.equal(unlikeIndex > promptIndex, true);
  assert.match(
    hookSource.slice(promptIndex, unlikeIndex),
    /\breturn\s+false\b/,
    "the manual branch exits before the real Unlike mutation",
  );
});

test("Like status force-refreshes after returning from the browser", async () => {
  const hookSource = await readFile(
    new URL("../src/hooks/useLikedTracks.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    hookSource,
    /\bgetLikedTrackIds\s*\(\s*\{\s*force\s*\}\s*\)/,
  );
  assert.match(
    hookSource,
    /\brefreshLikedIds\s*\(\s*true\s*\)/,
  );
  assert.match(
    hookSource,
    /window\.addEventListener\(\s*["']focus["']\s*,\s*refreshAfterReturn\s*\)/,
  );
  assert.match(
    hookSource,
    /document\.addEventListener\(\s*["']visibilitychange["']\s*,\s*[A-Za-z_$][\w$]*\s*\)/,
  );
  assert.match(
    hookSource,
    /window\.removeEventListener\(\s*["']focus["']\s*,\s*refreshAfterReturn\s*\)/,
  );
  assert.match(
    hookSource,
    /document\.removeEventListener\(\s*["']visibilitychange["']\s*,\s*[A-Za-z_$][\w$]*\s*\)/,
  );
});
