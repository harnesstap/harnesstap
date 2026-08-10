import { runPluginShowWizard } from "../../services/wizards/plugin-show.js";
import { resolveOrPrompt, shouldUseWizard } from "../../services/wizards/shared.js";
import { parseOutputFormat } from "../../utils/output-format.js";

export async function resolvePluginMutationTarget(input: {
  pluginName?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
  message: string;
  profileMode?: boolean;
}): Promise<string | undefined> {
  const format = parseOutputFormat(input.format);

  return resolveOrPrompt({
    value: input.pluginName,
    shouldPrompt: shouldUseWizard({
      interactive: input.interactive,
      noInteractive: input.noInteractive,
      format,
      missingRequiredArgs: !input.pluginName,
    }),
    prompt: async () =>
      runPluginShowWizard({ message: input.message, profileMode: input.profileMode }),
  });
}
