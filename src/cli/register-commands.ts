import type { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";
import { registerGithubCommands } from "./commands/github.js";
import { registerHelpCommands } from "./commands/help.js";
import { registerInitCommands } from "./commands/init.js";

/**
 * Registers auth, github, help, and init command groups.
 * Other groups register from `src/index.ts` via their own modules.
 */
export function registerCommands(program: Command): void {
  registerAuthCommands(program);
  registerGithubCommands(program);
  registerHelpCommands(program);
  registerInitCommands(program);
}
