// WaveLink startup extension.
//
// Spicetify loads a custom app's JS only when its page is opened. This
// separate extension starts playback hooks and optional Spotify Search
// integration as soon as Spotify is ready.
//
// The app and extension are separate esbuild bundles. Shared runtime services
// protect themselves with window-level singletons.

import { player } from "../services/player";
import {
  initSearchIntegration,
  destroySearchIntegration,
} from "../services/searchIntegration";
import {
  initSearchPageIntegration,
  destroySearchPageIntegration,
} from "../services/searchPageIntegration";
import { getDebugLog, clearDebugLog } from "../services/api";
import { log } from "../services/debug";
import { hasCredentials, loadSettings } from "../services/auth";
import { getAuthSessionStore } from "../services/authSession";
import {
  SPOTIFY_SEARCH_INTEGRATION_CHANGED_EVENT,
  parseSpotifySearchIntegrationChangedDetail,
  readSpotifySearchIntegrationEnabled,
  shouldRunSpotifySearchIntegration,
} from "../services/spotifySearchSetting";

function hasAccountCredentials(): boolean {
  try {
    return hasCredentials(loadSettings());
  } catch {
    return false;
  }
}

function boot(): void {
  if (
    typeof Spicetify === "undefined" ||
    !Spicetify.Player ||
    !Spicetify.LocalStorage ||
    !Spicetify.Platform
  ) {
    setTimeout(boot, 200);
    return;
  }

  log("ext", "Spicetify ready — booting WaveLink extension");

  // Touch the singleton so its constructor hooks Spotify's transport now.
  void player;
  const authSessionStore = getAuthSessionStore();

  // Playback resume is independent from the optional Spotify Search setting.
  // As soon as SoundCloud verifies the saved account, bind the account-scoped
  // snapshot and restore it paused. The shared player makes this idempotent
  // even when the custom-app bundle is opened during the same check.
  const syncPlaybackResume = () => {
    const session = authSessionStore.getSnapshot().session;
    if (!session?.authenticated || !session.user) return;
    void player.initializePlaybackResume(session.user);
  };
  authSessionStore.subscribe(syncPlaybackResume);
  void authSessionStore.ensureSession().then(syncPlaybackResume);

  // Expose a small redacted debug namespace for DevTools.
  (window as unknown as Record<string, unknown>).__wl = {
    player,
    apiLog: getDebugLog,
    clearApiLog: clearDebugLog,
    help: () => {
      console.log(
        "%c[WL] window.__wl debug API\n%c" +
          "  __wl.player             — WaveLink player instance\n" +
          "  __wl.player.getState()  — current player state\n" +
          "  __wl.apiLog()           — redacted SoundCloud request log\n" +
          "  __wl.clearApiLog()      — clear the request log\n" +
          "\nFilter console by '[WL' to see WaveLink logs.",
        "color:#ff5500;font-weight:bold",
        "color:inherit",
      );
    },
  };
  log("ext", "window.__wl exposed — type __wl.help() for API docs");

  // Search injection requires both the user preference and a verified
  // SoundCloud search capability. A generation guard prevents an older
  // account check from re-enabling integration after a live opt-out.
  let searchIntegrationsMounted: boolean | null = null;
  let capabilityRetry: number | null = null;
  let syncGeneration = 0;

  const clearCapabilityRetry = () => {
    if (capabilityRetry !== null) {
      window.clearTimeout(capabilityRetry);
      capabilityRetry = null;
    }
  };

  const applySearchIntegrations = (enabled: boolean) => {
    if (enabled !== searchIntegrationsMounted) {
      log(
        "ext",
        "Spotify search integration: %s",
        enabled ? "enabled" : "disabled",
      );
      searchIntegrationsMounted = enabled;
    }
    if (enabled) {
      initSearchIntegration();
      initSearchPageIntegration();
    } else {
      destroySearchIntegration();
      destroySearchPageIntegration();
    }
  };

  const sync = async () => {
    const generation = ++syncGeneration;
    clearCapabilityRetry();
    const preferenceEnabled = readSpotifySearchIntegrationEnabled();
    if (!preferenceEnabled) {
      applySearchIntegrations(false);
      return;
    }

    let capabilityAvailable = false;
    try {
      if (hasAccountCredentials()) {
        const checked = await authSessionStore.ensureSession();
        // A successful in-app connect may replace an older in-flight startup
        // check. Read the shared snapshot so search enables immediately.
        const session = checked ?? authSessionStore.getSnapshot().session;
        capabilityAvailable = Boolean(
          session &&
            (session.capabilities?.apiSearch ?? session.authenticated),
        );
      }
    } catch {
      capabilityAvailable = false;
    }

    if (
      generation !== syncGeneration ||
      !readSpotifySearchIntegrationEnabled()
    ) {
      return;
    }

    const shouldRun = shouldRunSpotifySearchIntegration(
      true,
      capabilityAvailable,
    );
    applySearchIntegrations(shouldRun);

    // Retry while SoundCloud is briefly unavailable. Disabled integration
    // never performs or schedules account capability checks.
    if (
      !shouldRun &&
      readSpotifySearchIntegrationEnabled() &&
      authSessionStore.getSnapshot().hasCredentials
    ) {
      capabilityRetry = window.setTimeout(() => void sync(), 5_000);
    }
  };

  void sync();
  window.addEventListener("wavelink:settings", () => {
    void sync();
  });
  window.addEventListener(
    SPOTIFY_SEARCH_INTEGRATION_CHANGED_EVENT,
    (event) => {
      const detail = parseSpotifySearchIntegrationChangedDetail(
        (event as CustomEvent<unknown>).detail,
      );
      if (detail?.enabled === false) {
        ++syncGeneration;
        clearCapabilityRetry();
        applySearchIntegrations(false);
        return;
      }
      void sync();
    },
  );
}

log("ext", "script loaded, waiting for Spicetify...");
boot();
