import { afterEach, describe, expect, it } from "bun:test";

describe("ui theme", () => {
  let originalStdoutIsTTY: boolean | undefined;
  let originalNoColor: string | undefined;

  afterEach(() => {
    if (originalStdoutIsTTY !== undefined) {
      Object.defineProperty(process.stdout, "isTTY", {
        value: originalStdoutIsTTY,
        configurable: true,
      });
      originalStdoutIsTTY = undefined;
    }
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }
    originalNoColor = undefined;
  });

  it("uses ASCII table chars when stdout is not a TTY", async () => {
    originalStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    const { getTableChars } = await import("../../src/ui/theme.ts");
    expect(getTableChars().top).toBe("+");
  });

  it("disables color styles when NO_COLOR is set", async () => {
    originalNoColor = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    const { theme } = await import("../../src/ui/theme.ts");
    expect(theme.success("ok")).toBe("ok");
  });
});
