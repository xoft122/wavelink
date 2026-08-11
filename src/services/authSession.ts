import { getSession, updateApiSettings } from "./api";
import { hasCredentials, loadSettings } from "./auth";
import { DirectSoundCloudError } from "./directSoundcloud";
import {
  AuthSessionStore,
  createAuthSessionStore,
} from "./authSessionStore";

type WaveLinkAuthWindow = Window & {
  __waveLinkAuthSessionV1?: AuthSessionStore;
};

/**
 * The startup extension and custom app are separate bundles, so a module-level
 * singleton is insufficient. Keeping the store on the shared Spotify window
 * lets the invisible startup check hydrate the page before it is opened.
 */
export function getAuthSessionStore(): AuthSessionStore {
  const scope = window as WaveLinkAuthWindow;
  const existing = scope.__waveLinkAuthSessionV1;
  if (
    existing?.version === 1 &&
    typeof existing.getSnapshot === "function" &&
    typeof existing.subscribe === "function" &&
    typeof existing.ensureSession === "function"
  ) {
    return existing;
  }

  const store = createAuthSessionStore({
    loadSettings,
    hasCredentials,
    getSession,
    isUnauthorizedError: (cause) =>
      cause instanceof DirectSoundCloudError && cause.status === 401,
    subscribeSettings(listener) {
      const sync = () => {
        // Each Spicetify bundle owns its own API module cache. Clear the cache
        // in whichever bundle created the shared store before it revalidates.
        updateApiSettings(loadSettings());
        listener();
      };
      window.addEventListener("wavelink:settings", sync);
      return () => window.removeEventListener("wavelink:settings", sync);
    },
  });
  scope.__waveLinkAuthSessionV1 = store;
  return store;
}
