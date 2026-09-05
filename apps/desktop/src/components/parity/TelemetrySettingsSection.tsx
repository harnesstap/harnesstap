import { useCallback, useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  fetchTelemetryConsent,
  saveTelemetryConsent,
} from "../../lib/agent-client";
import type { TelemetryConsentStatus } from "../../lib/types";

export interface TelemetrySettingsSectionProps {
  open: boolean;
  baseUrl: string | null;
  token: string | null;
  disabled?: boolean;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function TelemetrySettingsSection({
  open,
  baseUrl,
  token,
  disabled = false,
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
      setError(null);
    } catch (saveError) {
      setError(errorMessage(saveError, "Could not save telemetry preference."));
    } finally {
      setBusy(false);
    }
  };

  const checked = status?.preference === true || (status?.preference === null && status.enabled);
  const envNote =
    status?.env_override === false
      ? "HARNESSTAP_TELEMETRY=0 currently disables capture, even if this switch is on."
      : status?.env_override === true
        ? "HARNESSTAP_TELEMETRY=1 currently enables capture, even if this switch is off."
        : null;

  return (
    <section className="settings-section" data-testid="telemetry-settings">
      <h3>Telemetry</h3>
      <p className="field-note muted">{status?.copy.body}</p>
      {status ? (
        <>
          <p className="field-note muted">
            <strong>What we track:</strong> {status.copy.tracked.join("; ")}.
          </p>
          <p className="field-note muted">
            <strong>What we do not track:</strong> {status.copy.not_tracked.join("; ")}.
          </p>
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
          checked={checked}
          disabled={disabled || busy || !status}
          onCheckedChange={(value) => void onToggle(value)}
          data-testid="settings-telemetry-enabled"
        />
        <Label htmlFor="settings-telemetry-enabled">Send anonymous usage telemetry</Label>
      </div>
      {envNote ? <p className="field-note muted">{envNote}</p> : null}
    </section>
  );
}
