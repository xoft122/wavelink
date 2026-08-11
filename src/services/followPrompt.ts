import type { SCPlaylist, SCTrack, SCUser } from "../types/soundcloud";

const CANONICAL_SOUNDCLOUD_URL = "https://soundcloud.com/";
const STYLE_ID = "wavelink-follow-prompt-styles";

export type FollowPromptAction = "cancel" | "open";

export interface FollowPromptModel {
  title: string;
  heading: string;
  explanation: string;
  instruction: string;
  profileUrl: string;
  actions: readonly [
    { id: "cancel"; label: string },
    { id: "open"; label: string },
  ];
}

export interface FollowPromptActionHandlers {
  close: () => void;
  openExternal: (url: string) => void;
}

export interface SoundCloudPromptOptions {
  onOpen?: () => void;
}

function safeArtistName(value: unknown): string {
  if (typeof value !== "string") return "this artist";
  const clean = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean ? [...clean].slice(0, 120).join("") : "this artist";
}

export function normalizeSoundCloudProfileUrl(value: unknown): string {
  if (typeof value === "string") {
    try {
      const url = new URL(value);
      if (
        url.protocol === "https:" &&
        !url.port &&
        !url.username &&
        !url.password &&
        (url.hostname === "soundcloud.com" ||
          url.hostname.endsWith(".soundcloud.com"))
      ) {
        url.hash = "";
        return url.toString();
      }
    } catch {
      // Fall through to SoundCloud's canonical public origin.
    }
  }
  return CANONICAL_SOUNDCLOUD_URL;
}

export function createFollowPromptModel(
  user: Pick<SCUser, "username" | "permalink_url">,
  alreadyFollowing = false,
): FollowPromptModel {
  const artist = safeArtistName(user.username);
  return {
    title: alreadyFollowing
      ? "Manage following on SoundCloud"
      : "Follow on SoundCloud",
    heading: alreadyFollowing
      ? `Manage ${artist} on SoundCloud`
      : `Follow ${artist} on SoundCloud`,
    explanation:
      "WaveLink can’t change your SoundCloud follow status directly because SoundCloud protects this account action.",
    instruction: alreadyFollowing
      ? `Open ${artist}’s SoundCloud profile, change the follow status there, then return to WaveLink.`
      : `Open ${artist}’s SoundCloud profile, select Follow there, then return to WaveLink.`,
    profileUrl: normalizeSoundCloudProfileUrl(user.permalink_url),
    actions: [
      { id: "cancel", label: "Cancel" },
      { id: "open", label: "Open SoundCloud profile" },
    ],
  };
}

export function createLikePromptModel(
  track: Pick<SCTrack, "title" | "permalink_url">,
  kind: "track" | "playlist" = "track",
): FollowPromptModel {
  const title = safeArtistName(track.title);
  return {
    title: "Like on SoundCloud",
    heading: `Like ${title} on SoundCloud`,
    explanation:
      "WaveLink can't add SoundCloud likes directly because SoundCloud protects this account action.",
    instruction: `Open the ${kind} on SoundCloud, select Like there, then return to WaveLink. The heart will update automatically.`,
    profileUrl: normalizeSoundCloudProfileUrl(track.permalink_url),
    actions: [
      { id: "cancel", label: "Cancel" },
      {
        id: "open",
        label: `Open ${kind} on SoundCloud`,
      },
    ],
  };
}

export function createRepostPromptModel(
  entity: Pick<SCTrack | SCPlaylist, "title" | "permalink_url">,
  kind: "track" | "playlist" = "track",
  alreadyReposted = false,
): FollowPromptModel {
  const title = safeArtistName(entity.title);
  return {
    title: alreadyReposted
      ? "Manage repost on SoundCloud"
      : "Repost on SoundCloud",
    heading: alreadyReposted
      ? `Manage the repost of ${title}`
      : `Repost ${title} on SoundCloud`,
    explanation:
      "WaveLink can't change SoundCloud reposts directly because SoundCloud protects this account action.",
    instruction: alreadyReposted
      ? `Open the ${kind} on SoundCloud, select Repost again and remove the repost there, then return to WaveLink. The repost status will update automatically.`
      : `Open the ${kind} on SoundCloud, select Repost there, then return to WaveLink. The repost status will update automatically.`,
    profileUrl: normalizeSoundCloudProfileUrl(entity.permalink_url),
    actions: [
      { id: "cancel", label: "Cancel" },
      {
        id: "open",
        label: `Open ${kind} on SoundCloud`,
      },
    ],
  };
}

