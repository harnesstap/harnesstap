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

  describe("role-based tokens", () => {
    it("provides heading style", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.heading).toBeDefined();
      expect(typeof theme.heading).toBe("function");
      const styled = theme.heading("Section Title");
      expect(typeof styled).toBe("string");
      expect(styled.length).toBeGreaterThan(0);
    });

    it("provides label style", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.label).toBeDefined();
      expect(typeof theme.label).toBe("function");
      const styled = theme.label("Field:");
      expect(typeof styled).toBe("string");
    });

    it("provides command style", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.command).toBeDefined();
      expect(typeof theme.command).toBe("function");
      const styled = theme.command("deploy");
      expect(typeof styled).toBe("string");
    });

    it("provides flag style", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.flag).toBeDefined();
      expect(typeof theme.flag).toBe("function");
      const styled = theme.flag("--verbose");
      expect(typeof styled).toBe("string");
    });

    it("provides entity style", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.entity).toBeDefined();
      expect(typeof theme.entity).toBe("function");
      const styled = theme.entity("my-pipeline");
      expect(typeof styled).toBe("string");
    });

    it("provides path style", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.path).toBeDefined();
      expect(typeof theme.path).toBe("function");
      const styled = theme.path("./config.yaml");
      expect(typeof styled).toBe("string");
    });

    it("provides info style", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.info).toBeDefined();
      expect(typeof theme.info).toBe("function");
      const styled = theme.info("Additional details");
      expect(typeof styled).toBe("string");
    });

    it("provides border style", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.border).toBeDefined();
      expect(typeof theme.border).toBe("function");
      const styled = theme.border("─");
      expect(typeof styled).toBe("string");
    });

    it("degrades gracefully to plain strings when NO_COLOR is set", async () => {
      originalNoColor = process.env.NO_COLOR;
      process.env.NO_COLOR = "1";
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.heading("Title")).toBe("Title");
      expect(theme.label("Label")).toBe("Label");
      expect(theme.command("cmd")).toBe("cmd");
      expect(theme.flag("--flag")).toBe("--flag");
      expect(theme.entity("entity")).toBe("entity");
      expect(theme.path("/path")).toBe("/path");
      expect(theme.info("info")).toBe("info");
      expect(theme.border("─")).toBe("─");
    });

    it("maintains backward compatibility with existing tokens", async () => {
      const { theme } = await import("../../src/ui/theme.ts");
      expect(theme.primary).toBeDefined();
      expect(theme.accent).toBeDefined();
      expect(theme.muted).toBeDefined();
      expect(theme.success).toBeDefined();
      expect(theme.warn).toBeDefined();
      expect(theme.danger).toBeDefined();
      expect(theme.badge).toBeDefined();
    });

    it("styles known resource types with distinct colors", async () => {
      const chalkModule = await import("chalk");
      const originalLevel = chalkModule.default.level;
      chalkModule.default.level = 3;
      try {
        const { styleResourceType } = await import("../../src/ui/theme.ts");
        const ansiEscapeRegex = new RegExp(`${String.fromCharCode(27)}\\[`);
        expect(styleResourceType("skill")).toMatch(ansiEscapeRegex);
        expect(styleResourceType("rule")).toMatch(ansiEscapeRegex);
        expect(styleResourceType("skill")).not.toBe(styleResourceType("rule"));
      } finally {
        chalkModule.default.level = originalLevel;
      }
    });

    it("falls back to muted styling for unknown resource types", async () => {
      const { styleResourceType, theme } = await import("../../src/ui/theme.ts");
      expect(styleResourceType("unknown_type")).toBe(theme.muted("unknown_type"));
    });
  });
});
