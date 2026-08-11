import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

async function importTypeScript(relativeUrl) {
  const source = await readFile(new URL(relativeUrl, import.meta.url), "utf8");
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

const images = await importTypeScript(
  "../src/services/soundCloudImages.ts",
);

test("avatar resolver upgrades SoundCloud thumbnails without losing URL metadata", () => {
  const sources = images.soundCloudAvatarSources(
    "https://i1.sndcdn.com/avatars-account-large.jpg?source=-large.jpg#avatar",
  );

  assert.deepEqual(sources, {
    primary:
      "https://i1.sndcdn.com/avatars-account-t500x500.jpg?source=-large.jpg#avatar",
    fallback:
      "https://i1.sndcdn.com/avatars-account-large.jpg?source=-large.jpg#avatar",
  });
});

test("avatar resolver handles known renditions and requested display sizes", () => {
  for (const rendition of ["mini", "tiny", "small", "badge", "crop", "t67x67"]) {
    assert.equal(
      images.soundCloudAvatarUrl(
        `https://i1.sndcdn.com/avatars-account-${rendition}.jpg`,
        "t300x300",
      ),
      "https://i1.sndcdn.com/avatars-account-t300x300.jpg",
    );
  }

  assert.equal(
    images.soundCloudAvatarUrl(
      "https://i1.sndcdn.com/avatars-account-original.jpg",
    ),
    "https://i1.sndcdn.com/avatars-account-t500x500.jpg",
  );
  assert.equal(
    images.soundCloudAvatarUrl(
      "https://sndcdn.com/avatars-account-large.webp",
      "t200x200",
    ),
    "https://sndcdn.com/avatars-account-t200x200.webp",
  );
});

test("avatar resolver is idempotent and treats SoundCloud defaults as missing", () => {
  assert.deepEqual(
    images.soundCloudAvatarSources(
      "https://i1.sndcdn.com/avatars-account-t500x500.jpg",
    ),
    {
      primary: "https://i1.sndcdn.com/avatars-account-t500x500.jpg",
      fallback: null,
    },
  );
  assert.equal(
    images.soundCloudAvatarUrl(
      "https://i1.sndcdn.com/images/default_avatar_large.png",
    ),
    "",
  );
  assert.equal(
    images.soundCloudAvatarUrl(
      "https://a1.sndcdn.com/images/default_avatar_t500x500.webp?source=profile#avatar",
    ),
    "",
  );
  assert.equal(
    images.soundCloudAvatarUrl(
      "https://i1.sndcdn.com/avatars-account.jpg",
    ),
    "https://i1.sndcdn.com/avatars-account.jpg",
  );
});

test("avatar resolver rejects URLs outside the trusted SoundCloud CDN", () => {
  for (const unsafe of [
    "",
    "not a URL",
    "http://i1.sndcdn.com/avatars-account-large.jpg",
    "https://sndcdn.com.evil.example/avatars-account-large.jpg",
    "https://evil-sndcdn.com/avatars-account-large.jpg",
    "https://user:password@i1.sndcdn.com/avatars-account-large.jpg",
    "https://i1.sndcdn.com:444/avatars-account-large.jpg",
  ]) {
    assert.equal(images.soundCloudAvatarSources(unsafe), null);
    assert.equal(images.soundCloudAvatarUrl(unsafe), "");
  }

  const validAvatar =
    "https://i1.sndcdn.com/avatars-account-large.jpg";
  assert.equal(
    images.soundCloudAvatarSources(validAvatar, "t900x900"),
    null,
  );
  assert.equal(
    images.soundCloudAvatarUrl(validAvatar, "t900x900"),
    "",
  );
});

test("avatar fallback moves from requested rendition to original and then SVG", () => {
  const sources = images.soundCloudAvatarSources(
    "https://i1.sndcdn.com/avatars-account-large.jpg",
  );
  assert.ok(sources);
  const svgFallback = "data:image/svg+xml,fallback";

  assert.equal(
    images.nextSoundCloudAvatarSource(
      sources.primary,
      sources,
      svgFallback,
    ),
    sources.fallback,
  );
  assert.equal(
    images.nextSoundCloudAvatarSource(
      sources.fallback,
      sources,
      svgFallback,
    ),
    svgFallback,
  );
  assert.equal(
    images.nextSoundCloudAvatarSource("", null, svgFallback),
    svgFallback,
  );
  assert.equal(
    images.nextSoundCloudAvatarSource(svgFallback, sources, svgFallback),
    svgFallback,
    "a failed terminal SVG must not loop back to the remote rendition",
  );
});

test("avatar fallback is the exact safe neon WaveLink asset", () => {
  const prefix = "data:image/svg+xml;charset=utf-8,";
  assert.ok(images.WAVELINK_USER_AVATAR_FALLBACK.startsWith(prefix));
  const svg = decodeURIComponent(
    images.WAVELINK_USER_AVATAR_FALLBACK.slice(prefix.length),
  );

  assert.equal(svg, images.WAVELINK_USER_AVATAR_SVG);
  assert.match(svg, /viewBox="178 179 892 892"/);
  assert.match(svg, /<circle cx="624" cy="625" r="437" stroke-width="18" fill="#000"\/>/);
  const [, minX, minY, width, height] = svg.match(
    /viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/,
  ).map(Number);
  const glowCenterX = 624;
  const glowCenterY = 625;
  const glowRadius = 437;
  const glowStrokeRadius = 18 / 2;
  assert.equal(glowCenterX - glowRadius - glowStrokeRadius, minX);
  assert.equal(glowCenterY - glowRadius - glowStrokeRadius, minY);
  assert.equal(glowCenterX + glowRadius + glowStrokeRadius, minX + width);
  assert.equal(glowCenterY + glowRadius + glowStrokeRadius, minY + height);
  assert.equal(width, height);
  assert.ok((2 * 437 + 14) / width >= 0.995);
  assert.match(svg, /id="neonGradient"/);
  assert.match(svg, /id="softGlow"/);
  for (const color of ["#ff9d00", "#ff6b2c", "#ff4f4f", "#ff008a"]) {
    assert.ok(svg.includes(color));
  }
  assert.doesNotMatch(svg, /#262626|#757575/i);
  assert.doesNotMatch(
    svg,
    /<(?:script|foreignObject|image)\b|(?:href|xlink:href)=/i,
  );
});

test("React, Credits and fullscreen share the neon terminal avatar", async () => {
  const [componentSource, playerSource] = await Promise.all([
    readFile(
      new URL("../src/components/SoundCloudAvatar.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
  ]);
  const creditsStart = playerSource.indexOf("private renderCreditsSection(");
  const creditsEnd = playerSource.indexOf(
    "private renderQueueSection(",
    creditsStart,
  );
  const credits = playerSource.slice(creditsStart, creditsEnd);
  const fullscreenStart = playerSource.indexOf(
    "private syncCinemaArtistBinding(",
  );
  const fullscreenEnd = playerSource.indexOf(
    "private reconcileCinemaArtistSurface(",
    fullscreenStart,
  );
  const fullscreen = playerSource.slice(fullscreenStart, fullscreenEnd);

  assert.match(
    componentSource,
    /FALLBACK_USER_AVATAR = WAVELINK_USER_AVATAR_FALLBACK/,
  );
  assert.doesNotMatch(componentSource, /#262626|#757575/i);
  assert.match(credits, /soundCloudAvatarSources\([\s\S]*?"t200x200"/);
  assert.match(credits, /WAVELINK_USER_AVATAR_FALLBACK/);
  assert.match(credits, /nextSoundCloudAvatarSource\(/);
  assert.match(fullscreen, /soundCloudAvatarSources\([\s\S]*?"t500x500"/);
  assert.match(fullscreen, /avatarSources\?\.primary \?\? WAVELINK_USER_AVATAR_FALLBACK/);
  assert.match(fullscreen, /avatarSources\?\.fallback \?\? WAVELINK_USER_AVATAR_FALLBACK/);
  assert.match(fullscreen, /!binding\.avatar\.dataset\.failedSrc/);
});

test("Welcome back and opened profiles request the large avatar rendition", async () => {
  const [homeSource, profileSource] = await Promise.all([
    readFile(new URL("../src/components/HomeView.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../src/components/UserProfileView.tsx", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(
    homeSource,
    /<SoundCloudAvatar[\s\S]*?avatarUrl=\{user\.avatar_url\}[\s\S]*?preset="t500x500"/,
  );
  assert.match(
    profileSource,
    /<SoundCloudAvatar[\s\S]*?avatarUrl=\{profile\.avatar_url\}[\s\S]*?preset="t500x500"/,
  );
  assert.doesNotMatch(
    homeSource,
    /<img[^>]+src=\{user\.avatar_url\}/,
  );
  assert.doesNotMatch(
    profileSource,
    /<img[^>]+src=\{profile\.avatar_url\}/,
  );
});
