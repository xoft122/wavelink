import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/followingStatus.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const followingStatus = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

function sorted(values) {
  return [...values].sort();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("canonicalFollowingUserId accepts numeric IDs and canonical user URNs", () => {
  assert.equal(followingStatus.canonicalFollowingUserId("1046848852"), "1046848852");
  assert.equal(
    followingStatus.canonicalFollowingUserId(
      "soundcloud:users:1046848852",
    ),
    "1046848852",
  );
  assert.throws(() =>
    followingStatus.canonicalFollowingUserId("soundcloud:tracks:1046848852")
  );
  assert.throws(() => followingStatus.canonicalFollowingUserId(""));
});

test("collectFollowingUserIds exhausts every page and deduplicates canonical IDs", async () => {
  const cursors = [];
  const pages = new Map([
    [
      "page-2",
      {
        collection: [
          {
            id: "soundcloud:users:22",
            urn: "soundcloud:users:22",
          },
          {
            id: "33",
            urn: "soundcloud:users:33",
          },
        ],
        next_href: "page-3",
      },
    ],
    [
      "page-3",
      {
        collection: [
          {
            id: "soundcloud:users:11",
            urn: "soundcloud:users:11",
          },
          {
            id: "44",
            urn: "soundcloud:users:44",
          },
        ],
        next_href: null,
      },
    ],
  ]);

  const ids = await followingStatus.collectFollowingUserIds(
    async () => ({
      collection: [
        {
          id: "11",
          urn: "soundcloud:users:11",
        },
      ],
      next_href: "page-2",
    }),
    async (cursor) => {
      cursors.push(cursor);
      return pages.get(cursor);
    },
  );

  assert.deepEqual(cursors, ["page-2", "page-3"]);
  assert.deepEqual(sorted(ids), ["11", "22", "33", "44"]);
  assert.equal(ids.has("44"), true, "a user found only on the last page is included");
});

test("collectFollowingUserIds rejects repeated cursors instead of trusting a partial set", async () => {
  await assert.rejects(
    followingStatus.collectFollowingUserIds(
      async () => ({
        collection: [{ id: "1", urn: "soundcloud:users:1" }],
        next_href: "same-page",
      }),
      async () => ({
        collection: [{ id: "2", urn: "soundcloud:users:2" }],
        next_href: "same-page",
      }),
    ),
    Error,
  );
});

test("collectFollowingUserIds propagates pagination failures", async () => {
  const failure = new Error("page two unavailable");
  await assert.rejects(
    followingStatus.collectFollowingUserIds(
      async () => ({
        collection: [{ id: "1", urn: "soundcloud:users:1" }],
        next_href: "page-2",
      }),
      async () => {
        throw failure;
      },
    ),
    (error) => error === failure,
  );
});

test("collectFollowingUserIds rejects an unfinished collection at the page limit", async () => {
  await assert.rejects(
    followingStatus.collectFollowingUserIds(
      async () => ({
        collection: [{ id: "1", urn: "soundcloud:users:1" }],
        next_href: "page-2",
      }),
      async () => ({
        collection: [{ id: "2", urn: "soundcloud:users:2" }],
        next_href: null,
      }),
      1,
    ),
    Error,
  );
});

test("following status cache deduplicates concurrent loads and returns defensive copies", async () => {
  const pending = deferred();
  const backing = new Set(["11"]);
  let calls = 0;
  const cache = followingStatus.createFollowingStatusCache(async (key) => {
    calls += 1;
    assert.equal(key, "account-a");
    await pending.promise;
    return backing;
  }, 60_000);

  const firstPromise = cache.get("account-a");
  const secondPromise = cache.get("account-a");
  assert.equal(calls, 1);

  pending.resolve();
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  assert.deepEqual(sorted(first), ["11"]);
  assert.deepEqual(sorted(second), ["11"]);
  assert.notEqual(first, second);

  first.add("attacker-controlled");
  backing.add("mutated-after-load");
  const cached = await cache.get("account-a");
  assert.equal(calls, 1);
  assert.deepEqual(sorted(cached), ["11"]);
  assert.notEqual(cached, second);
});

test("force refresh replaces a still-valid cached following set", async () => {
  let calls = 0;
  const cache = followingStatus.createFollowingStatusCache(async () => {
    calls += 1;
    return new Set(calls === 1 ? ["11"] : ["22"]);
  }, 60_000);

  assert.deepEqual(sorted(await cache.get("account-a")), ["11"]);
  assert.deepEqual(sorted(await cache.get("account-a")), ["11"]);
  assert.equal(calls, 1);

  assert.deepEqual(
    sorted(await cache.get("account-a", { force: true })),
    ["22"],
  );
  assert.deepEqual(sorted(await cache.get("account-a")), ["22"]);
  assert.equal(calls, 2);
});

test("invalidate prevents an older in-flight load from overwriting fresh state", async () => {
  const requests = [];
  let calls = 0;
  const cache = followingStatus.createFollowingStatusCache(async (key) => {
    calls += 1;
    assert.equal(key, "account-a");
    const request = deferred();
    requests.push(request);
    return request.promise;
  }, 60_000);

  const stalePromise = cache.get("account-a");
  cache.invalidate();
  const freshPromise = cache.get("account-a");
  assert.equal(calls, 2);

  requests[1].resolve(new Set(["fresh"]));
  assert.deepEqual(sorted(await freshPromise), ["fresh"]);

  requests[0].resolve(new Set(["stale"]));
  assert.deepEqual(sorted(await stalePromise), ["stale"]);

  assert.deepEqual(sorted(await cache.get("account-a")), ["fresh"]);
  assert.equal(calls, 2, "the stale completion did not evict the fresh cache");
});

test("follow status uses the complete collection and refreshes after returning to Spotify", async () => {
  const [apiSource, profileSource, playerSource, directSource] = await Promise.all([
    readFile(new URL("../src/services/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/components/UserProfileView.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/services/player.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/services/directSoundcloud.ts", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(apiSource, /request\(`\/me\/followings\//);
  assert.match(apiSource, /collectFollowingUserIds/);
  assert.match(apiSource, /getFollowings\(200\)/);
  assert.match(profileSource, /isFollowingUser\(profileUrn,\s*\{\s*force\s*\}\)/);
  assert.match(profileSource, /addEventListener\("focus",\s*refreshAfterReturn\)/);
  assert.match(playerSource, /isFollowingUser\(key,\s*\{\s*force\s*\}\)/);
  assert.match(playerSource, /_onFollowingStatusRefresh/);
  assert.match(
    directSource,
    /typeof value\.followed_by_user === "boolean"[\s\S]*?: undefined/,
  );
});
