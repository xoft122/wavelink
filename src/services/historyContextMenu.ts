const DEFAULT_CONTEXT_MENU_MARGIN = 8;

function finiteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export interface HistoryContextMenuPosition {
  left: number;
  top: number;
}

export function clampHistoryContextMenuPosition(
  clientX: unknown,
  clientY: unknown,
  viewportWidth: unknown,
  viewportHeight: unknown,
  menuWidth: unknown,
  menuHeight: unknown,
  margin = DEFAULT_CONTEXT_MENU_MARGIN,
): HistoryContextMenuPosition {
  const safeMargin = Math.max(0, finiteNumber(margin, DEFAULT_CONTEXT_MENU_MARGIN));
  const safeViewportWidth = Math.max(0, finiteNumber(viewportWidth, 0));
  const safeViewportHeight = Math.max(0, finiteNumber(viewportHeight, 0));
  const safeMenuWidth = Math.max(0, finiteNumber(menuWidth, 0));
  const safeMenuHeight = Math.max(0, finiteNumber(menuHeight, 0));
  const maxLeft = Math.max(
    safeMargin,
    safeViewportWidth - safeMenuWidth - safeMargin,
  );
  const maxTop = Math.max(
    safeMargin,
    safeViewportHeight - safeMenuHeight - safeMargin,
  );
  const pointerTop = finiteNumber(clientY, safeMargin);
  const preferredTop =
    pointerTop + safeMenuHeight + safeMargin <= safeViewportHeight
      ? pointerTop
      : pointerTop - safeMenuHeight >= safeMargin
        ? pointerTop - safeMenuHeight
        : pointerTop;

  return {
    left: Math.min(
      Math.max(finiteNumber(clientX, safeMargin), safeMargin),
      maxLeft,
    ),
    top: Math.min(
      Math.max(preferredTop, safeMargin),
      maxTop,
    ),
  };
}
