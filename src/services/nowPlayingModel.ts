export type QueueRepeatMode = "off" | "all" | "one";

/** Select the exact queue entry represented by WaveLink's Next in queue card. */
export function nextQueueIndex(
  queueLength: number,
  currentIndex: number,
  repeat: QueueRepeatMode,
): number | null {
  if (!Number.isInteger(queueLength) || queueLength <= 0) return null;
  if (!Number.isInteger(currentIndex) || currentIndex < 0) return 0;
  if (currentIndex + 1 < queueLength) return currentIndex + 1;
  if (repeat === "all") return 0;
  return null;
}
