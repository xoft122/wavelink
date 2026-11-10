export type SoundCloudUrn = string;
export type SCTrackPolicy = "ALLOW" | "MONETIZE" | "SNIP" | "BLOCK";

export interface SCUser {
  id: SoundCloudUrn;
  urn: SoundCloudUrn;
  username: string;
  avatar_url: string;
  /** SoundCloud profile header visual exposed by the web API, when present. */
  profile_header_url?: string | null;
  permalink_url: string;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  followers_count?: number;
  followings_count?: number;
  track_count?: number;
  playlist_count?: number;
  verified?: boolean;
  followed_by_user?: boolean;
}

export interface SCTrack {
  /** WaveLink normalizes `id` to the canonical SoundCloud URN. */
  id: SoundCloudUrn;
  urn: SoundCloudUrn;
  title: string;
  duration: number;
  /** Original full-track duration when `duration` is only a SNIP preview. */
  full_duration?: number;
  user: SCUser;
  artwork_url: string | null;
  permalink_url: string;
  kind: "track";
  likes_count: number;
  playback_count: number;
  reposts_count?: number;
  comment_count?: number;
  description: string | null;
  genre?: string | null;
  access?: "playable" | "preview" | "blocked";
  /** SoundCloud web-catalog policy; `BLOCK` is an explicit restriction. */
  policy?: SCTrackPolicy;
  /** Explicit upstream stream capability. Omitted by thin track entities. */
  streamable?: boolean;
  /**
   * Safe tri-state projection of `media.transcodings`.
   * `undefined` means the upstream representation omitted that collection.
   */
  has_transcodings?: boolean;
  /** At least one upstream transcoding is explicitly a clipped preview. */
  has_snipped_transcoding?: boolean;
  /** At least one upstream transcoding is explicitly a full stream. */
  has_full_transcoding?: boolean;
  /** Safe, normalized full-playback capability derived from track metadata. */
  full_playable?: boolean;
  /** Safe, normalized preview capability derived from track metadata. */
  preview_playable?: boolean;
  /**
   * ISO alpha-2 playback territory decoded from `track_authorization`.
   * The authorization token and every other claim are discarded.
   */
  authorization_geo?: string;
  sharing?: "public" | "private";
  user_favorite?: boolean;
  reposted_by_user?: boolean;
}

export interface SCPlaylist {
  id: SoundCloudUrn;
  urn: SoundCloudUrn;
  title: string;
  user: SCUser;
  artwork_url: string | null;
  /** WaveLink normalizes omitted embedded collections to an empty array. */
  tracks: SCTrack[];
  tracks_count: number;
  track_count?: number;
  duration: number;
  kind: "playlist";
  permalink_url: string;
  description?: string | null;
  likes_count?: number;
  sharing?: "public" | "private";
  user_favorite?: boolean;
  reposted_by_user?: boolean;
}

export interface SCLikedTrack {
  track: SCTrack;
  created_at: string | null;
}

export interface SCPlaylistMutation {
  title?: string;
  description?: string;
  sharing?: "public" | "private";
  trackUrns?: SoundCloudUrn[];
}

export interface SCStreamItem {
  type: string;
  created_at: string;
  uuid?: string;
  track?: SCTrack;
  playlist?: SCPlaylist;
}

export interface SCCollection<T> {
  collection: T[];
  /** Opaque WaveLink pagination cursor, never a raw upstream URL. */
  next_href: string | null;
  query_urn?: string | null;
  total_results?: number;
}

export type SCSearchResult = SCCollection<SCTrack>;

export interface SCMediaSource {
  kind: "hls" | "progressive";
  codec: "aac" | "mp3";
  url: string;
  expiresAt: number;
  access: "playable" | "preview";
}

export interface SCSettings {
  accessToken: string;
  webClientId: string;
}

export interface SCSession {
  version: string;
  ready: boolean;
  mode: "setup" | "account";
  configured: boolean;
  authenticated: boolean;
  setupUrl: string;
  callbackUrl: string;
  user: SCUser | null;
  authMode?: "manual_token_v2";
  capabilities?: {
    publicEmbed: boolean;
    apiSearch: boolean;
    accountLibrary: boolean;
    accountActions: boolean;
    rawPlayback: boolean;
  };
}

export interface SCPublicEmbed {
  id: string;
  kind: "track" | "playlist" | "profile" | "unknown";
  title: string;
  description: string | null;
  authorName: string | null;
  pageUrl: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  height: number;
}

export interface SCBridgeErrorBody {
  error?:
    | string
    | {
        code?: string;
        message?: string;
        requestId?: string;
      };
  message?: string;
  code?: string;
  setupUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isRenderableUser(value: unknown): value is SCUser {
  if (!isRecord(value)) return false;
  const identity = value.urn || value.id;
  return (
    typeof identity === "string" &&
    identity.length > 0 &&
    typeof value.username === "string" &&
    value.username.length > 0
  );
}

export function isRenderableTrack(value: unknown): value is SCTrack {
  if (!isRecord(value)) return false;
  const identity = value.urn || value.id;
  return (
    typeof identity === "string" &&
    identity.length > 0 &&
    typeof value.title === "string" &&
    Number.isFinite(value.duration) &&
    isRenderableUser(value.user)
  );
}

export function isRenderablePlaylist(value: unknown): value is SCPlaylist {
  if (!isRecord(value)) return false;
  const identity = value.urn || value.id;
  return (
    typeof identity === "string" &&
    identity.length > 0 &&
    typeof value.title === "string" &&
    isRenderableUser(value.user)
  );
}
