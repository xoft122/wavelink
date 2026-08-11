export const TRACKS_PER_LOAD_STORAGE_KEY = "wavelink:tracks-per-load";

export const TRACKS_PER_LOAD_CHANGED_EVENT =
  "wavelink:tracks-per-load-changed";

export const DEFAULT_TRACKS_PER_LOAD = 50;
export const MIN_TRACKS_PER_LOAD = 10;
export const MAX_TRACKS_PER_LOAD = 200;

export interface TracksPerLoadChangedDetail {
  tracksPerLoad: number;
}

/**
 * Normalize persisted or user-entered page sizes to the range supported by
 * WaveLink's SoundCloud requests. Malformed values safely restore the default.
 */
export function normalizeTracksPerLoad(value: unknown): number {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) return DEFAULT_TRACKS_PER_LOAD;
  return Math.max(
    MIN_TRACKS_PER_LOAD,
    Math.min(MAX_TRACKS_PER_LOAD, Math.trunc(numeric)),
  );
}

export function readTracksPerLoad(): number {
  try {
    if (typeof Spicetify !== "undefined" && Spicetify.LocalStorage) {
      return normalizeTracksPerLoad(
        Spicetify.LocalStorage.get(TRACKS_PER_LOAD_STORAGE_KEY),
      );
    }
  } catch {}
  return DEFAULT_TRACKS_PER_LOAD;
}

export function parseTracksPerLoadChangedDetail(
  value: unknown,
): TracksPerLoadChangedDetail | null {
  if (!value || typeof value !== "object") return null;
  const tracksPerLoad = (value as { tracksPerLoad?: unknown }).tracksPerLoad;
  if (
    !Number.isSafeInteger(tracksPerLoad) ||
    (tracksPerLoad as number) < MIN_TRACKS_PER_LOAD ||
    (tracksPerLoad as number) > MAX_TRACKS_PER_LOAD
  ) {
    return null;
  }
  return { tracksPerLoad: tracksPerLoad as number };
}

export function dispatchTracksPerLoadChanged(
  tracksPerLoad: number,
  target: EventTarget = window,
): boolean {
  const normalized = normalizeTracksPerLoad(tracksPerLoad);
  try {
    return target.dispatchEvent(
      new CustomEvent<TracksPerLoadChangedDetail>(
        TRACKS_PER_LOAD_CHANGED_EVENT,
        { detail: { tracksPerLoad: normalized } },
      ),
    );
  } catch {
    return false;
  }
}
