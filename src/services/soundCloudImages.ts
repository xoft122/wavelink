export type SoundCloudAvatarPreset =
  | "t50x50"
  | "t67x67"
  | "t200x200"
  | "t300x300"
  | "t500x500";

export interface SoundCloudAvatarSources {
  primary: string;
  fallback: string | null;
}

export const WAVELINK_USER_AVATAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1248" height="1248" viewBox="178 179 892 892">
  <defs>
    <linearGradient id="neonGradient" x1="180" y1="180" x2="1060" y2="1060" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#ff9d00"/>
      <stop offset="38%" stop-color="#ff6b2c"/>
      <stop offset="67%" stop-color="#ff4f4f"/>
      <stop offset="100%" stop-color="#ff008a"/>
    </linearGradient>

    <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="14" result="blur1"/>
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur2"/>
      <feMerge>
        <feMergeNode in="blur1"/>
        <feMergeNode in="blur2"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
  </defs>

  <circle cx="624" cy="625" r="437" stroke-width="18" fill="#000"/>

  <!-- Glow layer -->
  <g fill="none" stroke="url(#neonGradient)" stroke-linecap="round" stroke-linejoin="round"
     filter="url(#softGlow)" opacity="0.78">
    <circle cx="624" cy="625" r="437" stroke-width="18"/>
    <circle cx="624" cy="539" r="171" stroke-width="18"/>
    <path d="M319 938
             C382 806 493 747 624 747
             C755 747 866 806 929 938"
          stroke-width="18"/>
  </g>

  <!-- Sharp neon lines -->
  <g fill="none" stroke="url(#neonGradient)" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="624" cy="625" r="437" stroke-width="14"/>
    <circle cx="624" cy="539" r="171" stroke-width="14"/>
    <path d="M319 938
             C382 806 493 747 624 747
             C755 747 866 806 929 938"
          stroke-width="14"/>
  </g>
</svg>`;

export const WAVELINK_USER_AVATAR_FALLBACK =
  `data:image/svg+xml;charset=utf-8,${encodeURIComponent(WAVELINK_USER_AVATAR_SVG)}`;

const AVATAR_PRESETS: ReadonlySet<string> = new Set([
  "t50x50",
  "t67x67",
  "t200x200",
  "t300x300",
  "t500x500",
]);
const RESIZABLE_AVATAR_PRESET =
  /-(?:badge|tiny|small|mini|large|crop|original|t\d+x\d+)(?=\.(?:jpe?g|png|webp)$)/i;
const SOUNDCLOUD_DEFAULT_AVATAR_PATH =
  /\/images\/default_avatar(?:_[a-z0-9]+)?\.(?:jpe?g|png|webp)$/i;

function safeSoundCloudCdnUrl(value: unknown): URL | null {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      (url.hostname !== "sndcdn.com" &&
        !url.hostname.endsWith(".sndcdn.com"))
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/**
 * Returns a high-resolution SoundCloud avatar plus the untouched CDN URL as a
 * fallback. SoundCloud user payloads commonly return the 100px `-large`
 * rendition even when the image is rendered as a large profile hero.
 */
export function soundCloudAvatarSources(
  value: unknown,
  preset: SoundCloudAvatarPreset = "t500x500",
): SoundCloudAvatarSources | null {
  if (!AVATAR_PRESETS.has(preset)) return null;

  const url = safeSoundCloudCdnUrl(value);
  if (!url) return null;
  if (SOUNDCLOUD_DEFAULT_AVATAR_PATH.test(url.pathname)) return null;

  const fallback = url.toString();
  const upgradedPath = url.pathname.replace(
    RESIZABLE_AVATAR_PRESET,
    `-${preset}`,
  );
  if (upgradedPath === url.pathname) {
    return { primary: fallback, fallback: null };
  }

  url.pathname = upgradedPath;
  const primary = url.toString();
  return {
    primary,
    fallback: primary === fallback ? null : fallback,
  };
}

export function soundCloudAvatarUrl(
  value: unknown,
  preset: SoundCloudAvatarPreset = "t500x500",
): string {
  return soundCloudAvatarSources(value, preset)?.primary ?? "";
}

export function nextSoundCloudAvatarSource(
  currentSource: string,
  sources: SoundCloudAvatarSources | null,
  terminalFallback: string,
): string {
  if (currentSource === terminalFallback) return terminalFallback;
  if (sources?.fallback && currentSource !== sources.fallback) {
    return sources.fallback;
  }
  return terminalFallback;
}
