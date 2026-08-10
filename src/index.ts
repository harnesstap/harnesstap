import {
  registerAgentCommands,
  registerUiDebugCommand,
} from "./cli/commands/agent.js";
import { registerConfigCommands } from "./cli/commands/config.js";
import { registerEnvironmentCommands } from "./cli/commands/environment.js";
import { registerHarnessCommands } from "./cli/commands/harness.js";
import { registerMarketplaceCommands } from "./cli/commands/marketplace.js";
import { registerApplyCommand } from "./cli/commands/apply.js";
import {
  registerDeprecatedLayerAlias,
  registerPluginCommands,
} from "./cli/commands/plugin.js";
import { registerMigrateCommands } from "./cli/commands/migrate.js";
import { registerProfileCommands } from "./cli/commands/profile.js";
import { registerResourceCommands } from "./cli/commands/resource.js";
import {
  registerProjectCommandsAfterConfig,
  registerProjectCommandsBeforeConfig,
} from "./cli/commands/project.js";
import { program } from "./cli/program.js";
import { registerCommands } from "./cli/register-commands.js";
import { renderCliError, runHarnesstapCli } from "./cli/runtime.js";
import { isPromptCancellationError } from "./services/wizards/shared.js";

registerEnvironmentCommands(program);
registerAgentCommands(program);
registerUiDebugCommand(program);
registerMigrateCommands(program);
registerResourceCommands(program);
registerProjectCommandsBeforeConfig(program);
registerConfigCommands(program);
registerProjectCommandsAfterConfig(program);
registerHarnessCommands(program);
registerProfileCommands(program);
registerPluginCommands(program);
registerDeprecatedLayerAlias(program);
registerMarketplaceCommands(program);
registerApplyCommand(program);
registerCommands(program);

export { program } from "./cli/program.js";
export { runHarnesstapCli } from "./cli/runtime.js";

if (import.meta.main) {
  try {
    await runHarnesstapCli();
  } catch (error) {
    if (isPromptCancellationError(error)) {
      process.exitCode = 0;
    } else {
      process.exitCode =
        error && typeof error === "object" && "exitCode" in error
          ? Number((error as { exitCode?: unknown }).exitCode) || 1
          : 1;
      renderCliError(error);
    }
  }
}
