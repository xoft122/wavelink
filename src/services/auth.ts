import { SCSettings } from "../types/soundcloud";

export const SETTINGS_KEY = "wavelink:settings";

const EMPTY_SETTINGS: SCSettings = {
  accessToken: "",
  webClientId: "",
};

interface SettingsStorageBackend {
  get(key: string): unknown;
  set(key: string, value: string): void;
  remove(key: string): void;
}

function storageBackends(): SettingsStorageBackend[] {
  const backends: SettingsStorageBackend[] = [];

  try {
    if (
      typeof Spicetify !== "undefined" &&
      Spicetify.Platform.LocalStorageAPI
    ) {
      const storage = Spicetify.Platform.LocalStorageAPI;
      backends.push({
        get: (key) => storage.getItem(key),
        set: (key, value) => storage.setItem(key, value),
        remove: (key) => storage.clearItem(key),
      });
    }
  } catch {}

  try {
    if (typeof Spicetify !== "undefined" && Spicetify.LocalStorage) {
      backends.push({
        get: (key) => Spicetify.LocalStorage.get(key),
        set: (key, value) => Spicetify.LocalStorage.set(key, value),
        remove: (key) => Spicetify.LocalStorage.remove(key),
      });
    }
  } catch {}

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      backends.push({
        get: (key) => window.localStorage.getItem(key),
        set: (key, value) => window.localStorage.setItem(key, value),
        remove: (key) => window.localStorage.removeItem(key),
      });
    }
  } catch {}

  return backends;
}

function storageGet(key: string): string | null {
  for (const backend of storageBackends()) {
    try {
      const value = backend.get(key);
      if (typeof value === "string" && value) return value;
    } catch {}
  }
  return null;
}

function storageSet(key: string, value: string): void {
  const backends = storageBackends();
  let selected: SettingsStorageBackend | null = null;

  for (const backend of backends) {
    try {
      backend.set(key, value);
      selected = backend;
      break;
    } catch {}
  }

  // Credentials used to live in generic Spicetify/localStorage. Keep exactly
  // one copy, preferring the Spotify-account-scoped Platform backend above.
  for (const backend of backends) {
    if (backend === selected) continue;
    try {
      backend.remove(key);
    } catch {}
  }

  // Some Spicetify builds wrap window.localStorage for the legacy backend.
  // Re-applying the selected value keeps fallback storage intact if an aliasing
  // backend removal above touched the same underlying key.
  if (selected) {
    try {
      selected.set(key, value);
    } catch {}
  }
}

function storageRemove(key: string): void {
  for (const backend of storageBackends()) {
    try {
      backend.remove(key);
    } catch {}
  }
}

export function normalizeAccessToken(value: string): string {
  const input = value.trim().replace(/^OAuth[\t ]+/i, "");
  if (
    input.length < 8 ||
    input.length > 4096 ||
    !/^[\x21-\x7e]+$/.test(input)
  ) {
    throw new Error("Enter a valid SoundCloud OAuth access token.");
  }
  return input;
}

export function normalizeWebClientId(value: string): string {
  const input = value.trim();
  if (!/^[A-Za-z0-9]{32}$/.test(input)) {
    throw new Error("Web Client ID must contain exactly 32 letters or digits.");
  }
  return input;
}

export function loadSettings(): SCSettings {
  try {
    const raw = storageGet(SETTINGS_KEY);
    if (!raw) return { ...EMPTY_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<SCSettings>;
    return {
      accessToken:
        typeof parsed.accessToken === "string" ? parsed.accessToken.trim() : "",
      webClientId:
        typeof parsed.webClientId === "string" ? parsed.webClientId.trim() : "",
    };
  } catch {
    return { ...EMPTY_SETTINGS };
  }
}

export function saveSettings(settings: SCSettings): void {
  const clean: SCSettings = {
    accessToken: normalizeAccessToken(settings.accessToken),
    webClientId: normalizeWebClientId(settings.webClientId),
  };
  storageSet(SETTINGS_KEY, JSON.stringify(clean));
  try {
    window.dispatchEvent(
      new CustomEvent("wavelink:settings", { detail: clean }),
    );
  } catch {}
}

export function clearSettings(): void {
  storageRemove(SETTINGS_KEY);
  try {
    window.dispatchEvent(
      new CustomEvent("wavelink:settings", {
        detail: { ...EMPTY_SETTINGS },
      }),
    );
  } catch {}
}

export function hasCredentials(settings = loadSettings()): boolean {
  return Boolean(settings.accessToken && settings.webClientId);
}
