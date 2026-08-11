export const WAVELINK_TRACK_FALLBACK_ARTWORK =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 44 44'%3E%3Crect width='44' height='44' fill='%23333'/%3E%3Ccircle cx='22' cy='22' r='8' fill='%23ff5500' opacity='.6'/%3E%3Ccircle cx='22' cy='22' r='3' fill='%23ff5500'/%3E%3C/svg%3E";

export type SoundCloudArtworkSize =
  | "t50x50"
  | "t67x67"
  | "t200x200"
  | "t500x500";

/**
 * Keep every WaveLink track surface on the same artwork contract. SoundCloud
 * normally returns the `large` rendition; an absent URL must still resolve to
 * a real image so Spotify cannot replace the cover slot with its note icon.
 */
export function soundCloudTrackArtworkUrl(
  value: string | null | undefined,
  size: SoundCloudArtworkSize,
): string {
  const source = value?.trim();
  return source
    ? source.replace("-large", `-${size}`)
    : WAVELINK_TRACK_FALLBACK_ARTWORK;
}
