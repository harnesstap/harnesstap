import type { Command } from "commander";
import { getCommandHelpEntry } from "../services/cli-help-registry.js";
import { ui } from "../ui/index.js";
import { PACKAGE_VERSION } from "../version.js";
import { formatCommand, resolveInvocationName } from "./shared.js";

const LAYER_HELP_LOCAL_COMMANDS = new Set([
  "create",
  "list",
  "show",
  "edit",
  "editor",
  "delete",
  "export",
  "import",
  "apply",
  "diff",
  "doctor",
  "why",
  "from-project",
]);

const LAYER_HELP_REMOTE_COMMANDS = new Set([
  "search",
  "catalog",
  "pull",
  "publish",
]);

function isHiddenHelpCommand(command: Command): boolean {
  return (
    command.name() === "__complete"
    || (command.description() as unknown) === false
  );
}

export function resolveCommandDescription(command: Command): string {
  return command.description() || getCommandHelpEntry(command)?.description || "";
}

function isLeafHelpCommand(command: Command): boolean {
  return command.commands.every((sub) => isHiddenHelpCommand(sub));
}

function isCommandGroup(command: Command): boolean {
  return command.commands.some((sub) => !isHiddenHelpCommand(sub));
}

function renderTopLevelCommandHelp(cmd: Command): string {
  const commands = cmd.commands.filter((command) => !isHiddenHelpCommand(command));
  const groups = commands.filter(isCommandGroup);
  const direct = commands.filter((command) => !isCommandGroup(command));

  const sections = [
    renderCommandSection("COMMAND GROUPS", groups),
    renderCommandSection("PROJECT", direct),
  ].filter((section) => section.length > 0);

  return sections.join("\n\n");
}

function renderGroupedCommandHelp(cmd: Command): string {
  const commands = cmd.commands.filter((command) => !isHiddenHelpCommand(command));

  if (commands.length === 0) {
    return "";
  }

  const lines: string[] = [];

  const commandStrs = commands.map((c) => {
    const name = c.name();
    const aliases = c.aliases();
    const args = c.registeredArguments?.map((arg) => {
      if (arg.required) {
        return `<${arg.name()}>`;
      }
      return `[${arg.name()}]`;
    }).join(" ") || "";

    let fullStr = name;
    if (aliases.length) {
      fullStr += ` (${aliases.join(", ")})`;
    }
    if (args) {
      fullStr += ` ${args}`;
    }

    return fullStr;
  });

  const maxNameLength = commandStrs.length > 0 ? Math.max(...commandStrs.map((s) => s.length)) : 0;

  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const nameStr = commandStrs[i];
    if (!command || !nameStr) continue;
    const padding = " ".repeat(Math.max(2, maxNameLength - nameStr.length + 2));
    const desc = resolveCommandDescription(command);
    lines.push(`  ${ui.theme.command(nameStr)}${padding}${desc}`);
  }

  return lines.join("\n");
}

function renderCommandSection(title: string, commands: Command[]): string {
  if (commands.length === 0) {
    return "";
  }

  const commandStrs = commands.map((c) => {
    const name = c.name();
    const aliases = c.aliases();
    const args = c.registeredArguments?.map((arg) => {
      if (arg.required) {
        return `<${arg.name()}>`;
      }
      return `[${arg.name()}]`;
    }).join(" ") || "";
    let fullStr = name;
    if (aliases.length) {
      fullStr += ` (${aliases.join(", ")})`;
    }
    if (args) {
      fullStr += ` ${args}`;
    }
    return fullStr;
  });
  const maxNameLength = Math.max(...commandStrs.map((entry) => entry.length));
  const lines = [ui.theme.heading(title)];
  for (let i = 0; i < commands.length; i++) {
    const command = commands[i];
    const nameStr = commandStrs[i];
    if (!command || !nameStr) {
      continue;
    }
    const padding = " ".repeat(Math.max(2, maxNameLength - nameStr.length + 2));
    lines.push(`  ${ui.theme.command(nameStr)}${padding}${resolveCommandDescription(command)}`);
  }
  return lines.join("\n");
}

