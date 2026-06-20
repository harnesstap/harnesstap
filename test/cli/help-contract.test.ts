import { describe, expect, it } from "bun:test";
import type { Command } from "commander";
import {
  COMMAND_HELP_REGISTRY,
  getCommandHelpEntry,
  resolveCommandHelpPath,
} from "../../src/services/cli-help-registry.ts";

function isHiddenHelpCommand(command: Command): boolean {
  return (
    command.name() === "__complete"
    || (command.description() as unknown) === false
  );
}

function isLeafCommand(command: Command): boolean {
  return command.commands.every((sub) => isHiddenHelpCommand(sub));
}

function walkLeafCommands(root: Command): Command[] {
  const leaves: Command[] = [];

  function visit(command: Command): void {
    if (command.parent === null) {
      for (const child of command.commands) {
        visit(child);
      }
      return;
    }

    if (isHiddenHelpCommand(command)) {
      return;
    }

    if (isLeafCommand(command)) {
      leaves.push(command);
      return;
    }

    for (const child of command.commands) {
      visit(child);
    }
  }

  visit(root);
  return leaves;
}

function resolveCommandDescription(command: Command): string {
  return command.description() || getCommandHelpEntry(command)?.description || "";
}

function usesDisallowedHShorthand(flags: string): boolean {
  return /(?:^|\s)-h,/.test(flags) && !flags.includes("--help");
}

describe("CLI help contract", () => {
  it("registry keys match every leaf command path", async () => {
    const { program } = await import("../../src/index.ts");
    const leafPaths = walkLeafCommands(program)
      .map((command) => resolveCommandHelpPath(command))
      .sort();
    const registryPaths = Object.keys(COMMAND_HELP_REGISTRY).sort();

    expect(registryPaths).toEqual(leafPaths);
  });

  it("every leaf command has a non-empty description", async () => {
    const { program } = await import("../../src/index.ts");
    const missing: string[] = [];

    for (const command of walkLeafCommands(program)) {
      const path = resolveCommandHelpPath(command);
      if (!resolveCommandDescription(command).trim()) {
        missing.push(path);
      }
    }

    expect(missing).toEqual([]);
  });

  it("every leaf command has at least one registry example", async () => {
    const { program } = await import("../../src/index.ts");
    const missing: string[] = [];

    for (const command of walkLeafCommands(program)) {
      const path = resolveCommandHelpPath(command);
      const examples = getCommandHelpEntry(command)?.examples ?? [];
      if (examples.length === 0) {
        missing.push(path);
      }
    }

    expect(missing).toEqual([]);
  });

  it("no option uses -h shorthand except built-in help", async () => {
    const { program } = await import("../../src/index.ts");
    const violations: string[] = [];

    function visit(command: Command): void {
      if (isHiddenHelpCommand(command)) {
        return;
      }

      for (const option of command.options) {
        if (option.hidden) {
          continue;
        }
        if (usesDisallowedHShorthand(option.flags)) {
          violations.push(
            `${resolveCommandHelpPath(command) || command.name()}: ${option.flags}`,
          );
        }
      }

      for (const child of command.commands) {
        visit(child);
      }
    }

    visit(program);
    expect(violations).toEqual([]);
  });

  it("required arguments have descriptions", async () => {
    const { program } = await import("../../src/index.ts");
    const missing: string[] = [];

    function visit(command: Command): void {
      if (isHiddenHelpCommand(command)) {
        return;
      }

      const path = resolveCommandHelpPath(command);
      for (const arg of command.registeredArguments ?? []) {
        if (arg.required && !arg.description?.trim()) {
          missing.push(`${path}: <${arg.name()}>`);
        }
      }

      for (const child of command.commands) {
        visit(child);
      }
    }

    visit(program);
    expect(missing).toEqual([]);
  });
});