export function createPlaylistMutationPromptModel(
  mode: "create" | "edit",
  playlist?: Pick<SCPlaylist, "title" | "permalink_url">,
): FollowPromptModel {
  if (mode === "create") {
    return {
      title: "Create playlist on SoundCloud",
      heading: "Create the playlist on SoundCloud",
      explanation:
        "WaveLink can't create SoundCloud playlists directly because SoundCloud protects this account action.",
      instruction:
        "Open SoundCloud, choose any track, select its three-dot menu, then Add to playlist and create a new playlist. Save it there and return to WaveLink; your playlists will refresh automatically.",
      profileUrl: CANONICAL_SOUNDCLOUD_URL,
      actions: [
        { id: "cancel", label: "Cancel" },
        { id: "open", label: "Open SoundCloud" },
      ],
    };
  }

  const title = safeArtistName(playlist?.title);
  return {
    title: "Edit playlist on SoundCloud",
    heading: `Edit ${title} on SoundCloud`,
    explanation:
      "WaveLink can't edit SoundCloud playlists directly because SoundCloud protects this account action.",
    instruction:
      "Open the playlist on SoundCloud, select the pencil/Edit control, save your changes there, then return to WaveLink. The playlist will refresh automatically.",
    profileUrl: normalizeSoundCloudProfileUrl(playlist?.permalink_url),
    actions: [
      { id: "cancel", label: "Cancel" },
      { id: "open", label: "Open playlist on SoundCloud" },
    ],
  };
}

