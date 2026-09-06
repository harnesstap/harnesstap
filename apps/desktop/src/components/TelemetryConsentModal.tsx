import { Check, X } from "lucide-react";
import type { TelemetryConsentCopy } from "../lib/types";
import { ButtonSpinner } from "./ButtonSpinner";

export interface TelemetryConsentModalProps {
  open: boolean;
  copy: TelemetryConsentCopy;
  busy?: boolean;
  onEnable: () => void;
  onDisable: () => void;
}

export function TelemetryConsentModal({
  open,
  copy,
  busy = false,
  onEnable,
  onDisable,
}: TelemetryConsentModalProps) {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div
        className="dialog telemetry-consent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-consent-title"
        aria-describedby="telemetry-consent-body"
        data-testid="telemetry-consent-modal"
      >
        <h2 id="telemetry-consent-title">{copy.title}</h2>
        <div id="telemetry-consent-body" className="telemetry-consent-body">
          <p className="muted">{copy.body}</p>
          <section className="telemetry-consent-section">
            <h3>What we track</h3>
            <ul className="telemetry-scope-list">
              {copy.tracked.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
          <section className="telemetry-consent-section">
            <h3>What we do not track</h3>
            <ul className="telemetry-scope-list">
              {copy.not_tracked.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </div>
        <div className="dialog-actions">
          <button
            className="btn"
            type="button"
            disabled={busy}
            data-testid="telemetry-consent-disable"
            onClick={onDisable}
          >
            {busy ? <ButtonSpinner size={16} /> : <X size={16} aria-hidden />}
            Disable
          </button>
          <button
            className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
            type="button"
            disabled={busy}
            aria-busy={busy}
            data-testid="telemetry-consent-enable"
            onClick={onEnable}
          >
            {busy ? <ButtonSpinner size={16} /> : <Check size={16} aria-hidden />}
            Enable
          </button>
        </div>
      </div>
    </div>
  );
}
