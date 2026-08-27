import { describe, expect, it, afterEach } from "bun:test";
import chalk from "chalk";
import { disableColor } from "../../src/ui/theme.ts";
import { formatVersionWithDrift } from "../../src/ui/version-render.ts";

describe("formatVersionWithDrift", () => {
  afterEach(() => {
    disableColor();
  });

  it("colors matching versions green", () => {
    chalk.level = 1;
    delete process.env.NO_COLOR;
    const result = formatVersionWithDrift("1.2.3", "1.2.3");
    expect(result).toBe(chalk.hex("#14b8a6")("1.2.3"));
  });

  it("colors divergent semver segments after the first mismatch", () => {
    chalk.level = 1;
    delete process.env.NO_COLOR;
    const result = formatVersionWithDrift("1.0.1", "1.2.3");
    expect(result).toBe(
      `${chalk.hex("#14b8a6")("1")}.${chalk.hex("#ef4444")("0")}.${chalk.hex("#ef4444")("1")}`,
    );
  });

  it("keeps prefix segments green when only patch differs", () => {
    chalk.level = 1;
    delete process.env.NO_COLOR;
    const result = formatVersionWithDrift("1.2.0", "1.2.3");
    expect(result).toBe(
      `${chalk.hex("#14b8a6")("1")}.${chalk.hex("#14b8a6")("2")}.${chalk.hex("#ef4444")("0")}`,
    );
  });

  it("shows latest version unchanged when no latest is available", () => {
    disableColor();
    expect(formatVersionWithDrift("1.0.0", null)).toBe("1.0.0");
  });
});
