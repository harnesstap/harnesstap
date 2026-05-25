import { describe, expect, it } from "bun:test";

describe("ui progress", () => {
  it("createProgress factory returns a handle with succeed, fail, stop", async () => {
    const { createProgress } = await import("../../src/ui/progress.ts");
    const handle = createProgress("test operation");
    expect(typeof handle.succeed).toBe("function");
    expect(typeof handle.fail).toBe("function");
    expect(typeof handle.stop).toBe("function");
  });

  it("exports backward-compatible progress singleton with start/stop/succeed/fail", async () => {
    const { progress } = await import("../../src/ui/progress.ts");
    expect(typeof progress.start).toBe("function");
    expect(typeof progress.stop).toBe("function");
    expect(typeof progress.succeed).toBe("function");
    expect(typeof progress.fail).toBe("function");
  });

  it("createProgress handle emits success verdict in non-TTY mode", async () => {
    const { createProgress } = await import("../../src/ui/progress.ts");
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      const handle = createProgress("doing work");
      handle.succeed("work done");
    } finally {
      console.log = origLog;
    }
    expect(lines.some((l) => l.includes("work done"))).toBe(true);
  });

  it("createProgress handle emits failure verdict in non-TTY mode", async () => {
    const { createProgress } = await import("../../src/ui/progress.ts");
    const lines: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      const handle = createProgress("doing work");
      handle.fail("work failed");
    } finally {
      console.error = origError;
    }
    expect(lines.some((l) => l.includes("work failed"))).toBe(true);
  });
});
