import { describe, expect, it } from "bun:test";
import { isHarnessNotSetUp } from "../../apps/desktop/src/lib/harness-not-set-up.ts";

describe("isHarnessNotSetUp", () => {
  it("reads the preview flag", () => {
    expect(isHarnessNotSetUp({ not_set_up: true, contents: null })).toBe(true);
  });

  it("falls back to apply_not_set_up on resource rows", () => {
    expect(
      isHarnessNotSetUp({
        contents: {
          plugins: [],
          stack_resource_count: 1,
          stack_summary: null,
          type_counts: {},
          resources: [{ type: "skill", name: "a", apply_not_set_up: true }],
          plugin_pins: [],
          mcp_servers: [],
        },
      }),
    ).toBe(true);
  });

  it("is false with a registered harness or no preview", () => {
    expect(isHarnessNotSetUp(null)).toBe(false);
    expect(
      isHarnessNotSetUp({
        contents: {
          plugins: [],
          stack_resource_count: 1,
          stack_summary: null,
          type_counts: {},
          resources: [{ type: "skill", name: "a", apply_harnesses: ["cursor"], apply_not_set_up: false }],
          plugin_pins: [],
          mcp_servers: [],
        },
      }),
    ).toBe(false);
  });
});
