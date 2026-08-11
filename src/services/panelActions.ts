export type NativePanelActionKind =
  | "copy-song"
  | "hide-album"
  | "spotify-like"
  | "spotify-share"
  | "spotify-more";

export interface NativePanelActionCandidate {
  ariaLabel?: string | null;
  title?: string | null;
  textContent?: string | null;
  testId?: string | null;
  className?: string | null;
}

export const WAVELINK_HEART_ICON = {
  viewBox: "0 0 24 24",
  width: 18,
  height: 18,
  path: "M12 21.3C10.8 20.2 3.5 14 3.5 8.5A4.5 4.5 0 0 1 12 6.4a4.5 4.5 0 0 1 8.5 2.1c0 5.5-7.3 11.7-8.5 12.8Z",
  strokeWidth: 1.7,
} as const;

function normalizeActionText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

export function classifyNativePanelAction(
  candidate: NativePanelActionCandidate,
): NativePanelActionKind | null {
  const labels = [
    candidate.ariaLabel,
    candidate.title,
    candidate.textContent,
  ]
    .map(normalizeActionText)
    .filter(Boolean);
  const testId = normalizeActionText(candidate.testId);
  const className = normalizeActionText(candidate.className);
  const hasLabel = (pattern: RegExp) =>
    labels.some((label) => pattern.test(label));

  if (
    hasLabel(
      /^(?:copy link to (?:song|track)|copy (?:song|track) link)$/,
    ) ||
    /(?:^|[-_])copy[-_](?:song|track)?[-_]?link(?:$|[-_])/.test(testId)
  ) {
    return "copy-song";
  }

  if (
    hasLabel(
      /^(?:hide (?:in|from) this (?:album|playlist)|hide this (?:song|track))$/,
    ) ||
    /(?:^|[-_])hide[-_](?:album|track|song)(?:$|[-_])/.test(testId)
  ) {
    return "hide-album";
  }

  if (
    hasLabel(/^more options(?: for .+)?$/) ||
    /^(?:more-button|context-menu-button|now-playing-view-more-button)$/.test(
      testId,
    )
  ) {
    return "spotify-more";
  }

  if (
    hasLabel(
      /^(?:share|share (?:this )?(?:song|track))$/,
    ) ||
    /^(?:share-button|now-playing-view-share-button)$/.test(testId) ||
    /(?:^|\s)main-watchfeed-sharebuttonhidden(?:$|\s)/.test(className)
  ) {
    return "spotify-share";
  }

  if (
    hasLabel(
      /^(?:(?:add|added|save|saved) to (?:(?:your|a) )?(?:liked songs|library|playlist)|(?:remove|removed) from (?:(?:your|a) )?(?:liked songs|library|playlist)|in (?:your )?(?:liked songs|library))$/,
    ) ||
    /^(?:add|remove|like|save|saved)-button$/.test(testId) ||
    /(?:^|[-_])(?:add|remove|like|liked|save|saved)(?:[-_](?:to|from))?[-_](?:(?:your|a)[-_])?(?:library|liked[-_]songs|playlist|song|track)(?:[-_]button)?(?:$|[-_])/.test(
      testId,
    )
  ) {
    return "spotify-like";
  }

  return null;
}

export interface PanelLikePresentation {
  ariaLabel: string;
  title: string;
  ariaPressed: "true" | "false";
  ariaHasPopup: "dialog" | null;
  ariaBusy: "true" | null;
  disabled: boolean;
  filled: boolean;
}

export function createPanelLikePresentation(
  liked: boolean,
  busy = false,
): PanelLikePresentation {
  const action = liked ? "Unlike" : "Like";
  return {
    ariaLabel: `${action} on SoundCloud`,
    title: busy ? "Updating SoundCloud like…" : `${action} on SoundCloud`,
    ariaPressed: liked ? "true" : "false",
    ariaHasPopup: liked ? null : "dialog",
    ariaBusy: busy ? "true" : null,
    disabled: busy,
    filled: liked,
  };
}

export interface PanelLikeActionHandlers {
  showPrompt: () => void;
  unlike: () => Promise<void>;
}

export type PanelLikeActionResult = "prompted" | "unliked";

export async function performPanelLikeAction(
  liked: boolean,
  handlers: PanelLikeActionHandlers,
): Promise<PanelLikeActionResult> {
  if (!liked) {
    handlers.showPrompt();
    return "prompted";
  }
  await handlers.unlike();
  return "unliked";
}
