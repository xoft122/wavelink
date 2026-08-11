export const RECENT_HISTORY_PREVIEW_LIMIT = 8;

export function canExpandRecentHistory(items: readonly unknown[]): boolean {
  return items.length > RECENT_HISTORY_PREVIEW_LIMIT;
}

export function visibleRecentHistory<T>(
  items: readonly T[],
  expanded: boolean,
): T[] {
  return expanded
    ? [...items]
    : items.slice(0, RECENT_HISTORY_PREVIEW_LIMIT);
}
