import { describe, expect, it } from "vitest";

describe("ui progress", () => {
  it("exports a progress object with lifecycle methods", async () => {
    const { progress } = await import("../../src/ui/progress.ts");
    expect(typeof progress.start).toBe("function");
    expect(typeof progress.stop).toBe("function");
    expect(typeof progress.succeed).toBe("function");
    expect(typeof progress.fail).toBe("function");
  });
});
