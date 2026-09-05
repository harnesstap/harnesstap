import type { TelemetryConsentCopy } from "../lib/types";

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
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="telemetry-consent-title"
        aria-describedby="telemetry-consent-body"
        data-testid="telemetry-consent-modal"
      >
        <h2 id="telemetry-consent-title">{copy.title}</h2>
        <div id="telemetry-consent-body" className="confirm-dialog-body">
          <p>{copy.body}</p>
          <p>
            <strong>What we track</strong>
          </p>
          <ul>
            {copy.tracked.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>
            <strong>What we do not track</strong>
          </p>
          <ul>
            {copy.not_tracked.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <div className="dialog-actions">
          <button
            className="btn"
            type="button"
            disabled={busy}
            data-testid="telemetry-consent-disable"
            onClick={onDisable}
          >
            Disable telemetry
          </button>
          <button
            className={["btn", "primary", busy ? "is-busy" : ""].filter(Boolean).join(" ")}
            type="button"
            disabled={busy}
            data-testid="telemetry-consent-enable"
            onClick={onEnable}
          >
            Enable telemetry
          </button>
        </div>
      </div>
    </div>
  );
}
