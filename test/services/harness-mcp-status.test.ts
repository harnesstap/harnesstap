import { describe, expect, it } from "bun:test";
import { buildHarnessMcpRows } from "../../src/services/global-profile-status-panel.ts";

describe("buildHarnessMcpRows", () => {
  it("marks profile MCP with no live install as missing", () => {
    expect(buildHarnessMcpRows(["TEADS-PROD-agency"], new Set())).toEqual([
      { name: "TEADS-PROD-agency", state: "missing" },
    ]);
  });

  it("marks live MCP with a different expected config as mismatch", () => {
    expect(
      buildHarnessMcpRows(["docs"], new Set(["docs"]), {
        expected: {
          docs: { transport: "stdio", command: "npx", args: ["docs-a"] },
        },
        live: {
          docs: { transport: "stdio", command: "npx", args: ["docs-b"] },
        },
      }),
    ).toEqual([{ name: "docs", state: "mismatch" }]);
  });

  it("keeps equivalent live MCP as present", () => {
    expect(
      buildHarnessMcpRows(["docs"], new Set(["docs"]), {
        expected: {
          docs: { transport: "stdio", command: "npx", args: ["docs-a"] },
        },
        live: {
          docs: { transport: "stdio", command: "npx", args: ["docs-a"] },
        },
      }),
    ).toEqual([{ name: "docs", state: "present" }]);
  });

  it("treats native-only live names as present without a live mcp.json entry", () => {
    expect(
      buildHarnessMcpRows(["slack"], new Set(["slack"]), {
        expected: {
          slack: { transport: "stdio", command: "slack-mcp" },
        },
        live: {},
      }),
    ).toEqual([{ name: "slack", state: "present" }]);
  });
});
