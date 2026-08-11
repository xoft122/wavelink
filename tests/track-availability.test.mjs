import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/trackAvailability.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const availability = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function track(id, overrides = {}) {
  const urn = `soundcloud:tracks:${id}`;
  return {
    id: urn,
    urn,
    title: `Track ${id}`,
    duration: 180_000,
    kind: "track",
    artwork_url: null,
    permalink_url: `https://soundcloud.com/artist/track-${id}`,
    likes_count: 0,
    playback_count: 0,
    description: null,
    user: {
      id: "soundcloud:users:1",
      urn: "soundcloud:users:1",
      username: "Artist",
      avatar_url: "",
      permalink_url: "https://soundcloud.com/artist",
    },
    ...overrides,
  };
}

test("hard blocks and empty media are unavailable but streamable false alone remains unknown", () => {
  availability.resetConsumerProductAvailability();
  assert.equal(
    availability.TRACK_UNAVAILABLE_COUNTRY_LABEL,
    "Not available in your country",
  );
  assert.equal(availability.isTrackUnavailable(track(900_001)), false);
  assert.equal(
    availability.isTrackUnavailable(track(900_002, { access: "blocked" })),
    true,
  );
  assert.equal(
    availability.isTrackUnavailable(track(900_003, { policy: "BLOCK" })),
    true,
  );
  assert.equal(
    availability.isTrackUnavailable(track(900_004, { streamable: false })),
    false,
    "`streamable=false` is not proof that a valid preview is absent",
  );
  assert.equal(
    availability.isTrackUnavailable(
      track(900_005, { has_transcodings: false }),
    ),
    true,
  );
  assert.equal(
    availability.trackUnavailableLabel(
      track(900_005, { has_transcodings: false }),
    ),
    "Not available for playback",
  );
});

test("consumer quotation is reduced to a strict non-sensitive tri-state", () => {
  assert.equal(
    availability.normalizeConsumerProductAvailability({
      plans: [],
      active_subscription: {
        package: {
          product: "consumer-subscription",
          tier: "free",
          plan: "free",
        },
        is_eligible: false,
      },
    }),
    false,
  );
  assert.equal(
    availability.normalizeConsumerProductAvailability({
      plans: [{ id: "go-plus" }],
      active_subscription: {
        package: {
          product: "consumer-subscription",
          tier: "free",
          plan: "free",
        },
        is_eligible: false,
      },
    }),
    true,
  );
  assert.equal(
    availability.normalizeConsumerProductAvailability({
      plans: [],
      active_subscription: {
        package: {
          product: "consumer-subscription",
          tier: "go-plus",
          plan: "monthly",
        },
        is_eligible: false,
      },
    }),
    true,
  );
  assert.equal(
    availability.normalizeConsumerProductAvailability({
      plans: [],
      active_subscription: { is_eligible: false },
    }),
    undefined,
  );
  assert.equal(
    availability.normalizeConsumerProductAvailability(null),
    undefined,
  );
});

test("credential generation preserves a result from the other bundle only for the exact opaque key", () => {
  availability.resetConsumerProductAvailability();
  availability.prepareConsumerProductAvailability("credential-a");
  availability.setConsumerProductAvailability(false, "credential-a");
  availability.prepareConsumerProductAvailability("credential-a");
  assert.equal(
    availability.getConsumerProductAvailability("credential-a"),
    false,
  );

  availability.prepareConsumerProductAvailability("credential-b");
  assert.equal(
    availability.getConsumerProductAvailability("credential-a"),
    undefined,
  );
  assert.equal(
    availability.getConsumerProductAvailability("credential-b"),
    undefined,
  );
  availability.resetConsumerProductAvailability();
});

