import type { SCTrack } from "../types/soundcloud";

function trackIdentity(track: SCTrack | null | undefined): string {
  return track?.urn || track?.id || track?.permalink_url || "";
}

function occurrenceBeforeOrAt(
  tracks: readonly SCTrack[],
  index: number,
  matches: (track: SCTrack) => boolean,
): number {
  let occurrence = -1;
  for (let candidateIndex = 0; candidateIndex <= index; candidateIndex += 1) {
    if (matches(tracks[candidateIndex])) occurrence += 1;
  }
  return occurrence;
}

function matchingIndexes(
  tracks: readonly SCTrack[],
  matches: (track: SCTrack) => boolean,
): number[] {
  const indexes: number[] = [];
  tracks.forEach((track, index) => {
    if (matches(track)) indexes.push(index);
  });
  return indexes;
}

/**
 * Map one rendered row back into a potentially larger playback queue. Exact
 * object references preserve repeated occurrences; canonical track identity is
 * the safe fallback when the displayed row was cloned during normalization.
 */
export function findTrackQueueIndex(
  queueTracks: readonly SCTrack[],
  selectedTrack: SCTrack,
  renderedTracks: readonly SCTrack[] = [selectedTrack],
  renderedIndex = 0,
): number {
  if (
    renderedIndex < 0 ||
    renderedIndex >= renderedTracks.length ||
    queueTracks.length === 0
  ) {
    return -1;
  }

  const exactOccurrence = occurrenceBeforeOrAt(
    renderedTracks,
    renderedIndex,
    (track) => track === selectedTrack,
  );
  const exactMatches = matchingIndexes(
    queueTracks,
    (track) => track === selectedTrack,
  );
  if (exactMatches.length > exactOccurrence && exactOccurrence >= 0) {
    return exactMatches[exactOccurrence];
  }

  const identity = trackIdentity(selectedTrack);
  if (!identity) return -1;
  const identityOccurrence = occurrenceBeforeOrAt(
    renderedTracks,
    renderedIndex,
    (track) => trackIdentity(track) === identity,
  );
  const identityMatches = matchingIndexes(
    queueTracks,
    (track) => trackIdentity(track) === identity,
  );
  return identityMatches[identityOccurrence] ?? identityMatches[0] ?? -1;
}

export function sameTrackQueue(
  left: readonly SCTrack[],
  right: readonly SCTrack[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (track, index) =>
        track === right[index] ||
        (trackIdentity(track) !== "" &&
          trackIdentity(track) === trackIdentity(right[index])),
    )
  );
}
