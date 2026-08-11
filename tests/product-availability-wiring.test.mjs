import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const apiSource = await readFile(
  new URL("../src/services/api.ts", import.meta.url),
  "utf8",
);

function sourceSlice(startMarker, endMarker) {
  const start = apiSource.indexOf(startMarker);
  const end = apiSource.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `Missing source marker: ${startMarker}`);
  assert.ok(end > start, `Missing source marker after ${startMarker}`);
  return apiSource.slice(start, end);
}

test("account bootstrap safely hydrates the exact SoundCloud consumer-product capability", () => {
  const hydration = sourceSlice(
    "async function hydrateConsumerProductAvailability",
    "export async function authenticateWebSession",
  );
  assert.match(
    hydration,
    /directSoundCloudRequest<unknown>\(\s*["']\/payments\/quotations\/consumer-subscription["']/,
  );
  assert.match(hydration, /app_version:\s*SOUNDCLOUD_WEB_APP_VERSION/);
  assert.match(hydration, /app_locale:\s*["']en["']/);
  assert.match(hydration, /credentialProvider:\s*\(\)\s*=>\s*credentials/);
  assert.match(hydration, /onUnauthorized:\s*\(\)\s*=>\s*undefined/);
  assert.match(
    hydration,
    /setConsumerProductAvailability\(\s*normalizeConsumerProductAvailability\(payload\)/,
  );
  assert.doesNotMatch(
    hydration,
    /\brequest<unknown>\(\s*["']\/payments/,
    "billing metadata must not enter the generic API debug logger",
  );
});

test("verified sessions prime product state before results and playback use it", () => {
  const authenticate = sourceSlice(
    "export async function authenticateWebSession",
    "export async function getSession",
  );
  const getSession = sourceSlice(
    "export async function getSession",
    "export async function getMe",
  );
  const media = sourceSlice(
    "export async function createMediaSession",
    "export async function getFeed",
  );
  assert.match(authenticate, /await hydrateConsumerProductAvailability\(credentials\)/);
  assert.match(getSession, /await hydrateConsumerProductAvailability\(credentials\)/);
  assert.match(
    media,
    /consumerProductAvailable:\s*getConsumerProductAvailability\(\)/,
  );
  assert.match(media, /["']track_region_blocked["']/);
});
