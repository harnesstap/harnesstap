import { afterEach, describe, expect, it } from "bun:test";

describe("ui progress", () => {
  let originalStdoutIsTTY: boolean | undefined;

  afterEach(() => {
    if (originalStdoutIsTTY !== undefined) {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      originalStdoutIsTTY = undefined;
    }
  });

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

  it("createProgress handle update is a no-op in non-TTY mode", async () => {
    const { createProgress } = await import("../../src/ui/progress.ts");
    const handle = createProgress("doing work");
    expect(() => handle.update("still working")).not.toThrow();
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

  it("suppresses spinner in test mode even when stdout is a TTY", async () => {
    originalStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: true,
      configurable: true,
    });
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";

    const { createProgress } = await import("../../src/ui/progress.ts");
    const lines: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]) => lines.push(args.map(String).join(" "));
    try {
      const handle = createProgress("doing work");
      handle.succeed("work done");
    } finally {
      console.log = origLog;
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
    }
    expect(lines.some((l) => l.includes("work done"))).toBe(true);
  });
});
