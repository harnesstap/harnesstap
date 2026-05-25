import { afterEach, describe, expect, it, vi } from "vitest";

describe("ui theme", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses ASCII table chars when stdout is not a TTY", async () => {
    vi.stubGlobal("process", { ...process, stdout: { ...process.stdout, isTTY: false, columns: 80 } });
    const { getTableChars } = await import("../../src/ui/theme.ts");
    expect(getTableChars().top).toBe("+");
  });

  it("disables color styles when NO_COLOR is set", async () => {
    vi.stubEnv("NO_COLOR", "1");
    const { theme } = await import("../../src/ui/theme.ts");
    expect(theme.success("ok")).toBe("ok");
  });
});
