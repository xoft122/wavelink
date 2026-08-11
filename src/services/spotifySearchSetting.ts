export const SPOTIFY_SEARCH_INTEGRATION_STORAGE_KEY =
  "wavelink:spotify-search-integration-enabled";

export const SPOTIFY_SEARCH_INTEGRATION_CHANGED_EVENT =
  "wavelink:spotify-search-integration-changed";

export interface SpotifySearchIntegrationChangedDetail {
  enabled: boolean;
}

export function normalizeSpotifySearchIntegrationEnabled(
  value: unknown,
): boolean {
  if (value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  return true;
}

export function readSpotifySearchIntegrationEnabled(): boolean {
  try {
    if (
      typeof Spicetify !== "undefined" &&
      Spicetify.LocalStorage
    ) {
      return normalizeSpotifySearchIntegrationEnabled(
        Spicetify.LocalStorage.get(
          SPOTIFY_SEARCH_INTEGRATION_STORAGE_KEY,
        ),
      );
    }
  } catch {}
  return true;
}

export function shouldRunSpotifySearchIntegration(
  preferenceEnabled: boolean,
  capabilityAvailable: boolean,
): boolean {
  return preferenceEnabled && capabilityAvailable;
}

export function parseSpotifySearchIntegrationChangedDetail(
  value: unknown,
): SpotifySearchIntegrationChangedDetail | null {
  if (!value || typeof value !== "object") return null;
  const enabled = (value as { enabled?: unknown }).enabled;
  return typeof enabled === "boolean" ? { enabled } : null;
}

export function dispatchSpotifySearchIntegrationChanged(
  enabled: boolean,
  target: EventTarget = window,
): boolean {
  try {
    return target.dispatchEvent(
      new CustomEvent<SpotifySearchIntegrationChangedDetail>(
        SPOTIFY_SEARCH_INTEGRATION_CHANGED_EVENT,
        { detail: { enabled } },
      ),
    );
  } catch {
    return false;
  }
}
