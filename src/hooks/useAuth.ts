import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { SCSettings } from "../types/soundcloud";
import {
  clearSettings,
  loadSettings,
  normalizeAccessToken,
  normalizeWebClientId,
  saveSettings,
} from "../services/auth";
import { getAuthSessionStore } from "../services/authSession";
import {
  authenticateWebSession,
  isDirectTransportAvailable,
  updateApiSettings,
} from "../services/api";

const authSessionStore = getAuthSessionStore();

function sameSettings(left: SCSettings, right: SCSettings): boolean {
  return (
    left.accessToken === right.accessToken &&
    left.webClientId === right.webClientId
  );
}

export function useAuth() {
  const [settings, setSettings] = useState<SCSettings>(loadSettings);
  const [isConnecting, setIsConnecting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const settingsRef = useRef(settings);
  const authMutationEpoch = useRef(0);
  const auth = useSyncExternalStore(
    authSessionStore.subscribe,
    authSessionStore.getSnapshot,
    authSessionStore.getSnapshot,
  );

  const applySettings = useCallback((updated: SCSettings) => {
    // Mark our own synchronous settings event before dispatching it. External
    // changes still invalidate any older connect request below.
    settingsRef.current = updated;
    saveSettings(updated);
    updateApiSettings(updated);
    setSettings(updated);
  }, []);

  const refreshSession = useCallback(async () => {
    setFormError(null);
    return authSessionStore.ensureSession(true);
  }, []);

  useEffect(() => {
    const syncSettings = () => {
      // Never trust event.detail: another custom app can dispatch this event.
      // The selected settings backend remains the source of truth.
      const current = loadSettings();
      if (!sameSettings(settingsRef.current, current)) {
        authMutationEpoch.current += 1;
      }
      settingsRef.current = current;
      updateApiSettings(current);
      setSettings(current);
      setFormError(null);
    };

    window.addEventListener("wavelink:settings", syncSettings);
    return () => {
      window.removeEventListener("wavelink:settings", syncSettings);
    };
  }, []);

  useEffect(() => {
    // Usually the startup extension has completed this already. If WaveLink was
    // opened unusually early, this joins the same in-flight check instead of
    // starting another /me request.
    void authSessionStore.ensureSession();
  }, []);

  const connect = useCallback(
    async (rawAccessToken: string, rawWebClientId: string) => {
      const mutation = ++authMutationEpoch.current;
      setIsConnecting(true);
      setFormError(null);
      try {
        if (!isDirectTransportAvailable()) {
          throw new Error(
            "This Spotify build does not expose the browser request transport WaveLink needs.",
          );
        }
        const accessToken = normalizeAccessToken(rawAccessToken);
        const webClientId = normalizeWebClientId(rawWebClientId);
        const updated = { accessToken, webClientId };
        const value = await authenticateWebSession(accessToken, webClientId);
        if (mutation !== authMutationEpoch.current) return false;
        applySettings(updated);
        if (!authSessionStore.commitAuthenticated(value, updated)) {
          await authSessionStore.ensureSession(true);
        }
        return true;
      } catch (cause) {
        if (mutation !== authMutationEpoch.current) return false;
        setFormError(
          cause instanceof Error
            ? cause.message
            : "SoundCloud rejected these credentials.",
        );
        return false;
      } finally {
        if (mutation === authMutationEpoch.current) {
          setIsConnecting(false);
        }
      }
    },
    [applySettings],
  );

  const disconnect = useCallback(() => {
    authMutationEpoch.current += 1;
    setIsConnecting(false);
    clearSettings();
    const clean = loadSettings();
    settingsRef.current = clean;
    updateApiSettings(clean);
    setSettings(clean);
    setFormError(null);
  }, []);

  return {
    isReady: auth.phase === "authenticated",
    isConnecting,
    isChecking: auth.isChecking,
    hasSavedCredentials: auth.hasCredentials,
    authPhase: auth.phase,
    error: formError ?? auth.error,
    session: auth.session,
    settings,
    connect,
    disconnect,
    refreshSession,
  };
}
