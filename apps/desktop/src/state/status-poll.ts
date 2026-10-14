/** Fast live-status poll interval while the window is visible and focused. */
export const LIVE_STATUS_POLL_MS = 8_000;

export function shouldPollLiveStatus(input: {
  enabled: boolean;
  visible: boolean;
  focused: boolean;
  inFlight: boolean;
}): boolean {
  return input.enabled && input.visible && input.focused && !input.inFlight;
}
