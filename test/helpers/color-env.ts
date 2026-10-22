import { afterEach, beforeEach } from "bun:test";
import chalk from "chalk";

/**
 * Restore NO_COLOR and chalk.level after each test in the calling describe.
 * Both are process-wide, so a test that calls disableColor() would otherwise
 * turn color off for every test file that runs after it.
 */
export function restoreColorEnvAfterEach(): void {
  let noColor: string | undefined;
  let level: typeof chalk.level;
  beforeEach(() => {
    noColor = process.env.NO_COLOR;
    level = chalk.level;
  });
  afterEach(() => {
    if (noColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = noColor;
    chalk.level = level;
  });
}
