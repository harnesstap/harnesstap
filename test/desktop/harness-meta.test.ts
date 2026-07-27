import { describe, expect, it } from "bun:test";
import {
  harnessDisplayName,
  relatedHarnessesForResourceType,
} from "../../apps/desktop/src/lib/harness-meta.ts";

describe("relatedHarnessesForResourceType", () => {
  it("maps portable types to both desktop harnesses", () => {
    expect([...relatedHarnessesForResourceType("skill")]).toEqual([
      "claude-code",
      "cursor",
    ]);
    expect([...relatedHarnessesForResourceType("mcp_server")]).toEqual([
      "claude-code",
      "cursor",
    ]);
  });

  it("maps Claude-only types to claude-code", () => {
    expect([...relatedHarnessesForResourceType("permission")]).toEqual([
      "claude-code",
    ]);
    expect([...relatedHarnessesForResourceType("command")]).toEqual([
      "claude-code",
    ]);
    expect([...relatedHarnessesForResourceType("env_var")]).toEqual([
      "claude-code",
    ]);
  });

  it("falls back to both harnesses for unknown types", () => {
    expect([...relatedHarnessesForResourceType("unknown_type")]).toEqual([
      "claude-code",
      "cursor",
    ]);
  });
});

describe("harnessDisplayName", () => {
  it("returns friendly names for known harnesses", () => {
    expect(harnessDisplayName("claude-code")).toBe("Claude Code");
    expect(harnessDisplayName("cursor")).toBe("Cursor");
  });

  it("returns the id for unknown harnesses", () => {
    expect(harnessDisplayName("mystery")).toBe("mystery");
  });
});
