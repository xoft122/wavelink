import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const promptSource = await readFile(
  new URL("../src/services/followPrompt.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(promptSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const prompt = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const track = {
  title: "Midnight Echo",
  permalink_url: "https://soundcloud.com/night-drive/midnight-echo",
};
const playlist = {
  title: "Night Drive Set",
  permalink_url: "https://soundcloud.com/night-drive/sets/night-drive",
};

test("track repost and unrepost use a truthful SoundCloud handoff", () => {
  const repost = prompt.createRepostPromptModel(track, "track", false);
  assert.equal(repost.title, "Repost on SoundCloud");
  assert.match(repost.explanation, /can't change SoundCloud reposts directly/i);
  assert.match(repost.instruction, /select Repost there/i);
  assert.match(repost.instruction, /return to WaveLink/i);
  assert.equal(repost.profileUrl, track.permalink_url);

  const unrepost = prompt.createRepostPromptModel(track, "track", true);
  assert.equal(unrepost.title, "Manage repost on SoundCloud");
  assert.match(unrepost.instruction, /Repost again/i);
  assert.match(unrepost.instruction, /remove the repost/i);
  assert.doesNotMatch(unrepost.explanation, /updated successfully/i);
});

test("playlist repost opens the exact safe playlist page", () => {
  const model = prompt.createRepostPromptModel(playlist, "playlist");
  assert.match(model.instruction, /Open the playlist/i);
  assert.equal(model.profileUrl, playlist.permalink_url);
  assert.deepEqual(model.actions, [
    { id: "cancel", label: "Cancel" },
    { id: "open", label: "Open playlist on SoundCloud" },
  ]);
});

test("Create playlist explains SoundCloud's real track-first flow", () => {
  const model = prompt.createPlaylistMutationPromptModel("create");
  assert.equal(model.profileUrl, "https://soundcloud.com/");
  assert.match(model.explanation, /can't create SoundCloud playlists directly/i);
  assert.match(model.instruction, /choose any track/i);
  assert.match(model.instruction, /three-dot menu/i);
  assert.match(model.instruction, /Add to playlist/i);
  assert.match(model.instruction, /create a new playlist/i);
  assert.match(model.instruction, /return to WaveLink/i);
});

test("Edit playlist opens a normalized permalink and explains Save", () => {
  const model = prompt.createPlaylistMutationPromptModel("edit", {
    ...playlist,
    permalink_url: `${playlist.permalink_url}#comments`,
  });
  assert.equal(model.profileUrl, playlist.permalink_url);
  assert.match(model.heading, /Night Drive Set/i);
  assert.match(model.instruction, /pencil\/Edit/i);
  assert.match(model.instruction, /save your changes/i);

  const unsafe = prompt.createPlaylistMutationPromptModel("edit", {
    ...playlist,
    permalink_url: "javascript:alert(1)",
  });
  assert.equal(unsafe.profileUrl, "https://soundcloud.com/");
});

test("protected mutations are no longer called by WaveLink components", async () => {
  const [trackItem, playlistDetail, library, hook] = await Promise.all([
    readFile(new URL("../src/components/TrackItem.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/PlaylistDetailView.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/components/LibraryView.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/hooks/useExternalActionRefresh.ts", import.meta.url),
      "utf8",
    ),
  ]);
  const components = `${trackItem}\n${playlistDetail}\n${library}`;

  for (const mutation of [
    "repostTrack",
    "unrepostTrack",
    "repostPlaylist",
    "unrepostPlaylist",
    "createPlaylist",
    "updatePlaylist",
  ]) {
    assert.doesNotMatch(components, new RegExp(`\\b${mutation}\\b`));
  }

  assert.match(trackItem, /\bshowSoundCloudTrackRepostPrompt\b/);
  assert.match(trackItem, /\bgetTrack\b/);
  assert.match(playlistDetail, /\bshowSoundCloudPlaylistRepostPrompt\b/);
  assert.match(playlistDetail, /\bshowSoundCloudEditPlaylistPrompt\b/);
  assert.match(playlistDetail, /\bunlikePlaylist\b/);
  assert.match(playlistDetail, /\bgetPlaylistTrackSource\b/);
  assert.match(library, /\bshowSoundCloudCreatePlaylistPrompt\b/);
  assert.match(library, /\bload\(\s*["']playlists["']\s*,\s*true\s*\)/);

  assert.match(hook, /document\.visibilityState === ["']hidden["']/);
  assert.match(hook, /inFlightRef\.current/);
  assert.match(hook, /window\.addEventListener\(\s*["']focus["']/);
  assert.match(hook, /window\.removeEventListener\(\s*["']focus["']/);
  assert.match(hook, /Keep the request pending/);
});
