export type SpotifyHandoffDecision =
  | "keep-wavelink"
  | "validate-stable-uri"
  | "yield-now";

export interface StaleSpotifyContextMenuSurface {
  wavelinkActive: boolean;
  coverSurface: boolean;
  cinemaSurface: boolean;
  playerBarMetadataSurface: boolean;
  panelMetadataSurface: boolean;
}

/**
 * Spotify's visual tree remains backed by its last native item while WaveLink
 * owns playback. WaveLink-replaced covers, player metadata and cinema surfaces
 * need to suppress that stale item's contextual actions; every other Spotify
 * surface must retain its normal right-click behavior.
 */
export function shouldBlockStaleSpotifyContextMenu(
  surface: StaleSpotifyContextMenuSurface,
): boolean {
  return Boolean(
    surface.wavelinkActive &&
    (
      surface.coverSurface ||
      surface.cinemaSurface ||
      surface.playerBarMetadataSurface ||
      surface.panelMetadataSurface
    )
  );
}

export interface StaleSpotifyMetadataInteraction {
  wavelinkActive: boolean;
  eventType: string;
  directOwnedMetadataPath: boolean;
  candidateInsideMetadataBoundary: boolean;
  safePanelMetadataBoundary: boolean;
  metadataBoundaryContainsOwnedTitle: boolean;
  metadataBoundaryContainsOwnedArtist: boolean;
  waveLinkOwnedPath: boolean;
}

/**
 * Spotify's context-menu wrapper can leave a sibling/overlay hitbox around
 * right-panel metadata even after every nested artist anchor is disabled.
 * Capture only the three activation events, and only when the event belongs
 * to the exact structural metadata area that currently contains WaveLink's
 * role-qualified title/artist host.
 */
export function shouldBlockStaleSpotifyMetadataInteraction(
  interaction: StaleSpotifyMetadataInteraction,
): boolean {
  if (
    !interaction.wavelinkActive ||
    interaction.waveLinkOwnedPath ||
    !["click", "auxclick", "contextmenu"].includes(interaction.eventType)
  ) {
    return false;
  }
  if (interaction.directOwnedMetadataPath) return true;
  return Boolean(
    interaction.candidateInsideMetadataBoundary &&
      interaction.safePanelMetadataBoundary &&
      interaction.metadataBoundaryContainsOwnedTitle &&
      interaction.metadataBoundaryContainsOwnedArtist,
  );
}

export interface SpotifyPlayIntentCandidate {
  ariaLabel?: string | null;
  title?: string | null;
  testId?: string | null;
  className?: string | null;
  clickCount?: number;
  insideTrackRow?: boolean;
  interactiveTarget?: boolean;
  excluded?: boolean;
  transportControl?: boolean;
}

