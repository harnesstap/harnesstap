import { describe, expect, it } from "bun:test";
import { shouldShowTelemetryConsentModal } from "./telemetry-consent";

describe("shouldShowTelemetryConsentModal", () => {
  it("shows once when consent is unsettled", () => {
    expect(shouldShowTelemetryConsentModal({ needs_consent: true })).toBe(true);
  });

  it("does not show after a preference is persisted", () => {
    expect(shouldShowTelemetryConsentModal({ needs_consent: false })).toBe(false);
  });

  it("does not show before status loads", () => {
    expect(shouldShowTelemetryConsentModal(null)).toBe(false);
  });
});
