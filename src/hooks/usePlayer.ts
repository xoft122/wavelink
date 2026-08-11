import { useEffect, useState } from "react";
import { SCTrack } from "../types/soundcloud";
import type { PaginatedTrackSource } from "../services/paginatedTrackSource";
import { PlaybackContext, player, RepeatMode } from "../services/player";

export function usePlayer() {
  const [state, setState] = useState(() => player.getState());

  useEffect(() => {
    const unsub = player.subscribe(setState);
    return unsub;
  }, []);

  return {
    ...state,
    play: () => void player.play(),
    pause: () => player.pause(),
    toggle: () => player.toggle(),
    seek: (r: number) => player.seek(r),
    setVolume: (v: number) => player.setVolume(v),
    setSyncedVolume: (v: number) => player.setSyncedVolume(v),
    setScVolumeLevel: (m: number) => player.setScVolumeLevel(m),
    setScVolumeEnabled: (enabled: boolean) =>
      player.setScVolumeEnabled(enabled),
    mute: (v: boolean) => player.mute(v),
    next: () => void player.next(),
    prev: () => void player.prev(),
    loadTrack: (track: SCTrack, autoPlay?: boolean) =>
      void player.loadTrack(track, autoPlay),
    setQueue: (tracks: SCTrack[], idx?: number) => player.setQueue(tracks, idx),
    setQueueFromSource: (
      source: PaginatedTrackSource,
      idx?: number,
      context?: PlaybackContext,
    ) => player.setQueueFromSource(source, idx, context),
    playQueueIndex: (index: number, autoPlay?: boolean) =>
      void player.playQueueIndex(index, autoPlay),
    addToQueue: (tracks: SCTrack | readonly SCTrack[]) =>
      player.addToQueue(tracks),
    playNext: (tracks: SCTrack | readonly SCTrack[]) =>
      player.playNext(tracks),
    removeFromQueue: (index: number) => void player.removeFromQueue(index),
    remove: (index: number) => void player.remove(index),
    reorderQueue: (fromIndex: number, toIndex: number) =>
      player.reorderQueue(fromIndex, toIndex),
    reorder: (fromIndex: number, toIndex: number) =>
      player.reorder(fromIndex, toIndex),
    clearQueue: (keepCurrent?: boolean) => player.clearQueue(keepCurrent),
    setShuffle: (enabled: boolean) => player.setShuffle(enabled),
    setRepeat: (mode: RepeatMode) => player.setRepeat(mode),
    setAutoplayRelated: (enabled: boolean) =>
      player.setAutoplayRelated(enabled),
    setTracksPerLoad: (value: number) => player.setTracksPerLoad(value),
    setSpotifySearchIntegrationEnabled: (enabled: boolean) =>
      player.setSpotifySearchIntegrationEnabled(enabled),
    setSourceBadgeEnabled: (enabled: boolean) =>
      player.setSourceBadgeEnabled(enabled),
    setSourceBadgeSide: (side: "left" | "right") =>
      player.setSourceBadgeSide(side),
    setSourceBadgeDodgeOnHover: (enabled: boolean) =>
      player.setSourceBadgeDodgeOnHover(enabled),
    setSourceBadgeLinkEnabled: (enabled: boolean) =>
      player.setSourceBadgeLinkEnabled(enabled),
    setSourceBadgeDisplayMode: (mode: "icon-text" | "icon-only") =>
      player.setSourceBadgeDisplayMode(mode),
    setSourceBadgeHideWithFullscreenPlayer: (enabled: boolean) =>
      player.setSourceBadgeHideWithFullscreenPlayer(enabled),
  };
}