function normalizePlayIntentText(
  value: string | null | undefined,
): string {
  return (value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

/**
 * Identify an explicit native Spotify playback click before Spotify's own
 * handler runs. This is deliberately narrower than "any play-like element":
 * WaveLink controls and Spotify's central transport remain WaveLink-owned.
 */
export function isNativeSpotifyPlayIntent(
  candidate: SpotifyPlayIntentCandidate,
): boolean {
  if (candidate.excluded || candidate.transportControl) return false;

  const labels = [candidate.ariaLabel, candidate.title]
    .map(normalizePlayIntentText)
    .filter(Boolean);
  const testId = normalizePlayIntentText(candidate.testId);
  const classes = normalizePlayIntentText(candidate.className).split(" ");

  if (classes.includes("main-tracklist-rowimageplaybutton")) return true;
  if (
    /(?:^|[-_])(?:play|resume)(?:[-_](?:button|control))?(?:$|[-_])/.test(
      testId,
    )
  ) {
    return true;
  }
  if (labels.some((label) => /^(?:play|resume)(?:\s|$)/.test(label))) {
    return true;
  }

  return (
    (candidate.clickCount ?? 0) >= 2 &&
    !!candidate.insideTrackRow &&
    !candidate.interactiveTarget
  );
}

/**
 * A different native item that is already playing is an explicit Spotify
 * takeover. A different paused item is validated briefly because Spotify can
 * expose transient player-data changes while rebuilding its now-playing UI.
 */
export function classifySpotifyHandoff(
  baselineUri: string | null,
  currentUri: string | null,
  spotifyPlaying: boolean,
): SpotifyHandoffDecision {
  if (!currentUri || currentUri === baselineUri) {
    return "keep-wavelink";
  }
  // WaveLink may restore before Spotify has published its startup/Connect
  // item. The first later native URI is safe as a paused baseline, but an
  // already-playing item is an explicit Spotify takeover.
  if (!baselineUri) {
    return spotifyPlaying ? "yield-now" : "keep-wavelink";
  }
  return spotifyPlaying ? "yield-now" : "validate-stable-uri";
}

/**
 * Complete a debounced handoff only for the same WaveLink load and a stable
 * native item when a Spotify play intent was observed before our pause loop.
 */
export function shouldCompleteStableSpotifyHandoff(
  expectedLoadId: number,
  currentLoadId: number,
  observedUri: string,
  currentUri: string | null,
  resumeRequested: boolean,
): boolean {
  return (
    expectedLoadId === currentLoadId &&
    observedUri === currentUri &&
    resumeRequested
  );
}

/**
 * A same-item handoff has no songchange to force Spotify's compact cover to
 * remount. Recovery is therefore allowed only while WaveLink is fully released,
 * the exact captured native URI is still current, and Spotify has left no real
 * cover image of its own.
 */
export function shouldRecoverSpotifyCover(
  expectedUri: string | null,
  currentUri: string | null,
  wavelinkActive: boolean,
  hasNativeCover: boolean,
): boolean {
  return Boolean(
    expectedUri &&
      currentUri === expectedUri &&
      !wavelinkActive &&
      !hasNativeCover,
  );
}

const SPOTIFY_IMAGE_HOSTS = new Set([
  "i.scdn.co",
  "image-cdn-ak.spotifycdn.com",
  "mosaic.scdn.co",
]);

/** Convert Spotify metadata artwork into a URL safe to mount in an image. */
export function normalizeSpotifyArtworkUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const source = value.trim();
  if (!source) return null;

  const spotifyImage = /^spotify:image:([a-f\d]{16,128})$/i.exec(source);
  if (spotifyImage) {
    return `https://i.scdn.co/image/${spotifyImage[1]}`;
  }

  try {
    const url = new URL(source);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !SPOTIFY_IMAGE_HOSTS.has(url.hostname.toLocaleLowerCase())
    ) {
      return null;
    }
    return url.href;
  } catch {
    return null;
  }
}

export interface ImageAttributeState {
  src: string | null;
  srcset: string | null;
  sizes: string | null;
  alt: string | null;
}

export interface ImageOverlaySnapshot {
  native: ImageAttributeState;
  applied: ImageAttributeState;
}

export interface ImageOverlayRelease {
  kind: "reconcile";
  state: ImageAttributeState;
}

const IMAGE_ATTRIBUTES: ReadonlyArray<keyof ImageAttributeState> = [
  "src",
  "srcset",
  "sizes",
  "alt",
];

function reconcileNativeAttributes(
  snapshot: ImageOverlaySnapshot,
  current: ImageAttributeState,
): ImageAttributeState {
  const reconciled = { ...snapshot.native };
  for (const attribute of IMAGE_ATTRIBUTES) {
    // If the DOM still contains our value, restore the corresponding native
    // value. Otherwise Spotify/React has taken ownership of this one attribute
    // and its current value must be preserved.
    reconciled[attribute] =
      current[attribute] === snapshot.applied[attribute]
        ? snapshot.native[attribute]
        : current[attribute];
  }
  return reconciled;
}

/**
 * Preserve the latest state written by Spotify, but never mistake a previous
 * WaveLink cover for native artwork when WaveLink changes SC tracks.
 */
export function updateImageOverlaySnapshot(
  snapshot: ImageOverlaySnapshot | undefined,
  current: ImageAttributeState,
  nextApplied: ImageAttributeState,
): ImageOverlaySnapshot {
  return {
    native: snapshot
      ? reconcileNativeAttributes(snapshot, current)
      : { ...current },
    applied: { ...nextApplied },
  };
}

/**
 * Resolve ownership independently for every image attribute. React may update
 * src, srcset, sizes and alt in separate commits, so an all-or-nothing restore
 * can leave a hybrid image with WaveLink artwork.
 */
export function releaseImageOverlay(
  snapshot: ImageOverlaySnapshot,
  current: ImageAttributeState,
): ImageOverlayRelease {
  return {
    kind: "reconcile",
    state: reconcileNativeAttributes(snapshot, current),
  };
}
