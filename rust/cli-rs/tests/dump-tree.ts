// Dumps the commander tree of the original CLI for `cli-rs` (`data/tree.json`):
// every command each lazy loader registers, with what `parseOptions` and
// `_parseCommand` read, the suggestion candidates commander would build, and the
// help text (no colors). Run: NO_COLOR=1 bun rust/cli-rs/tests/dump-tree.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Command, type Option } from "commander";
import { COMMAND_LOADER_IDS, COMMAND_CATALOG, topLevelCommandTokens } from "../../../src/cli/command-catalog.ts";
import { loadCommandModule } from "../../../src/cli/command-loaders.ts";
import { configureProgramHelp, renderRootHelpText } from "../../../src/cli/help.ts";
import { resolveInvocationName } from "../../../src/cli/shared.ts";
import { PACKAGE_VERSION } from "../../../src/version.ts";

if (!process.env.NO_COLOR) throw new Error("run with NO_COLOR=1");

// biome-ignore lint/suspicious/noExplicitAny: commander private fields
type Any = any;

// Keep each action's own function: a command group's is `configureCommandGroup`'s
// `() => { cmd.outputHelp(); }` (src/cli/help.ts).
const action = Command.prototype.action;
Command.prototype.action = function (this: Any, fn: Any) {
  this.__actionSource = String(fn).replace(/\s/g, "");
  return action.call(this, fn);
};

function option(o: Option) {
  const x = o as Any;
  return {
    flags: o.flags,
    short: o.short ?? null,
    long: o.long ?? null,
    required: o.required,
    optional: o.optional,
    variadic: o.variadic,
    negate: o.negate,
    mandatory: o.mandatory,
    hidden: o.hidden,
    choices: x.argChoices ?? null,
    custom_parser: x.parseArg !== undefined && x.argChoices === undefined,
    env_var: o.envVar ?? null,
    conflicts: (x.conflictsWith ?? []).length > 0,
    implied: x.implied !== undefined,
    preset: x.presetArg !== undefined,
  };
}

function node(cmd: Command): unknown {
  const c = cmd as Any;
  const help = cmd.createHelp();
  const helpOption = c._getHelpOption();
  const helpCommand = c._getHelpCommand();
  const parent = cmd.parent as Any;
  const silenced = String(c._outputConfiguration.outputError).replace(/\s/g, "") === "()=>{}";
  return {
    name: cmd.name(),
    aliases: cmd.aliases(),
    has_action: Boolean(c._actionHandler),
    // configureCommandGroup: the action prints this command's help
    group_help_action: Boolean(c._actionHandler) && c.__actionSource === "()=>{cmd.outputHelp();}",
    allow_unknown_option: Boolean(c._allowUnknownOption),
    allow_excess_arguments: Boolean(c._allowExcessArguments),
    positional_options: Boolean(c._enablePositionalOptions),
    pass_through: Boolean(c._passThroughOptions),
    combine_flag_and_optional_value: Boolean(c._combineFlagAndOptionalValue),
    default_command: c._defaultCommandName ?? null,
    help_option: helpOption ? { short: helpOption.short ?? null, long: helpOption.long ?? null } : null,
    help_command: helpCommand ? helpCommand.name() : null,
    exit_override: Boolean(c._exitCallback),
    output_error_silenced: silenced,
    show_help_after_error: Boolean(c._showHelpAfterError),
    // anything we do not reproduce: the Rust side hands the run back to the original
    unsupported:
      Boolean(c._executableHandler)
      || c.listenerCount("command:*") > 0
      || (parent?.listenerCount(`command:${cmd.name()}`) ?? 0) > 0
      || ["beforeHelp", "afterHelp", "beforeAllHelp", "afterAllHelp"].some((e) => c.listenerCount(e) > 0)
      || (c._lifeCycleHooks?.preSubcommand?.length ?? 0) > 0,
    options: cmd.options.map(option),
    arguments: (c.registeredArguments as Any[]).map((a) => ({
      name: a.name(),
      required: a.required,
      variadic: a.variadic,
      choices: a.argChoices ?? null,
      custom_parser: a.parseArg !== undefined && a.argChoices === undefined,
    })),
    suggest_commands: help.visibleCommands(cmd).flatMap((s: Command) => (s.alias() ? [s.name(), s.alias()] : [s.name()])),
    suggest_options: (help.visibleOptions(cmd) as Option[]).filter((o) => o.long).map((o) => o.long),
    help: cmd.helpInformation(),
    commands: cmd.commands.map(node),
  };
}

function freshRoot(): Command {
  const root = new Command();
  root.exitOverride();
  configureProgramHelp(root);
  return root;
}

const loaders: Record<string, unknown> = {};
for (const id of COMMAND_LOADER_IDS) {
  const root = freshRoot();
  await loadCommandModule(root, id);
  loaders[id] = (node(root) as { commands: unknown }).commands;
}

const name = resolveInvocationName();
const rootHelp = renderRootHelpText().split("\n");
if (rootHelp[1] !== `${name} v${PACKAGE_VERSION}` || rootHelp[5] !== `  ${name} [options] [command]`) {
  throw new Error("root help layout changed");
}
rootHelp[1] = "{name} v{version}";
rootHelp[5] = "  {name} [options] [command]";

const tree = {
  root: node(freshRoot()),
  root_help: rootHelp.join("\n"),
  catalog: COMMAND_CATALOG.map((e) => ({ name: e.name, aliases: e.aliases ?? [], loader: e.loader })),
  top_level_tokens: [...topLevelCommandTokens()],
  loaders,
};
writeFileSync(join(import.meta.dir, "..", "data", "tree.json"), `${JSON.stringify(tree, null, 1)}\n`);
console.log(`${Object.keys(loaders).length} loaders`);
