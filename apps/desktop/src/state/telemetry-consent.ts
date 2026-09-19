import { useCallback, useEffect, useState } from "react";
import { fetchTelemetryConsent, saveTelemetryConsent } from "../lib/agent-client";
import type { TelemetryConsentStatus } from "../lib/types";
import type { AgentClient } from "./agent-session";
import { statusStore } from "./status-store";

export interface TelemetryConsentState {
  consent: TelemetryConsentStatus | null;
  busy: boolean;
  answer: (enabled: boolean) => Promise<void>;
  sync: (next: TelemetryConsentStatus) => void;
}

/** Loads the consent record on every (re)connect and saves the user's answer. */
export function useTelemetryConsent(client: AgentClient | null): TelemetryConsentState {
  const [consent, setConsent] = useState<TelemetryConsentStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!client) {
      return;
    }
    let cancelled = false;
    void fetchTelemetryConsent(client.baseUrl, client.token)
      .then((next) => {
        if (!cancelled) {
          setConsent(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConsent(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const answer = useCallback(
    async (enabled: boolean) => {
      if (!client) {
        return;
      }
      setBusy(true);
      try {
        setConsent(await saveTelemetryConsent(client.baseUrl, client.token, enabled));
      } catch (error) {
        statusStore.setStatusError(
          error instanceof Error
            ? error.message
            : "Could not save telemetry preference",
        );
      } finally {
        setBusy(false);
      }
    },
    [client],
  );

  const sync = useCallback((next: TelemetryConsentStatus) => {
    setConsent(next);
  }, []);

  return { consent, busy, answer, sync };
}