function renderLayerGroupedCommandHelp(cmd: Command): string {
  const local = cmd.commands.filter((command) =>
    LAYER_HELP_LOCAL_COMMANDS.has(command.name()),
  );
  const remote = cmd.commands.filter((command) =>
    LAYER_HELP_REMOTE_COMMANDS.has(command.name()),
  );
  return [
    renderCommandSection("LOCAL LIBRARY", local),
    "",
    renderCommandSection("REMOTE CATALOG", remote),
  ].join("\n");
}

export function configureCommandGroup(cmd: Command): Command {
  cmd.helpCommand(false);
  cmd.action(() => {
    cmd.outputHelp();
  });
  return cmd;
}

export function configureProgramHelp(program: Command): void {
  program
    .name("harnesstap")
    .description(
      "Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs",
    )
    .version(PACKAGE_VERSION, "-V, --harnesstap-version")
    .option("-v, --verbose", "Show verbose error output")
    .option("--no-color", "Disable color output")
    .option("--no-interactive", "Disable interactive prompts")
    .helpCommand(false)
    .configureOutput({
      outputError: () => {},
    })
    .hook("preAction", (command) => {
      const opts = command.optsWithGlobals<{ color?: boolean }>();
      if (opts.color === false) {
        ui.disableColor();
      }
    })
    .configureHelp({
      formatHelp: (cmd) => {
        if (process.argv.includes("--no-color")) {
          ui.disableColor();
        }

        const isTopLevel = cmd.parent === null;

        if (!isTopLevel) {
          const lines = [
            "",
            ui.theme.heading("USAGE"),
            `  ${cmd.name()} ${cmd.usage()}`,
            "",
          ];

          const description = resolveCommandDescription(cmd);
          if (description) {
            lines.push(description, "");
          }

          const args = cmd.registeredArguments?.filter((arg) => arg.description) ?? [];
          if (args.length > 0) {
            lines.push(ui.theme.heading("ARGUMENTS"));
            for (const arg of args) {
              const name = arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
              lines.push(`  ${ui.theme.flag(name)}  ${arg.description}`);
            }
            lines.push("");
          }

          const helpEntry = getCommandHelpEntry(cmd);
          if (
            isLeafHelpCommand(cmd)
            && helpEntry?.examples
            && helpEntry.examples.length > 0
          ) {
            lines.push(ui.theme.heading("EXAMPLES"));
            for (const example of helpEntry.examples) {
              lines.push(`  ${formatCommand(example)}`);
            }
            lines.push("");
          }

          const opts = cmd.options.filter((opt) => !opt.hidden);
          if (opts.length > 0) {
            lines.push(ui.theme.heading("OPTIONS"));
            for (const opt of opts) {
              const flags = opt.flags;
              const desc = opt.description || "";
              lines.push(`  ${ui.theme.flag(flags)}  ${desc}`);
            }
            lines.push("");
          }

          const subcommands = cmd.name() === "layer"
            ? renderLayerGroupedCommandHelp(cmd)
            : renderGroupedCommandHelp(cmd);
          if (subcommands) {
            if (cmd.name() !== "layer") {
              lines.push(ui.theme.heading("COMMANDS"));
            }
            lines.push(subcommands);
            lines.push("");
          }

          return lines.join("\n");
        }

        const lines = [
          "",
          `${ui.theme.primary(resolveInvocationName())} ${ui.theme.muted(`v${PACKAGE_VERSION}`)}`,
          "Agent harness configuration toolkit for Claude Code, Codex, Cursor, and other coding CLIs",
          "",
          ui.theme.heading("USAGE"),
          `  ${resolveInvocationName()} [options] [command]`,
          "",
          ui.theme.heading("OPTIONS"),
          `  ${ui.theme.flag("-V, --harnesstap-version")}  output the version number`,
          `  ${ui.theme.flag("-v, --verbose")}              show verbose error output`,
          `  ${ui.theme.flag("--no-color")}               disable color output`,
          `  ${ui.theme.flag("--no-interactive")}         disable interactive prompts`,
          `  ${ui.theme.flag("-h, --help")}               display help for command`,
          "",
          renderTopLevelCommandHelp(cmd),
          "",
        ];

        return lines.join("\n");
      },
    });
}
