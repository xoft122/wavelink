import type { SCSession, SCSettings } from "../types/soundcloud";

export type AuthSessionPhase =
  | "setup"
  | "checking"
  | "authenticated"
  | "error";

export interface AuthSessionSnapshot {
  phase: AuthSessionPhase;
  session: SCSession | null;
  error: string | null;
  hasCredentials: boolean;
  isChecking: boolean;
}

export interface AuthSessionStore {
  readonly version: 1;
  getSnapshot(): AuthSessionSnapshot;
  subscribe(listener: () => void): () => void;
  ensureSession(force?: boolean): Promise<SCSession | null>;
  commitAuthenticated(
    session: SCSession,
    expectedSettings: SCSettings,
  ): boolean;
  syncSettings(): void;
  destroy(): void;
}

export interface AuthSessionStoreDependencies {
  loadSettings(): SCSettings;
  hasCredentials(settings: SCSettings): boolean;
  getSession(): Promise<SCSession>;
  isUnauthorizedError(cause: unknown): boolean;
  subscribeSettings(listener: () => void): () => void;
}

function sameCredentials(left: SCSettings, right: SCSettings): boolean {
  return (
    left.accessToken === right.accessToken &&
    left.webClientId === right.webClientId
  );
}

function isAuthenticatedSession(
  value: SCSession | null | undefined,
): value is SCSession {
  return Boolean(
    value?.authenticated &&
      value.user &&
      typeof value.user.username === "string" &&
      (value.user.urn || value.user.id),
  );
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error && cause.message.trim()) {
    return cause.message.trim().slice(0, 1_000);
  }
  return "Could not connect to SoundCloud.";
}

/**
 * One credential-scoped session store shared by WaveLink's startup extension
 * and custom-app bundle. The verified public session lives only in memory;
 * OAuth credentials remain in the existing private settings storage.
 */
export function createAuthSessionStore(
  dependencies: AuthSessionStoreDependencies,
): AuthSessionStore {
  let settings = dependencies.loadSettings();
  let generation = 0;
  let destroyed = false;
  let invalidSettings: SCSettings | null = null;
  let inFlight: {
    generation: number;
    promise: Promise<SCSession | null>;
  } | null = null;
  const listeners = new Set<() => void>();

  let snapshot: AuthSessionSnapshot = dependencies.hasCredentials(settings)
    ? {
        phase: "checking",
        session: null,
        error: null,
        hasCredentials: true,
        isChecking: true,
      }
    : {
        phase: "setup",
        session: null,
        error: null,
        hasCredentials: false,
        isChecking: false,
      };

  const publish = (next: AuthSessionSnapshot) => {
    if (destroyed) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const adoptSettings = (next: SCSettings): boolean => {
    if (sameCredentials(settings, next)) return false;
    settings = next;
    invalidSettings = null;
    generation += 1;
    inFlight = null;
    const configured = dependencies.hasCredentials(next);
    publish(
      configured
        ? {
            phase: "checking",
            session: null,
            error: null,
            hasCredentials: true,
            isChecking: true,
          }
        : {
            phase: "setup",
            session: null,
            error: null,
            hasCredentials: false,
            isChecking: false,
          },
    );
    return true;
  };

  const ensureSession = async (
    force = false,
  ): Promise<SCSession | null> => {
    if (destroyed) return null;
    adoptSettings(dependencies.loadSettings());
    if (invalidSettings && sameCredentials(settings, invalidSettings)) {
      return null;
    }
    if (!dependencies.hasCredentials(settings)) {
      if (snapshot.phase !== "setup") {
        publish({
          phase: "setup",
          session: null,
          error: null,
          hasCredentials: false,
          isChecking: false,
        });
      }
      return null;
    }
    if (isAuthenticatedSession(snapshot.session) && !force) {
      return snapshot.session;
    }
    if (inFlight) return inFlight.promise;

    const retainedSession = isAuthenticatedSession(snapshot.session)
      ? snapshot.session
      : null;
    publish(
      retainedSession
        ? {
            phase: "authenticated",
            session: retainedSession,
            error: null,
            hasCredentials: true,
            isChecking: true,
          }
        : {
            phase: "checking",
            session: null,
            error: null,
            hasCredentials: true,
            isChecking: true,
          },
    );

    const runGeneration = generation;
    let task: Promise<SCSession | null>;
    task = Promise.resolve()
      .then(() => {
        // A verified connect can commit its session in the same tick after the
        // settings event queued this check. Re-check before touching the
        // network so that the superseded task cannot issue a redundant /me
        // request (or let its late 401 clear the freshly saved pair).
        if (
          destroyed ||
          runGeneration !== generation ||
          !sameCredentials(settings, dependencies.loadSettings())
        ) {
          return null;
        }
        return dependencies.getSession();
      })
      .then((value) => {
        if (value === null) return null;
        if (
          destroyed ||
          runGeneration !== generation ||
          !sameCredentials(settings, dependencies.loadSettings())
        ) {
          return null;
        }
        if (!isAuthenticatedSession(value)) {
          throw new Error("SoundCloud returned an invalid account session.");
        }
        publish({
          phase: "authenticated",
          session: value,
          error: null,
          hasCredentials: true,
          isChecking: false,
        });
        return value;
      })
      .catch((cause: unknown) => {
        if (destroyed || runGeneration !== generation) return null;
        const current = dependencies.loadSettings();
        if (!sameCredentials(settings, current)) {
          const changed = adoptSettings(current);
          if (changed && dependencies.hasCredentials(current)) {
            void ensureSession();
          }
          return null;
        }
        const message = errorMessage(cause);
        if (dependencies.isUnauthorizedError(cause)) {
          invalidSettings = { ...settings };
          generation += 1;
          inFlight = null;
          publish({
            phase: "setup",
            session: null,
            error: message,
            hasCredentials: false,
            isChecking: false,
          });
          return null;
        }
        if (retainedSession) {
          publish({
            phase: "authenticated",
            session: retainedSession,
            error: message,
            hasCredentials: true,
            isChecking: false,
          });
        } else {
          publish({
            phase: "error",
            session: null,
            error: message,
            hasCredentials: true,
            isChecking: false,
          });
        }
        return null;
      })
      .finally(() => {
        if (inFlight?.promise === task) inFlight = null;
      });
    inFlight = { generation: runGeneration, promise: task };
    return task;
  };

  const syncSettings = () => {
    if (destroyed) return;
    const current = dependencies.loadSettings();
    const changed = adoptSettings(current);
    if (changed) {
      if (dependencies.hasCredentials(current)) void ensureSession();
      return;
    }
    // Re-saving the same pair must never discard an authenticated session.
    // It can, however, explicitly retry an earlier transient bootstrap error.
    if (snapshot.phase === "error" && !inFlight) void ensureSession(true);
  };

  const unsubscribeSettings = dependencies.subscribeSettings(syncSettings);

  return {
    version: 1,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (destroyed) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    ensureSession,
    commitAuthenticated(value, expectedSettings) {
      if (destroyed || !isAuthenticatedSession(value)) return false;
      const current = dependencies.loadSettings();
      if (
        !dependencies.hasCredentials(current) ||
        !sameCredentials(current, expectedSettings)
      ) {
        return false;
      }
      settings = current;
      invalidSettings = null;
      generation += 1;
      inFlight = null;
      publish({
        phase: "authenticated",
        session: value,
        error: null,
        hasCredentials: true,
        isChecking: false,
      });
      return true;
    },
    syncSettings,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      generation += 1;
      inFlight = null;
      listeners.clear();
      unsubscribeSettings();
    },
  };
}
