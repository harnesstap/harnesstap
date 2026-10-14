import { describe, expect, it } from "bun:test";
import {
  LIVE_STATUS_POLL_MS,
  shouldPollLiveStatus,
} from "../../apps/desktop/src/state/status-poll.ts";

describe("shouldPollLiveStatus", () => {
  it("polls only while enabled, visible, focused, and idle", () => {
    expect(LIVE_STATUS_POLL_MS).toBeGreaterThanOrEqual(5_000);
    expect(LIVE_STATUS_POLL_MS).toBeLessThanOrEqual(10_000);
    expect(shouldPollLiveStatus({
      enabled: true,
      visible: true,
      focused: true,
      inFlight: false,
    })).toBe(true);
    expect(shouldPollLiveStatus({
      enabled: false,
      visible: true,
      focused: true,
      inFlight: false,
    })).toBe(false);
    expect(shouldPollLiveStatus({
      enabled: true,
      visible: false,
      focused: true,
      inFlight: false,
    })).toBe(false);
    expect(shouldPollLiveStatus({
      enabled: true,
      visible: true,
      focused: false,
      inFlight: false,
    })).toBe(false);
    expect(shouldPollLiveStatus({
      enabled: true,
      visible: true,
      focused: true,
      inFlight: true,
    })).toBe(false);
  });
});
