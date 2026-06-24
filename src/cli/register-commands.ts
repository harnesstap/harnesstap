import type { Command } from "commander";
import { registerAuthCommands } from "./commands/auth.js";

/**
 * Registers top-level command groups on the CLI program.
 * Additional groups are migrated from `src/index.ts` incrementally — see
 * `docs/internal/cli-split-plan.md`.
 */
export function registerCommands(program: Command): void {
  registerAuthCommands(program);
}
