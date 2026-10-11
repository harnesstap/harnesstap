import type { Command } from "commander";
import {
  COMMAND_LOADER_IDS,
  type CommandLoaderId,
  findCatalogEntry,
} from "./command-catalog.js";
import { positionalArgvTokens } from "./root-flags.js";

const loadedLoaders = new Set<CommandLoaderId>();

async function importLoader(
  id: CommandLoaderId,
): Promise<(root: Command) => void> {
  switch (id) {
    case "apply": {
      const mod = await import("./commands/apply.js");
      return (root) => {
        mod.registerApplyCommand(root);
        mod.registerInstallCommand(root);
      };
    }
    case "approve": {
      const mod = await import("./commands/approve.js");
      return (root) => {
        mod.registerApproveCommand(root);
        mod.registerDenyCommand(root);
      };
    }
    case "audit": {
      const mod = await import("./commands/audit.js");
      return (root) => {
        mod.registerAuditCommand(root);
      };
    }
    case "auth": {
      const mod = await import("./commands/auth.js");
      return (root) => {
        mod.registerAuthCommands(root);
      };
    }
    case "compile": {
      const mod = await import("./commands/compile.js");
      return (root) => {
        mod.registerCompileCommand(root);
        mod.registerTargetsCommand(root);
      };
    }
    case "config": {
      const mod = await import("./commands/config.js");
      return (root) => {
        mod.registerConfigCommands(root);
      };
    }
    case "environment": {
      const mod = await import("./commands/environment.js");
      return (root) => {
        mod.registerEnvironmentCommands(root);
      };
    }
    case "github": {
      const mod = await import("./commands/github.js");
      return (root) => {
        mod.registerGithubCommands(root);
      };
    }
    case "harness": {
      const mod = await import("./commands/harness.js");
      return (root) => {
        mod.registerHarnessCommands(root);
      };
    }
    case "help": {
      const mod = await import("./commands/help.js");
      return (root) => {
        mod.registerHelpCommands(root);
      };
    }
    case "init": {
      const mod = await import("./commands/init.js");
      return (root) => {
        mod.registerInitCommands(root);
      };
    }
    case "lock": {
      const mod = await import("./commands/lock.js");
      return (root) => {
        mod.registerLockCommands(root);
      };
    }
    case "marketplace": {
      const mod = await import("./commands/marketplace.js");
      return (root) => {
        mod.registerMarketplaceCommands(root);
      };
    }
    case "mcp": {
      const mod = await import("./commands/mcp.js");
      return (root) => {
        mod.registerMcpCommands(root);
      };
    }
    case "migrate": {
      const mod = await import("./commands/migrate.js");
      return (root) => {
        mod.registerMigrateCommands(root);
      };
    }
    case "open": {
      const mod = await import("./commands/open.js");
      return (root) => {
        mod.registerOpenCommand(root);
      };
    }
    case "pack": {
      const mod = await import("./commands/pack.js");
      return (root) => {
        mod.registerPackCommand(root);
      };
    }
    case "plugin": {
      const mod = await import("./commands/plugin.js");
      return (root) => {
        mod.registerPluginCommands(root);
        mod.registerDeprecatedLayerAlias(root);
      };
    }
    case "policy": {
      const mod = await import("./commands/policy.js");
      return (root) => {
        mod.registerPolicyCommands(root);
      };
    }
    case "profile": {
      const mod = await import("./commands/profile.js");
      return (root) => {
        mod.registerProfileCommands(root);
      };
    }
    case "project": {
      const mod = await import("./commands/project.js");
      return (root) => {
        mod.registerProjectCommandsBeforeConfig(root);
        mod.registerProjectCommandsAfterConfig(root);
      };
    }
    case "resource": {
      const mod = await import("./commands/resource.js");
      return (root) => {
        mod.registerResourceCommands(root);
      };
    }
    default: {
      const exhaustive: never = id;
      throw new Error(`Unknown command loader: ${String(exhaustive)}`);
    }
  }
}

export async function loadCommandModule(
  root: Command,
  id: CommandLoaderId,
): Promise<void> {
  if (loadedLoaders.has(id)) {
    return;
  }
  const register = await importLoader(id);
  register(root);
  loadedLoaders.add(id);
}

export async function loadAllCommandModules(root: Command): Promise<void> {
  for (const id of COMMAND_LOADER_IDS) {
    await loadCommandModule(root, id);
  }
}

export async function ensureCommandsForArgv(
  root: Command,
  argv: string[],
): Promise<void> {
  const positionals = positionalArgvTokens(argv);
  const first = positionals[0];
  if (!first) {
    return;
  }
  if (first === "__complete" || (first === "init" && positionals[1] === "completion")) {
    await loadAllCommandModules(root);
    return;
  }
  const entry = findCatalogEntry(first);
  if (!entry) {
    return;
  }
  await loadCommandModule(root, entry.loader);
}
