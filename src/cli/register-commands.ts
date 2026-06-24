import type { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerHelpCommands } from "./commands/help.js";
import { registerInitCommands } from "./commands/init.js";

/**
 * Registers auth, help, and init command groups.
 * Other groups register from `src/index.ts` via their own modules.
 */
export function registerCommands(program: Command): void {
  registerAuthCommands(program);
  registerHelpCommands(program);
  registerInitCommands(program);
}
