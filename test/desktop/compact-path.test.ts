import { afterEach, describe, expect, it } from "bun:test";
import { compactHomePath } from "../../apps/desktop/src/lib/compact-path.ts";
import { setDisplayHome } from "../../apps/desktop/src/lib/display-home.ts";
import { formatUserPath } from "../../apps/desktop/src/lib/ui-copy.ts";

describe("compactHomePath", () => {
  afterEach(() => {
    setDisplayHome(undefined);
  });

  it("replaces a macOS home prefix with a tilde", () => {
    expect(compactHomePath("/Users/ada/src/harnesstap")).toBe("~/src/harnesstap");
  });

  it("ellipsizes the middle of a long path", () => {
    const path =
      "/Users/ada/very/long/nested/project/path/that/should/not/blow/the/picker";
    const compact = compactHomePath(path, 28);
    expect(compact.startsWith("~")).toBe(true);
    expect(compact.includes("...")).toBe(true);
    expect(compact.length).toBeLessThanOrEqual(28);
  });

  it("shortens a non-standard home reported by the agent", () => {
    setDisplayHome("/opt/qa/home");
    expect(compactHomePath("/opt/qa/home/.claude/skills/pair/SKILL.md")).toBe(
      "~/.claude/skills/pair/SKILL.md",
    );
    expect(formatUserPath("/opt/qa/home/.cursor/mcp.json")).toBe("~/.cursor/mcp.json");
  });
});