export function performFollowPromptAction(
  action: FollowPromptAction,
  model: FollowPromptModel,
  handlers: FollowPromptActionHandlers,
): void {
  if (action === "cancel") {
    handlers.close();
    return;
  }
  try {
    handlers.openExternal(model.profileUrl);
  } finally {
    handlers.close();
  }
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .wl-follow-prompt {
      display: grid;
      width: min(520px, calc(100vw - 72px));
      max-width: 100%;
      gap: 18px;
      color: var(--text-base, #fff);
      font-family: var(--encore-body-font-stack, sans-serif);
    }

    .wl-follow-prompt__notice {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: start;
      gap: 14px;
      border: 1px solid rgba(255, 149, 72, 0.28);
      border-radius: 14px;
      padding: 16px;
      background:
        radial-gradient(circle at 0 0, rgba(255, 85, 0, 0.13), transparent 14rem),
        rgba(255, 255, 255, 0.045);
    }

    .wl-follow-prompt__icon {
      display: grid;
      width: 32px;
      height: 32px;
      place-items: center;
      border-radius: 50%;
      color: #180a02;
      background: linear-gradient(135deg, #ffb067, #ff5500);
      box-shadow: 0 8px 22px rgba(255, 85, 0, 0.24);
      font-size: 18px;
      font-weight: 900;
      line-height: 1;
    }

    .wl-follow-prompt__copy {
      min-width: 0;
    }

    .wl-follow-prompt__copy strong {
      display: block;
      margin: 1px 0 6px;
      color: var(--text-base, #fff);
      font-size: 16px;
      line-height: 1.25;
    }

    .wl-follow-prompt__copy p,
    .wl-follow-prompt__instruction {
      margin: 0;
      color: var(--text-subdued, #b3b3b3);
      font-size: 13px;
      line-height: 1.55;
    }

    .wl-follow-prompt__instruction {
      padding: 0 2px;
      color: var(--text-base, #fff);
    }

    .wl-follow-prompt__actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      border-top: 1px solid rgba(255, 255, 255, 0.09);
      padding-top: 18px;
    }

    .wl-follow-prompt__button {
      min-height: 42px;
      border: 0;
      border-radius: 999px;
      padding: 0 18px;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 800;
      transition: transform 140ms ease, background 140ms ease, color 140ms ease, box-shadow 140ms ease;
    }

    .wl-follow-prompt__button:hover {
      transform: scale(1.025);
    }

    .wl-follow-prompt__button:focus-visible {
      outline: 3px solid rgba(255, 255, 255, 0.8);
      outline-offset: 3px;
    }

    .wl-follow-prompt__button--cancel {
      color: var(--text-base, #fff);
      background: rgba(255, 255, 255, 0.09);
    }

    .wl-follow-prompt__button--cancel:hover {
      background: rgba(255, 255, 255, 0.15);
    }

    .wl-follow-prompt__button--open {
      color: #180a02;
      background: linear-gradient(135deg, #ff9f52, #ff5500);
      box-shadow: 0 10px 26px rgba(255, 85, 0, 0.22);
    }

    .wl-follow-prompt__button--open:hover {
      box-shadow: 0 12px 30px rgba(255, 85, 0, 0.32);
    }

    @media (max-width: 560px) {
      .wl-follow-prompt {
        width: 100%;
      }

      .wl-follow-prompt__actions {
        flex-direction: column-reverse;
      }

      .wl-follow-prompt__button {
        width: 100%;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .wl-follow-prompt__button {
        transition: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function openExternalProfile(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function showSoundCloudActionPrompt(
  model: FollowPromptModel,
  options: SoundCloudPromptOptions = {},
): void {
  ensureStyles();

  const close = () => Spicetify.PopupModal.hide();
  const act = (action: FollowPromptAction) =>
    performFollowPromptAction(action, model, {
      close,
      openExternal: (url) => {
        options.onOpen?.();
        openExternalProfile(url);
      },
    });
  const h = Spicetify.React.createElement;
  const content = h(
    "div",
    { className: "wl-follow-prompt" },
    h(
      "div",
      { className: "wl-follow-prompt__notice" },
      h(
        "span",
        { className: "wl-follow-prompt__icon", "aria-hidden": "true" },
        "!",
      ),
      h(
        "div",
        { className: "wl-follow-prompt__copy" },
        h("strong", null, model.heading),
        h("p", null, model.explanation),
      ),
    ),
    h(
      "p",
      { className: "wl-follow-prompt__instruction" },
      model.instruction,
    ),
    h(
      "div",
      { className: "wl-follow-prompt__actions" },
      h(
        "button",
        {
          type: "button",
          className:
            "wl-follow-prompt__button wl-follow-prompt__button--cancel",
          autoFocus: true,
          onClick: () => act("cancel"),
        },
        model.actions[0].label,
      ),
      h(
        "button",
        {
          type: "button",
          className:
            "wl-follow-prompt__button wl-follow-prompt__button--open",
          onClick: () => act("open"),
        },
        model.actions[1].label,
        " ↗",
      ),
    ),
  );

  Spicetify.PopupModal.display({
    title: model.title,
    content,
  });
}

export function showSoundCloudFollowPrompt(
  user: Pick<SCUser, "username" | "permalink_url">,
  alreadyFollowing = false,
  options: SoundCloudPromptOptions = {},
): void {
  showSoundCloudActionPrompt(
    createFollowPromptModel(user, alreadyFollowing),
    options,
  );
}

export function showSoundCloudLikePrompt(
  track: Pick<SCTrack, "title" | "permalink_url">,
  options: SoundCloudPromptOptions = {},
): void {
  showSoundCloudActionPrompt(createLikePromptModel(track), options);
}

export function showSoundCloudPlaylistLikePrompt(
  playlist: Pick<SCTrack, "title" | "permalink_url">,
  options: SoundCloudPromptOptions = {},
): void {
  showSoundCloudActionPrompt(
    createLikePromptModel(playlist, "playlist"),
    options,
  );
}

export function showSoundCloudTrackRepostPrompt(
  track: Pick<SCTrack, "title" | "permalink_url">,
  alreadyReposted = false,
  options: SoundCloudPromptOptions = {},
): void {
  showSoundCloudActionPrompt(
    createRepostPromptModel(track, "track", alreadyReposted),
    options,
  );
}

export function showSoundCloudPlaylistRepostPrompt(
  playlist: Pick<SCPlaylist, "title" | "permalink_url">,
  alreadyReposted = false,
  options: SoundCloudPromptOptions = {},
): void {
  showSoundCloudActionPrompt(
    createRepostPromptModel(playlist, "playlist", alreadyReposted),
    options,
  );
}

export function showSoundCloudCreatePlaylistPrompt(
  options: SoundCloudPromptOptions = {},
): void {
  showSoundCloudActionPrompt(
    createPlaylistMutationPromptModel("create"),
    options,
  );
}

export function showSoundCloudEditPlaylistPrompt(
  playlist: Pick<SCPlaylist, "title" | "permalink_url">,
  options: SoundCloudPromptOptions = {},
): void {
  showSoundCloudActionPrompt(
    createPlaylistMutationPromptModel("edit", playlist),
    options,
  );
}
