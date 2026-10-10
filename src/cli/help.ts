import { Option, type Command } from "commander";
import { getCommandHelpEntry } from "../services/cli-help-registry.js";
import { ui } from "../ui/index.js";
import { PACKAGE_VERSION } from "../version.js";
import { formatCommand, resolveInvocationName } from "./shared.js";

const PLUGIN_HELP_LOCAL_COMMANDS = new Set([
  "create",
  "list",
  "show",
  "edit",
  "editor",
  "delete",
  "export",
  "import",
  "add",
  "cut",
  "versions",
  "rollback",
  "diff",
  "doctor",
  "check",
  "update",
  "why",
  "fork",
  "from-project",
]);

const PLUGIN_HELP_REMOTE_COMMANDS = new Set([
  "search",
  "catalog",
  "pull",
  "publish",
]);

function isCommanderHidden(command: Command): boolean {
  return (command as unknown as { _hidden?: boolean })._hidden === true;
}

export function isHiddenHelpCommand(command: Command): boolean {
  return (
    command.name() === "__complete"
    || isCommanderHidden(command)
    || (command.description() as unknown) === false
  );
}

export function resolveCommandDescription(command: Command): string {
  return command.description() || getCommandHelpEntry(command)?.description || "";
}

/** Commands that run a default action while also hosting subcommands. */
export function commandKeepsDefaultAction(command: Command): boolean {
  return command.name() === "init";
}

function commandUsageLine(cmd: Command): string {
  const names: string[] = [];
  let current: Command | null = cmd;
  while (current?.parent) {
    names.unshift(current.name());
    current = current.parent;
  }
  const usage = cmd.usage().trim();
  return formatCommand(`${names.join(" ")}${usage ? ` ${usage}` : ""}`);
}

function formatHelpArgName(name: string, required: boolean): string {
  return required ? `<${name}>` : `[${name}]`;
}

function visibleHelpOptions(cmd: Command): Command["options"] {
  const opts = cmd.options.filter((opt) => !opt.hidden);
  const hasNoInteractive = opts.some((opt) => opt.long === "--no-interactive");
  if (!hasNoInteractive) {
    return opts;
  }
  return opts.filter((opt) => opt.long !== "--interactive");
}

function isCommandGroup(command: Command): boolean {
  // `init` keeps a default action (`ht init`) while hosting `init completion`.
  // Keep it under PROJECT rather than COMMAND GROUPS.
  if (commandKeepsDefaultAction(command)) {
    return false;
  }
  return command.commands.some((sub) => !isHiddenHelpCommand(sub));
}

function byCommandName(a: Command, b: Command): number {
  return a.name().localeCompare(b.name());
}

function renderTopLevelCommandHelp(cmd: Command): string {
  const commands = cmd.commands.filter((command) => !isHiddenHelpCommand(command));
  const groups = commands.filter(isCommandGroup).sort(byCommandName);
  const direct = commands.filter((command) => !isCommandGroup(command)).sort(byCommandName);

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

function renderPluginGroupedCommandHelp(cmd: Command): string {
  const local = cmd.commands.filter((command) =>
    PLUGIN_HELP_LOCAL_COMMANDS.has(command.name()),
  );
  const remote = cmd.commands.filter((command) =>
    PLUGIN_HELP_REMOTE_COMMANDS.has(command.name()),
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
    .version(PACKAGE_VERSION, "-V, --version")
    .addOption(new Option("--harnesstap-version").hideHelp())
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
          const helpEntry = getCommandHelpEntry(cmd);
          const lines = [
            "",
            ui.theme.heading("USAGE"),
            `  ${commandUsageLine(cmd)}`,
            "",
          ];

          const description = resolveCommandDescription(cmd);
          if (description) {
            lines.push(description, "");
          }

          if (helpEntry?.details?.trim()) {
            lines.push(helpEntry.details.trim(), "");
          }

          const args = cmd.registeredArguments?.filter((arg) => arg.description) ?? [];
          if (args.length > 0) {
            lines.push(ui.theme.heading("ARGUMENTS"));
            const requiredOffTty = new Set(helpEntry?.requiredOffTtyArgs ?? []);
            const argNames = args.map((arg) =>
              formatHelpArgName(arg.name(), arg.required || requiredOffTty.has(arg.name())),
            );
            const maxArgLength = Math.max(...argNames.map((name) => name.length));
            for (let i = 0; i < args.length; i++) {
              const arg = args[i];
              const name = argNames[i];
              if (!arg || !name) continue;
              const padding = " ".repeat(Math.max(2, maxArgLength - name.length + 2));
              lines.push(`  ${ui.theme.flag(name)}${padding}${arg.description}`);
            }
            lines.push("");
          }

          if (helpEntry?.examples && helpEntry.examples.length > 0) {
            lines.push(ui.theme.heading("EXAMPLES"));
            for (const example of helpEntry.examples) {
              lines.push(`  ${formatCommand(example)}`);
            }
            lines.push("");
          }

          const opts = visibleHelpOptions(cmd);
          if (opts.length > 0) {
            lines.push(ui.theme.heading("OPTIONS"));
            const flagStrs = opts.map((opt) => opt.flags);
            const maxFlagLength = Math.max(...flagStrs.map((flags) => flags.length));
            for (let i = 0; i < opts.length; i++) {
              const opt = opts[i];
              const flags = flagStrs[i];
              if (!opt || !flags) continue;
              const padding = " ".repeat(Math.max(2, maxFlagLength - flags.length + 2));
              lines.push(`  ${ui.theme.flag(flags)}${padding}${opt.description || ""}`);
            }
            lines.push("");
          }

          const subcommands = cmd.name() === "plugin"
            ? renderPluginGroupedCommandHelp(cmd)
            : renderGroupedCommandHelp(cmd);
          if (subcommands) {
            if (cmd.name() !== "plugin") {
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
          `  ${ui.theme.flag("-V, --version")}            output the version number`,
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
