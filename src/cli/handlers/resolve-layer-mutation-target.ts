import { runLayerShowWizard } from "../../services/wizards/layer-show.js";
import { resolveOrPrompt, shouldUseWizard } from "../../services/wizards/shared.js";
import { parseOutputFormat } from "../../utils/output-format.js";

export async function resolveLayerMutationTarget(input: {
  layerName?: string;
  interactive?: boolean;
  noInteractive?: boolean;
  format?: string;
  message: string;
  profileMode?: boolean;
}): Promise<string | undefined> {
  const format = parseOutputFormat(input.format);

  return resolveOrPrompt({
    value: input.layerName,
    shouldPrompt: shouldUseWizard({
      interactive: input.interactive,
      noInteractive: input.noInteractive,
      format,
      missingRequiredArgs: !input.layerName,
    }),
    prompt: async () =>
      runLayerShowWizard({ message: input.message, profileMode: input.profileMode }),
  });
}
