import { useCallback, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  fetchTelemetryConsent,
  resetTelemetryConsent,
  saveTelemetryConsent,
} from "../../lib/agent-client";
import type { TelemetryConsentStatus } from "../../lib/types";
import { toast } from "../../state/toast-store";

export interface TelemetrySettingsSectionProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
  onConsentChange?: (next: TelemetryConsentStatus) => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export const TELEMETRY_ENV_OFF_LABEL = "Turned off by HARNESSTAP_TELEMETRY=0.";
export const TELEMETRY_ENV_ON_LABEL = "Turned on by HARNESSTAP_TELEMETRY=1.";

export function TelemetrySettingsSection({
  open,
  baseUrl,
  token,
  disabled = false,
  onConsentChange,
}: TelemetrySettingsSectionProps) {
  const [status, setStatus] = useState<TelemetryConsentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!open || !baseUrl || !token) {
      return;
    }
    try {
      const next = await fetchTelemetryConsent(baseUrl, token);
      setStatus(next);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError, "Could not load telemetry preference."));
    }
  }, [baseUrl, open, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const onToggle = async (enabled: boolean) => {
    if (!baseUrl || !token) {
      return;
    }
    setBusy(true);
    try {
      const next = await saveTelemetryConsent(baseUrl, token, enabled);
      setStatus(next);
      onConsentChange?.(next);
      setError(null);
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save telemetry preference."));
    } finally {
      setBusy(false);
    }
  };

  const onReset = async () => {
    if (!baseUrl || !token) {
      return;
    }
    setBusy(true);
    try {
      const next = await resetTelemetryConsent(baseUrl, token);
      setStatus(next);
      onConsentChange?.(next);
      setError(null);
      toast({ tone: "success", title: "Telemetry choice reset" });
    } catch (resetError) {
      setError(errorMessage(resetError, "Could not reset telemetry preference."));
    } finally {
      setBusy(false);
    }
  };

  const checked = status?.preference === true || (status?.preference === null && status.enabled);
  // An env override decides capture, so the switch shows the effective state and is locked.
  const envOverride = status?.env_override ?? null;
  const envLabel =
    envOverride === false
      ? TELEMETRY_ENV_OFF_LABEL
      : envOverride === true
        ? TELEMETRY_ENV_ON_LABEL
        : null;
  const canReset = Boolean(status?.consented) && !disabled && !busy && Boolean(baseUrl && token);

  return (
    <section className="settings-section" data-testid="telemetry-settings">
      <h3>Telemetry</h3>
      <p className="field-note muted">{status?.copy.body}</p>
      {status ? (
        <>
          <section className="telemetry-consent-section">
            <h4>What we track</h4>
            <ul className="telemetry-scope-list">
              {status.copy.tracked.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
          <section className="telemetry-consent-section">
            <h4>What we do not track</h4>
            <ul className="telemetry-scope-list">
              {status.copy.not_tracked.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
      {error ? (
        <div className="banner error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="switch-after-create settings-show-all flex items-center gap-2">
        <Switch
          id="settings-telemetry-enabled"
          checked={envOverride ?? checked}
          disabled={disabled || busy || !status || envOverride !== null}
          onCheckedChange={(value) => void onToggle(value)}
          data-testid="settings-telemetry-enabled"
        />
        <Label htmlFor="settings-telemetry-enabled">
          {envLabel ?? "Send anonymous usage telemetry"}
        </Label>
      </div>
      <div className="dialog-actions">
        <button
          className="btn"
          type="button"
          data-testid="settings-telemetry-reset"
          onClick={() => void onReset()}
          disabled={!canReset}
        >
          Reset telemetry choice
        </button>
      </div>
    </section>
  );
}
