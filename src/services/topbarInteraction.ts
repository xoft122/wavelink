export const WAVELINK_HEADER_INTERACTIVE_CLASS = "wl-header-interactive";

type HeaderInteractionHost = Pick<HTMLElement, "classList">;

const owners = new WeakMap<object, number>();

/**
 * Marks the Spotify document only while an authenticated WaveLink shell owns
 * the custom header. Reference counting keeps overlapping React owners from
 * restoring Spotify's native overlay too early.
 */
export function acquireWaveLinkHeaderInteraction(
  host: HeaderInteractionHost,
): () => void {
  const key = host as object;
  const current = owners.get(key) ?? 0;
  if (current === 0) host.classList.add(WAVELINK_HEADER_INTERACTIVE_CLASS);
  owners.set(key, current + 1);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = Math.max(0, (owners.get(key) ?? 1) - 1);
    if (remaining > 0) {
      owners.set(key, remaining);
      return;
    }
    owners.delete(key);
    host.classList.remove(WAVELINK_HEADER_INTERACTIVE_CLASS);
  };
}
