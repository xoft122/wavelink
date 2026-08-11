import React, { FormEvent, useState } from "react";

interface Props {
  busy: boolean;
  error?: string | null;
  submitLabel?: string;
  initialWebClientId?: string;
  compact?: boolean;
  onSubmit: (accessToken: string, webClientId: string) => Promise<boolean>;
}

export function WebSessionForm({
  busy,
  error,
  submitLabel = "Connect SoundCloud",
  initialWebClientId = "",
  compact = false,
  onSubmit,
}: Props) {
  const [accessToken, setAccessToken] = useState("");
  const [webClientId, setWebClientId] = useState(initialWebClientId);
  const [showToken, setShowToken] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const connected = await onSubmit(accessToken, webClientId);
    if (connected) {
      setAccessToken("");
      setShowToken(false);
    }
  };

  return (
    <form
      className={`wl-credentials${compact ? " wl-credentials--compact" : ""}`}
      onSubmit={(event) => void submit(event)}
    >
      <div className="wl-credentials__field">
        <label className="sc-label" htmlFor={compact ? "wl-settings-oauth" : "wl-oauth-token"}>
          OAuth access token
        </label>
        <div className="wl-credentials__secret">
          <input
            id={compact ? "wl-settings-oauth" : "wl-oauth-token"}
            type={showToken ? "text" : "password"}
            className="sc-input"
            placeholder="OAuth …"
            value={accessToken}
            onChange={(event) => setAccessToken(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={4128}
            required
          />
          <button
            type="button"
            className="wl-credentials__reveal"
            onClick={() => setShowToken((value) => !value)}
            aria-label={showToken ? "Hide OAuth token" : "Show OAuth token"}
          >
            {showToken ? "Hide" : "Show"}
          </button>
        </div>
      </div>

      <div className="wl-credentials__field">
        <label className="sc-label" htmlFor={compact ? "wl-settings-client-id" : "wl-web-client-id"}>
          Web Client ID
        </label>
        <input
          id={compact ? "wl-settings-client-id" : "wl-web-client-id"}
          type="text"
          className="sc-input"
          placeholder="32-character client_id"
          value={webClientId}
          onChange={(event) => setWebClientId(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          minLength={32}
          maxLength={32}
          pattern="[A-Za-z0-9]{32}"
          required
        />
      </div>

      {error && <div className="wl-onboarding__error" role="alert">{error}</div>}

      <button
        type="submit"
        className="wl-btn wl-btn--primary wl-btn--wide"
        disabled={busy || !accessToken.trim() || webClientId.trim().length !== 32}
      >
        {busy ? "Verifying with SoundCloud…" : submitLabel}
      </button>

      <p className="wl-credentials__warning">
        Spotify stores this OAuth pair in local app storage, and SoundCloud API
        requests pass through Spicetify&apos;s CORS relay. Installed Spicetify code,
        DevTools, and the relay can therefore access the OAuth token.
      </p>
    </form>
  );
}
