import { registerConfigCommands } from "./cli/commands/config.js";
import { registerEnvironmentCommands } from "./cli/commands/environment.js";
import { registerHarnessCommands } from "./cli/commands/harness.js";
import { registerLayerCommands } from "./cli/commands/layer.js";
import { registerMigrateCommands } from "./cli/commands/migrate.js";
import { registerProfileCommands } from "./cli/commands/profile.js";
import { registerResourceCommands } from "./cli/commands/resource.js";
import {
  registerProjectCommandsAfterConfig,
  registerProjectCommandsBeforeConfig,
} from "./cli/commands/project.js";
import { program } from "./cli/program.js";
import { registerCommands } from "./cli/register-commands.js";
import { renderCliError, runHarnessdeckCli } from "./cli/runtime.js";
import { isPromptCancellationError } from "./services/wizards/shared.js";

registerEnvironmentCommands(program);
registerMigrateCommands(program);
registerResourceCommands(program);
registerProjectCommandsBeforeConfig(program);
registerConfigCommands(program);
registerProjectCommandsAfterConfig(program);
registerHarnessCommands(program);
registerProfileCommands(program);
registerLayerCommands(program);
registerCommands(program);

export { program } from "./cli/program.js";
export { runHarnessdeckCli } from "./cli/runtime.js";

if (import.meta.main) {
  try {
    await runHarnessdeckCli();
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
