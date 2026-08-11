import React, { Fragment, useCallback, useEffect, useMemo, useRef } from "react";

import { useLikedTracks } from "../hooks/useLikedTracks";
import { usePlayer } from "../hooks/usePlayer";
import { PlaybackContext, player } from "../services/player";
import {
  PaginatedTrackSource,
  paginationPrefetchIndex,
} from "../services/paginatedTrackSource";
import { findTrackQueueIndex } from "../services/queueHydration";
import { isRenderableTrack, SCTrack, SCUser } from "../types/soundcloud";
import { TrackItem } from "./TrackItem";

interface Props {
  tracks: SCTrack[];
  queueTracks?: SCTrack[];
  resolveQueueTracks?: () => Promise<SCTrack[]>;
  paginationSource?: PaginatedTrackSource;
  emptyMessage?: string;
  onOpenUser?: (user: SCUser) => void;
  onTrackContextMenu?: (
    track: SCTrack,
    event: React.MouseEvent<HTMLDivElement>,
  ) => void;
  className?: string;
  context?: PlaybackContext;
}

export function TrackCollection({
  tracks,
  queueTracks,
  resolveQueueTracks,
  paginationSource,
  emptyMessage = "No tracks here yet.",
  onOpenUser,
  onTrackContextMenu,
  className = "",
  context,
}: Props) {
  const {
    track: activeTrack,
    isPlaying,
    queue,
    queueIndex,
  } = usePlayer();
  const { likedIds, toggleLike } = useLikedTracks();
  const safeTracks = useMemo(() => tracks.filter(isRenderableTrack), [tracks]);
  const safeQueueTracks = useMemo(
    () => (queueTracks ?? tracks).filter(isRenderableTrack),
    [queueTracks, tracks],
  );
  const paginationSnapshot = paginationSource?.getSnapshot() ?? null;
  const paginationTriggerIndex = paginationSnapshot?.nextHref
    ? paginationPrefetchIndex(
        safeTracks.length,
        paginationSnapshot.pageSize,
      )
    : -1;

  const handlePlay = useCallback(
    (track: SCTrack, index: number) => {
      const playbackIndex = findTrackQueueIndex(
        safeQueueTracks,
        track,
        safeTracks,
        index,
      );
      if (playbackIndex < 0) return;

      const currentQueueTrack = queue[queueIndex];
      const repeatedReference = queue.filter((item) => item === track).length > 1;
      const isCurrentOccurrence =
        activeTrack?.id === track.id &&
        currentQueueTrack === track &&
        (!repeatedReference || queueIndex === playbackIndex);
      if (isCurrentOccurrence) {
        player.toggle();
        return;
      }
      const queueRevision = paginationSource
        ? player.setQueueFromSource(
            paginationSource,
            playbackIndex,
            context,
          )
        : player.setQueue(safeQueueTracks, playbackIndex, context);
      void player.loadTrack(track);

      if (!paginationSource && resolveQueueTracks) {
        void resolveQueueTracks()
          .then((resolvedTracks) => {
            const safeResolvedTracks = resolvedTracks.filter(isRenderableTrack);
            player.replaceQueueIfRevision(
              queueRevision,
              safeResolvedTracks,
              context,
            );
          })
          .catch(() => {
            // The already-loaded queue remains playable. The owning view
            // reports pagination errors and can retry without interrupting it.
          });
      }
    },
    [
      activeTrack?.id,
      context,
      queue,
      queueIndex,
      paginationSource,
      resolveQueueTracks,
      safeQueueTracks,
      safeTracks,
    ],
  );

  if (safeTracks.length === 0) {
    return <p className="wl-empty">{emptyMessage}</p>;
  }

  return (
    <div className={`sc-track-list wl-track-list ${className}`.trim()}>
      {safeTracks.map((track, index) => (
        <Fragment key={`${track.urn || track.id}-${index}`}>
          {paginationSource && index === paginationTriggerIndex ? (
            <TrackPaginationSentinel source={paginationSource} />
          ) : null}
          <TrackItem
            track={track}
            isActive={activeTrack?.id === track.id}
            isPlaying={activeTrack?.id === track.id && isPlaying}
            isLiked={likedIds.has(track.urn || track.id)}
            onPlay={(item) => handlePlay(item, index)}
            onLike={(item) => void toggleLike(item)}
            onOpenUser={onOpenUser}
            onContextMenu={onTrackContextMenu}
          />
        </Fragment>
      ))}
    </div>
  );
}

function TrackPaginationSentinel({
  source,
}: {
  source: PaginatedTrackSource;
}) {
  const markerRef = useRef<HTMLDivElement | null>(null);
  const snapshot = source.getSnapshot();

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker || !snapshot.nextHref || snapshot.loading) return;

    const load = () => {
      void source.loadNext().catch(() => {
        // The source retains its cursor and exposes the error for a retry.
      });
    };
    if (typeof IntersectionObserver !== "function") {
      load();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) load();
      },
      { root: marker.closest(".wl-main"), threshold: 0 },
    );
    observer.observe(marker);
    return () => observer.disconnect();
  }, [snapshot.loading, snapshot.nextHref, source]);

  return (
    <div
      ref={markerRef}
      className="wl-track-pagination-sentinel"
      aria-hidden="true"
    />
  );
}
