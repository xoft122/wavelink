import React, { useMemo, useState } from "react";

import {
  nextSoundCloudAvatarSource,
  SoundCloudAvatarPreset,
  soundCloudAvatarSources,
  WAVELINK_USER_AVATAR_FALLBACK,
} from "../services/soundCloudImages";

export const FALLBACK_USER_AVATAR = WAVELINK_USER_AVATAR_FALLBACK;

type NativeImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "onError"
>;

interface SoundCloudAvatarProps extends NativeImageProps {
  avatarUrl: string;
  preset?: SoundCloudAvatarPreset;
}

export function SoundCloudAvatar({
  avatarUrl,
  preset = "t500x500",
  ...imageProps
}: SoundCloudAvatarProps) {
  const sources = useMemo(
    () => soundCloudAvatarSources(avatarUrl, preset),
    [avatarUrl, preset],
  );
  const primary = sources?.primary ?? FALLBACK_USER_AVATAR;
  const [attempt, setAttempt] = useState({
    primary,
    source: primary,
  });
  const source =
    attempt.primary === primary ? attempt.source : primary;

  return (
    <img
      {...imageProps}
      src={source}
      onError={() => {
        setAttempt((current) => {
          const currentSource =
            current.primary === primary ? current.source : primary;
          return {
            primary,
            source: nextSoundCloudAvatarSource(
              currentSource,
              sources,
              FALLBACK_USER_AVATAR,
            ),
          };
        });
      }}
    />
  );
}
