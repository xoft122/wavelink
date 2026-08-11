import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import ts from "typescript";

const source = await readFile(
  new URL("../src/services/authSessionStore.ts", import.meta.url),
  "utf8",
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;
const { createAuthSessionStore } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
);

const pairA = {
  accessToken: "oauth-pair-a",
  webClientId: "A".repeat(32),
};
const pairB = {
  accessToken: "oauth-pair-b",
  webClientId: "B".repeat(32),
};
const emptyPair = { accessToken: "", webClientId: "" };

function authenticatedSession(username = "listener") {
  return {
    version: "test",
    ready: true,
    mode: "account",
    configured: true,
    authenticated: true,
    setupUrl: "",
    callbackUrl: "",
    authMode: "manual_token_v2",
    user: {
      id: "soundcloud:users:42",
      urn: "soundcloud:users:42",
      username,
      avatar_url: "",
      permalink_url: "https://soundcloud.com/listener",
    },
  };
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

function createHarness(initialSettings, getSession) {
  let settings = { ...initialSettings };
  const listeners = new Set();
  let calls = 0;
  const store = createAuthSessionStore({
    loadSettings: () => ({ ...settings }),
    hasCredentials: (value) =>
      Boolean(value.accessToken && value.webClientId),
    isUnauthorizedError: (cause) => cause?.status === 401,
    getSession: async () => {
      calls += 1;
      return getSession(calls);
    },
    subscribeSettings(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  return {
    store,
    calls: () => calls,
    setSettings(next) {
      settings = { ...next };
      for (const listener of listeners) listener();
    },
  };
}

test("no credentials selects setup without making a session request", async () => {
  const harness = createHarness(emptyPair, async () => {
    throw new Error("must not run");
  });

  assert.deepEqual(harness.store.getSnapshot(), {
    phase: "setup",
    session: null,
    error: null,
    hasCredentials: false,
    isChecking: false,
  });
  assert.equal(await harness.store.ensureSession(), null);
  assert.equal(harness.calls(), 0);
  harness.store.destroy();
});

test("one verified session hydrates every later entry without another check", async () => {
  const session = authenticatedSession();
  const harness = createHarness(pairA, async () => session);

  assert.equal(harness.store.getSnapshot().phase, "checking");
  assert.equal(await harness.store.ensureSession(), session);
  assert.equal(harness.store.getSnapshot().phase, "authenticated");
  assert.equal(harness.store.getSnapshot().session, session);
  assert.equal(await harness.store.ensureSession(), session);
  assert.equal(harness.calls(), 1);
  harness.store.destroy();
});

test("extension and app callers share one in-flight account check", async () => {
  const pending = deferred();
  const session = authenticatedSession();
  const harness = createHarness(pairA, () => pending.promise);

  const extensionCheck = harness.store.ensureSession();
  const appCheck = harness.store.ensureSession();
  await Promise.resolve();
  assert.equal(harness.calls(), 1);

  pending.resolve(session);
  assert.equal(await extensionCheck, session);
  assert.equal(await appCheck, session);
  assert.equal(harness.store.getSnapshot().phase, "authenticated");
  harness.store.destroy();
});

test("a same-pair settings event never clears the verified account", async () => {
  const session = authenticatedSession();
  const harness = createHarness(pairA, async () => session);
  await harness.store.ensureSession();

  harness.setSettings(pairA);

  assert.equal(harness.store.getSnapshot().phase, "authenticated");
  assert.equal(harness.store.getSnapshot().session, session);
  assert.equal(harness.calls(), 1);
  harness.store.destroy();
});

test("an immediate verified connect cancels the queued settings-event check", async () => {
  const session = authenticatedSession();
  const harness = createHarness(emptyPair, async () => {
    throw new Error("the superseded check must never reach the network");
  });

  harness.setSettings(pairA);
  assert.equal(harness.store.commitAuthenticated(session, pairA), true);
  await Promise.resolve();
  await Promise.resolve();

  assert.equal(harness.calls(), 0);
  assert.equal(harness.store.getSnapshot().phase, "authenticated");
  assert.equal(harness.store.getSnapshot().session, session);
  harness.store.destroy();
});

test("a stale success for an old credential pair cannot replace the new account", async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  const oldSession = authenticatedSession("old account");
  const newSession = authenticatedSession("new account");
  const harness = createHarness(pairA, (call) =>
    call === 1 ? oldRequest.promise : newRequest.promise
  );

  const first = harness.store.ensureSession();
  await Promise.resolve();
  harness.setSettings(pairB);
  const second = harness.store.ensureSession();
  await Promise.resolve();
  assert.equal(harness.calls(), 2);

  newRequest.resolve(newSession);
  await second;
  assert.equal(harness.store.getSnapshot().session, newSession);

  oldRequest.resolve(oldSession);
  await first;
  assert.equal(harness.store.getSnapshot().session, newSession);
  harness.store.destroy();
});

test("transient revalidation failure retains a verified session", async () => {
  const session = authenticatedSession();
  const harness = createHarness(pairA, async (call) => {
    if (call === 1) return session;
    throw new Error("SoundCloud is temporarily unavailable.");
  });
  await harness.store.ensureSession();

  assert.equal(await harness.store.ensureSession(true), null);
  const snapshot = harness.store.getSnapshot();
  assert.equal(snapshot.phase, "authenticated");
  assert.equal(snapshot.session, session);
  assert.equal(snapshot.isChecking, false);
  assert.match(snapshot.error, /temporarily unavailable/);
  harness.store.destroy();
});

test("an initial transient error retries without falling back to onboarding", async () => {
  const session = authenticatedSession();
  const harness = createHarness(pairA, async (call) => {
    if (call === 1) throw new Error("Temporary network error.");
    return session;
  });

  assert.equal(await harness.store.ensureSession(), null);
  assert.equal(harness.store.getSnapshot().phase, "error");
  assert.equal(harness.store.getSnapshot().hasCredentials, true);

  assert.equal(await harness.store.ensureSession(true), session);
  assert.equal(harness.store.getSnapshot().phase, "authenticated");
  assert.equal(harness.store.getSnapshot().session, session);
  harness.store.destroy();
});

test("an unauthorized saved pair becomes setup even if storage cleanup fails", async () => {
  const unauthorized = Object.assign(
    new Error("The saved SoundCloud session expired."),
    { status: 401 },
  );
  const harness = createHarness(pairA, async () => {
    throw unauthorized;
  });

  assert.equal(await harness.store.ensureSession(), null);
  const snapshot = harness.store.getSnapshot();
  assert.equal(snapshot.phase, "setup");
  assert.equal(snapshot.session, null);
  assert.equal(snapshot.hasCredentials, false);
  assert.match(snapshot.error, /expired/);

  assert.equal(await harness.store.ensureSession(), null);
  assert.equal(harness.calls(), 1);
  harness.store.destroy();
});

test("unauthorized revalidation never retains the previously verified user", async () => {
  const session = authenticatedSession();
  const harness = createHarness(pairA, async (call) => {
    if (call === 1) return session;
    throw Object.assign(new Error("OAuth expired."), { status: 401 });
  });
  await harness.store.ensureSession();

  assert.equal(await harness.store.ensureSession(true), null);
  const snapshot = harness.store.getSnapshot();
  assert.equal(snapshot.phase, "setup");
  assert.equal(snapshot.session, null);
  assert.equal(snapshot.hasCredentials, false);
  harness.store.destroy();
});

test("a rejected current pair that clears settings finishes in setup", async () => {
  let harness;
  harness = createHarness(pairA, async () => {
    harness.setSettings(emptyPair);
    throw new Error("The saved SoundCloud session expired.");
  });

  assert.equal(await harness.store.ensureSession(), null);
  assert.equal(harness.calls(), 1);
  assert.equal(harness.store.getSnapshot().phase, "setup");
  assert.equal(harness.store.getSnapshot().hasCredentials, false);
  assert.equal(harness.store.getSnapshot().isChecking, false);
  harness.store.destroy();
});

test("a stale rejection cannot damage the authenticated replacement pair", async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  const newSession = authenticatedSession("replacement account");
  const harness = createHarness(pairA, (call) =>
    call === 1 ? oldRequest.promise : newRequest.promise
  );

  const first = harness.store.ensureSession();
  await Promise.resolve();
  harness.setSettings(pairB);
  const second = harness.store.ensureSession();
  newRequest.resolve(newSession);
  await second;

  oldRequest.reject(
    Object.assign(new Error("Old pair rejected."), { status: 401 }),
  );
  await first;
  const snapshot = harness.store.getSnapshot();
  assert.equal(snapshot.phase, "authenticated");
  assert.equal(snapshot.session, newSession);
  assert.equal(snapshot.error, null);
  harness.store.destroy();
});

test("disconnect invalidates the shared session synchronously", async () => {
  const harness = createHarness(pairA, async () => authenticatedSession());
  await harness.store.ensureSession();

  harness.setSettings(emptyPair);

  assert.equal(harness.store.getSnapshot().phase, "setup");
  assert.equal(harness.store.getSnapshot().session, null);
  assert.equal(harness.store.getSnapshot().hasCredentials, false);
  harness.store.destroy();
});

test("auth UI wiring never renders Connect while a saved pair is checked", async () => {
  const [appSource, hookSource, onboardingSource, extensionSource, bridgeSource] =
    await Promise.all([
      readFile(new URL("../src/app.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/hooks/useAuth.ts", import.meta.url), "utf8"),
      readFile(
        new URL("../src/components/OAuthOnboarding.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/extensions/extension.tsx", import.meta.url),
        "utf8",
      ),
      readFile(
        new URL("../src/services/authSession.ts", import.meta.url),
        "utf8",
      ),
    ]);

  assert.match(hookSource, /\buseSyncExternalStore\(/);
  assert.match(hookSource, /authSessionStore\.ensureSession\(\)/);
  assert.match(
    hookSource,
    /const mutation = \+\+authMutationEpoch\.current/,
  );
  assert.match(
    hookSource,
    /authenticateWebSession\(accessToken, webClientId\);[\s\S]*?if \(mutation !== authMutationEpoch\.current\) return false;[\s\S]*?applySettings\(updated\)/,
  );
  assert.match(
    hookSource,
    /const disconnect = useCallback\(\(\) => \{\s*authMutationEpoch\.current \+= 1/,
  );
  assert.match(extensionSource, /authSessionStore\.ensureSession\(\)/);
  assert.match(bridgeSource, /__waveLinkAuthSessionV1/);
  assert.match(
    appSource,
    /if \(hasSavedCredentials\)\s*\{\s*return \(\s*<SavedSessionGate/,
  );
  assert.doesNotMatch(onboardingSource, /isChecking/);
  assert.doesNotMatch(
    onboardingSource,
    /Checking your saved SoundCloud session/,
  );
});
