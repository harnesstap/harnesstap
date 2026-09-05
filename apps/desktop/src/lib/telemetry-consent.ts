export function shouldShowTelemetryConsentModal(status: {
  needs_consent: boolean;
} | null): boolean {
  return status?.needs_consent === true;
}
