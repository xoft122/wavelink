import React, { useEffect, useState } from "react";

import { usePlayer } from "../hooks/usePlayer";
import { loadSettings } from "../services/auth";
import { getSession, isDirectTransportAvailable } from "../services/api";
import { player } from "../services/player";
import {
  MAX_TRACKS_PER_LOAD,
  MIN_TRACKS_PER_LOAD,
  normalizeTracksPerLoad,
} from "../services/tracksPerLoadSetting";
import { SCSession } from "../types/soundcloud";
import { WAVELINK_VERSION } from "../version";
import { WebSessionForm } from "./WebSessionForm";

interface Props {
  onDisconnect: () => void;
  onConnect: (accessToken: string, webClientId: string) => Promise<boolean>;
  isConnecting: boolean;
  authError: string | null;
}

export function SettingsView({
  onDisconnect,
  onConnect,
  isConnecting,
  authError,
}: Props) {
  const {
    scVolMultEnabled,
    scVolumeLevel,
    autoplayRelated,
    tracksPerLoad,
    spotifySearchIntegrationEnabled,
    sourceBadgePreferences,
    setSpotifySearchIntegrationEnabled,
    setTracksPerLoad,
    setSourceBadgeEnabled,
    setSourceBadgeSide,
    setSourceBadgeDodgeOnHover,
    setSourceBadgeLinkEnabled,
    setSourceBadgeDisplayMode,
    setSourceBadgeHideWithFullscreenPlayer,
  } = usePlayer();
  const [session, setSession] = useState<SCSession | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [tracksPerLoadDraft, setTracksPerLoadDraft] = useState(() =>
    String(tracksPerLoad),
  );
  const settings = loadSettings();

  useEffect(() => {
    setTracksPerLoadDraft(String(tracksPerLoad));
  }, [tracksPerLoad]);

  useEffect(() => {
    let active = true;
    void getSession()
      .then((value) => {
        if (!active) return;
        setSession(value);
        setStatus(`Connected as ${value.user?.username ?? "SoundCloud user"}.`);
      })
      .catch((cause) => {
        if (!active) return;
        setStatus(cause instanceof Error ? cause.message : "SoundCloud check failed.");
      });
    return () => {
      active = false;
    };
  }, []);

  const replaceCredentials = async (accessToken: string, webClientId: string) => {
    setStatus(null);
    const connected = await onConnect(accessToken, webClientId);
    if (connected) {
      const value = await getSession().catch(() => null);
      setSession(value);
      setStatus(`Connected as ${value?.user?.username ?? "SoundCloud user"}.`);
    }
    return connected;
  };

  const handleToggleVolMult = (enabled: boolean) => {
    try {
      Spicetify.LocalStorage.set("wavelink:volume-profile-enabled", String(enabled));
    } catch {}
    player.setScVolumeEnabled(enabled);
  };

  const handleVolChange = (value: number) => {
    try {
      Spicetify.LocalStorage.set("wavelink:volume-level", String(value));
    } catch {}
    player.setScVolumeLevel(value);
  };

  const commitTracksPerLoad = () => {
    const normalized = normalizeTracksPerLoad(tracksPerLoadDraft);
    setTracksPerLoadDraft(String(normalized));
    setTracksPerLoad(normalized);
  };

  return (
    <div className="sc-settings">
      <section className="sc-settings__section">
        <h3 className="sc-settings__section-title">SoundCloud account</h3>
        <p className="sc-settings__hint">
          WaveLink runs entirely inside Spotify. There is no local bridge, Client
          Secret, developer OAuth flow or guest mode — only the matching OAuth
          token + Web Client ID pair.
        </p>

        <div className="sc-settings__status" data-connected={session?.authenticated || undefined}>
          <strong>{session?.authenticated ? "Connected" : "Spotify-only transport"}</strong>
          <span>{status ?? "Checking…"}</span>
          <small>
            {isDirectTransportAvailable()
              ? "Spicetify CORS relay transport available"
              : "Browser request transport unavailable in this Spotify build"}
          </small>
        </div>

        <h4 className="sc-settings__subheading">Replace OAuth pair</h4>
        <WebSessionForm
          compact
          busy={isConnecting}
          error={authError}
          submitLabel="Verify and replace"
          initialWebClientId={settings.webClientId}
          onSubmit={replaceCredentials}
        />
      </section>

      <section className="sc-settings__section">
        <h3 className="sc-settings__section-title">Content loading</h3>
        <div className="sc-settings__field">
          <label className="sc-label" htmlFor="wl-tracks-per-load">
            Tracks per load
          </label>
          <p className="sc-settings__hint" id="wl-tracks-per-load-hint">
            WaveLink loads this many tracks at a time in playlists, profiles,
            search results and queues. The next batch starts loading before you
            reach the end. Choose between {MIN_TRACKS_PER_LOAD} and{" "}
            {MAX_TRACKS_PER_LOAD}.
          </p>
          <div className="sc-settings__input-row sc-settings__number-row">
            <input
              className="sc-input"
              id="wl-tracks-per-load"
              type="number"
              min={MIN_TRACKS_PER_LOAD}
              max={MAX_TRACKS_PER_LOAD}
              step={1}
              inputMode="numeric"
              value={tracksPerLoadDraft}
              aria-describedby="wl-tracks-per-load-hint"
              onChange={(event) =>
                setTracksPerLoadDraft(event.target.value)
              }
              onBlur={commitTracksPerLoad}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.blur();
                }
              }}
            />
            <span className="sc-settings__number-unit">tracks</span>
          </div>
        </div>
      </section>

      <section className="sc-settings__section">
        <h3 className="sc-settings__section-title">
          Spotify search integration
        </h3>
        <div className="sc-settings__field">
          <span className="sc-label">
            Show SoundCloud results in Spotify Search
          </span>
          <p className="sc-settings__hint">
            Mix SoundCloud tracks into Spotify&apos;s search suggestions and
            full search results. WaveLink&apos;s own Search remains available.
          </p>
          <label className="sc-toggle-row">
            <input
              type="checkbox"
              checked={spotifySearchIntegrationEnabled}
              onChange={(event) =>
                setSpotifySearchIntegrationEnabled(event.target.checked)
              }
            />
            <span>
              {spotifySearchIntegrationEnabled ? "Enabled" : "Disabled"}
            </span>
          </label>
        </div>
      </section>

      <section className="sc-settings__section">
        <h3 className="sc-settings__section-title">
          Playback source indicator
        </h3>
        <p className="sc-settings__hint">
          Customize the SoundCloud or Spotify badge shown above the lower player
          bar.
        </p>

        <div className="sc-settings__field">
          <span className="sc-label">Show playback source indicator</span>
          <label className="sc-toggle-row">
            <input
              type="checkbox"
              checked={sourceBadgePreferences.enabled}
              onChange={(event) =>
                setSourceBadgeEnabled(event.target.checked)
              }
            />
            <span>
              {sourceBadgePreferences.enabled ? "Enabled" : "Disabled"}
            </span>
          </label>
        </div>

        <fieldset
          className="sc-settings__preference-group"
          disabled={!sourceBadgePreferences.enabled}
          aria-label="Playback source indicator options"
        >
          <div className="sc-settings__field">
            <span className="sc-label">Position</span>
            <div
              className="sc-settings__segmented"
              role="radiogroup"
              aria-label="Source indicator position"
            >
              {(["left", "right"] as const).map((side) => (
                <label
                  key={side}
                  className="sc-settings__segment"
                  data-selected={
                    sourceBadgePreferences.side === side || undefined
                  }
                >
                  <input
                    type="radio"
                    name="wavelink-source-indicator-position"
                    value={side}
                    checked={sourceBadgePreferences.side === side}
                    onChange={() => setSourceBadgeSide(side)}
                  />
                  <span>{side === "left" ? "Bottom left" : "Bottom right"}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="sc-settings__field">
            <span className="sc-label">Appearance</span>
            <div
              className="sc-settings__segmented"
              role="radiogroup"
              aria-label="Source indicator appearance"
            >
              {(["icon-text", "icon-only"] as const).map((mode) => (
                <label
                  key={mode}
                  className="sc-settings__segment"
                  data-selected={
                    sourceBadgePreferences.displayMode === mode || undefined
                  }
                >
                  <input
                    type="radio"
                    name="wavelink-source-indicator-appearance"
                    value={mode}
                    checked={sourceBadgePreferences.displayMode === mode}
                    onChange={() => setSourceBadgeDisplayMode(mode)}
                  />
                  <span>{mode === "icon-text" ? "Icon + text" : "Icon only"}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="sc-settings__field">
            <span className="sc-label">Move to the opposite side on hover</span>
            <p className="sc-settings__hint">
              The indicator moves away while the pointer is in its home corner,
              then returns to your selected side automatically.
            </p>
            <label className="sc-toggle-row">
              <input
                type="checkbox"
                checked={sourceBadgePreferences.dodgeOnHover}
                onChange={(event) =>
                  setSourceBadgeDodgeOnHover(event.target.checked)
                }
              />
              <span>
                {sourceBadgePreferences.dodgeOnHover ? "Enabled" : "Disabled"}
              </span>
            </label>
          </div>

          <div className="sc-settings__field">
            <span className="sc-label">Open SoundCloud track on click</span>
            <p className="sc-settings__hint">
              Controls only the SoundCloud badge. The Spotify indicator never
              opens an external link.
            </p>
            <label className="sc-toggle-row">
              <input
                type="checkbox"
                checked={sourceBadgePreferences.linkEnabled}
                onChange={(event) =>
                  setSourceBadgeLinkEnabled(event.target.checked)
                }
              />
              <span>
                {sourceBadgePreferences.linkEnabled ? "Enabled" : "Disabled"}
              </span>
            </label>
          </div>

          <div className="sc-settings__field">
            <span className="sc-label">
              Fade with fullscreen player controls
            </span>
            <p className="sc-settings__hint">
              When disabled, the indicator stays visible and moves down to the
              screen corner as the lower player bar folds away.
            </p>
            <label className="sc-toggle-row">
              <input
                type="checkbox"
                checked={
                  sourceBadgePreferences.hideWithFullscreenPlayer
                }
                onChange={(event) =>
                  setSourceBadgeHideWithFullscreenPlayer(
                    event.target.checked,
                  )
                }
              />
              <span>
                {sourceBadgePreferences.hideWithFullscreenPlayer
                  ? "Enabled"
                  : "Disabled"}
              </span>
            </label>
          </div>
        </fieldset>
      </section>

      <section className="sc-settings__section">
        <h3 className="sc-settings__section-title">Playback</h3>
        <div className="sc-settings__field">
          <span className="sc-label">Separate volume profiles</span>
          <p className="sc-settings__hint">
            Give WaveLink playback its own volume level. Spotify&apos;s volume is
            restored when WaveLink playback ends.
          </p>
          <label className="sc-toggle-row">
            <input
              type="checkbox"
              checked={scVolMultEnabled}
              onChange={(event) => handleToggleVolMult(event.target.checked)}
            />
            <span>{scVolMultEnabled ? "Enabled" : "Disabled"}</span>
          </label>
        </div>

        {scVolMultEnabled && (
          <div className="sc-settings__field">
            <label className="sc-label" htmlFor="wl-volume">WaveLink volume</label>
            <div className="sc-settings__input-row sc-settings__volume-row">
              <input
                id="wl-volume"
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={scVolumeLevel}
                onChange={(event) => handleVolChange(Number(event.target.value))}
              />
              <span>{Math.round(scVolumeLevel * 100)}%</span>
            </div>
          </div>
        )}

        <div className="sc-settings__field">
          <span className="sc-label">Autoplay related tracks</span>
          <p className="sc-settings__hint">
            When the queue ends, continue with de-duplicated recommendations
            from SoundCloud.
          </p>
          <label className="sc-toggle-row">
            <input
              type="checkbox"
              checked={autoplayRelated}
              onChange={(event) => player.setAutoplayRelated(event.target.checked)}
            />
            <span>{autoplayRelated ? "Enabled" : "Disabled"}</span>
          </label>
        </div>
      </section>

      <section className="sc-settings__section">
        <h3 className="sc-settings__section-title sc-settings__section-title--danger">
          Disconnect SoundCloud
        </h3>
        <p className="sc-settings__hint">
          Deletes the saved OAuth token and Web Client ID from Spotify immediately.
        </p>
        <button className="sc-btn-danger" type="button" onClick={onDisconnect}>
          Disconnect and delete credentials
        </button>
      </section>

      <small className="sc-settings__version">
        WaveLink {WAVELINK_VERSION}
      </small>
    </div>
  );
}
