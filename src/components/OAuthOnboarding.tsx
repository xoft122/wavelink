import React from "react";

import { WebSessionForm } from "./WebSessionForm";

interface Props {
  isConnecting: boolean;
  error: string | null;
  initialWebClientId?: string;
  onConnect: (accessToken: string, webClientId: string) => Promise<boolean>;
}

function WaveMark() {
  return (
    <span className="wl-mark" aria-hidden="true">
      <svg viewBox="0 0 36 36">
        <defs><linearGradient id="wl-onboarding-gradient" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#ff8a1f"/><stop offset="1" stopColor="#ff3d72"/></linearGradient></defs>
        <rect width="36" height="36" rx="11" fill="url(#wl-onboarding-gradient)" />
        <path d="M6 20c3.4 0 3.4-7.5 6.8-7.5S16.2 23 19.6 23s3.4-7.5 6.8-7.5S29.8 20 30 20" fill="none" stroke="white" strokeWidth="3" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function OAuthOnboarding({
  isConnecting,
  error,
  initialWebClientId,
  onConnect,
}: Props) {
  return (
    <div className="wl-onboarding">
      <header className="wl-onboarding__header">
        <div className="wl-brand"><WaveMark /><span>WaveLink</span></div>
        <span className="wl-onboarding__bridge-status wl-onboarding__bridge-status--direct">
          <i /> Spotify-only · no local bridge
        </span>
      </header>

      <main className="wl-onboarding__main">
        <section className="wl-onboarding__visual" aria-hidden="true">
          <div className="wl-onboarding__orb wl-onboarding__orb--one" />
          <div className="wl-onboarding__orb wl-onboarding__orb--two" />
          <div className="wl-onboarding__art-card wl-onboarding__art-card--back">
            <span>YOUR</span><strong>LIKES</strong>
          </div>
          <div className="wl-onboarding__art-card wl-onboarding__art-card--front">
            <svg viewBox="0 0 120 48"><path d="M3 29c11 0 11-22 22-22s11 34 22 34S58 19 69 19s11 19 22 19 11-10 26-10" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round"/></svg>
            <strong className="wl-onboarding__soundcloud-wordmark">SOUNDCLOUD</strong><span>inside Spotify</span>
          </div>
        </section>

        <section className="wl-onboarding__card">
          <span className="wl-eyebrow">Runs entirely inside Spotify</span>
          <h1>Connect SoundCloud</h1>
          <p className="wl-onboarding__lead">
            Paste the matching OAuth token and Web Client ID. WaveLink verifies
            the pair with SoundCloud and then your feed, likes,
            playlists, profiles and playback work entirely inside Spotify.
          </p>

          <WebSessionForm
            busy={isConnecting}
            error={error}
            initialWebClientId={initialWebClientId}
            onSubmit={onConnect}
          />

          <section
            className="wl-onboarding__credential-help"
            aria-labelledby="wl-credential-help-title"
          >
            <header className="wl-onboarding__credential-header">
              <div className="wl-onboarding__credential-header-copy">
                <h2 id="wl-credential-help-title">
                  Get your credentials from DevTools
                </h2>
                <p>Copy both values from the same signed-in session.</p>
              </div>
            </header>

            <ol className="wl-onboarding__credential-steps" role="list">
              <li className="wl-onboarding__credential-step">
                <span
                  className="wl-onboarding__credential-step-number"
                  aria-hidden="true"
                >
                  01
                </span>
                <span className="wl-onboarding__credential-step-copy">
                  <strong>Open SoundCloud.</strong>{" "}
                  <span>
                    Sign in at <code>soundcloud.com</code>, then press <kbd>F12</kbd>.
                  </span>
                </span>
              </li>
              <li className="wl-onboarding__credential-step">
                <span
                  className="wl-onboarding__credential-step-number"
                  aria-hidden="true"
                >
                  02
                </span>
                <span className="wl-onboarding__credential-step-copy">
                  <strong>Find an API request.</strong>{" "}
                  <span>
                    Open <strong>Network</strong>, filter by{" "}
                    <code>api-v2.soundcloud.com</code>, then reload.
                  </span>
                </span>
              </li>
              <li className="wl-onboarding__credential-step">
                <span
                  className="wl-onboarding__credential-step-number"
                  aria-hidden="true"
                >
                  03
                </span>
                <span className="wl-onboarding__credential-step-copy">
                  <strong>Copy Web Client ID.</strong>{" "}
                  <span>
                    Open any request and copy the URL value after{" "}
                    <code>client_id=</code>.
                  </span>
                </span>
              </li>
              <li className="wl-onboarding__credential-step">
                <span
                  className="wl-onboarding__credential-step-number"
                  aria-hidden="true"
                >
                  04
                </span>
                <span className="wl-onboarding__credential-step-copy">
                  <strong>Copy OAuth token.</strong>{" "}
                  <span>
                    Copy the value after <code>Authorization: OAuth</code> in{" "}
                    <strong>Request Headers</strong>.
                  </span>
                </span>
              </li>
            </ol>
          </section>
        </section>
      </main>
    </div>
  );
}