test("SNIP follows SoundCloud's compound product rule and uses the JWT geo only for its label", () => {
  const snip = track(900_020, {
    duration: 30_000,
    full_duration: 134_034,
    policy: "SNIP",
    streamable: false,
    has_transcodings: true,
    has_snipped_transcoding: true,
    has_full_transcoding: false,
    full_playable: false,
    preview_playable: true,
    authorization_geo: "UA",
  });

  availability.resetConsumerProductAvailability();
  assert.deepEqual(availability.classifyTrackAvailability(snip), {
    unavailable: false,
    reason: null,
    playback: "preview",
  });

  availability.setConsumerProductAvailability(true);
  assert.equal(availability.isTrackUnavailable(snip), false);

  availability.setConsumerProductAvailability(false);
  assert.deepEqual(availability.classifyTrackAvailability(snip), {
    unavailable: true,
    reason: "country",
    playback: "none",
  });
  assert.equal(
    availability.trackUnavailableLabel(snip),
    "Not available in Ukraine",
  );

  assert.equal(
    availability.isTrackUnavailable(
      track(900_021, {
        policy: "SNIP",
        full_playable: true,
        preview_playable: true,
      }),
    ),
    false,
    "a confirmed full stream wins even when product availability is false",
  );
  availability.resetConsumerProductAvailability();
});

test("resolver failures are cached with truthful per-reason labels", () => {
  const noStream = track(900_101);
  assert.equal(availability.isTrackUnavailable(noStream), false);
  assert.equal(
    availability.markTrackUnavailable(noStream, "no_stream"),
    noStream,
  );
  assert.equal(
    availability.isTrackUnavailable(track(900_101, { title: "Fresh clone" })),
    true,
  );
  assert.equal(
    availability.trackUnavailableLabel(track(900_101)),
    "Not available for playback",
  );

  availability.markTrackUnavailable(track(900_102), "country", "UA");
  assert.equal(
    availability.trackUnavailableLabel(track(900_102)),
    "Not available in Ukraine",
  );
  assert.equal(availability.isTrackUnavailable(track(900_103)), false);
});

test("only structured permanent media failures are automatically skippable", () => {
  assert.equal(
    availability.isCountryBlockedError({ code: "track_region_blocked" }),
    true,
  );
  assert.equal(
    availability.isCountryBlockedError({ code: "track_blocked" }),
    false,
  );
  assert.equal(
    availability.isCountryBlockedError({ code: "stream_unavailable" }),
    false,
  );
  for (const code of [
    "track_region_blocked",
    "track_blocked",
    "stream_unavailable",
  ]) {
    assert.equal(
      availability.isAutomaticallySkippableMediaError({ code }),
      true,
      code,
    );
  }
  assert.equal(
    availability.isAutomaticallySkippableMediaError({
      code: "soundcloud_timeout",
    }),
    false,
  );
  assert.equal(
    availability.isAutomaticallySkippableMediaError(new Error("network")),
    false,
  );
});

test("available queue traversal is bounded, skips attempted identities, and wraps only for repeat-all", () => {
  const tracks = [
    track(900_201, { access: "blocked" }),
    track(900_202, { access: "playable" }),
    track(900_203, { has_transcodings: false }),
    track(900_204, { access: "preview" }),
  ];

  assert.equal(availability.nextAvailableTrackIndex(tracks, -1, "off"), 1);
  assert.equal(availability.nextAvailableTrackIndex(tracks, 1, "off"), 3);
  assert.equal(availability.nextAvailableTrackIndex(tracks, 3, "off"), null);
  assert.equal(availability.nextAvailableTrackIndex(tracks, 3, "all"), 1);
  assert.equal(
    availability.nextAvailableTrackIndex([tracks[1]], 0, "all"),
    0,
  );
  assert.equal(
    availability.nextAvailableTrackIndex(
      tracks,
      0,
      "all",
      new Set(["soundcloud:tracks:900202"]),
    ),
    3,
  );
  assert.equal(availability.nextAvailableTrackIndex(tracks, 1, "one"), 3);
  assert.equal(availability.nextAvailableTrackIndex(tracks, 0, "one"), 1);
  assert.equal(availability.previousAvailableTrackIndex(tracks, 3), 1);
  assert.equal(availability.previousAvailableTrackIndex(tracks, 1), null);

  const unavailable = [
    track(900_205, { access: "blocked" }),
    track(900_206, { has_transcodings: false }),
  ];
  assert.equal(
    availability.nextAvailableTrackIndex(unavailable, -1, "all"),
    null,
  );
});
