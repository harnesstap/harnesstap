import { describe, expect, it } from "bun:test";
import { statusRefreshingTooltip } from "../../apps/desktop/src/lib/status-refresh.ts";

describe("status refreshing tooltip", () => {
  it("adds a short refreshing note only while a fresh read is running", () => {
    expect(statusRefreshingTooltip("Active and applied", false)).toBe("Active and applied");
    expect(statusRefreshingTooltip("Active and applied", true)).toBe(
      "Active and applied. Refreshing.",
    );
    expect(statusRefreshingTooltip("Active. Not fully applied.", true)).toBe(
      "Active. Not fully applied. Refreshing.",
    );
  });
});
