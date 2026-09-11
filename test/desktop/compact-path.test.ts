import { describe, expect, it } from "bun:test";
import { compactHomePath } from "../../apps/desktop/src/lib/compact-path.ts";

describe("compactHomePath", () => {
  it("replaces a macOS home prefix with a tilde", () => {
    expect(compactHomePath("/Users/ada/src/harnesstap")).toBe("~/src/harnesstap");
  });

  it("ellipsizes the middle of a long path", () => {
    const path =
      "/Users/ada/very/long/nested/project/path/that/should/not/blow/the/picker";
    const compact = compactHomePath(path, 28);
    expect(compact.startsWith("~")).toBe(true);
    expect(compact.includes("…")).toBe(true);
    expect(compact.length).toBeLessThanOrEqual(28);
  });
});
