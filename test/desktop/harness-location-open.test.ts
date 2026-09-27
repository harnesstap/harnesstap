import { describe, expect, it } from "bun:test";
import {
  HARNESS_OPEN_LOCATION_LABEL,
  harnessLocationOpenRequest,
} from "../../apps/desktop/src/lib/harness-location-open.ts";

describe("harnessLocationOpenRequest", () => {
  it("reveals inventory section paths in the file manager", () => {
    expect(harnessLocationOpenRequest("~/.cursor/skills")).toEqual({
      path: "~/.cursor/skills",
      reveal: true,
    });
    expect(HARNESS_OPEN_LOCATION_LABEL).toBe("Open location");
  });
});
