import { listResources } from "../../models/resource.js";
import { PRESET_ATTACHMENT_TYPES } from "../preset-attachments.js";
import { promptForValue, resolveOrPrompt } from "./shared.js";

export interface PresetAddWizardResult {
  selector?: string;
  type?: string;
  version?: string;
}

function getDefaultType(selector: string | undefined): string {
  if (selector?.includes("@")) {
    return "plugin";
  }

  return "skill";
}

function getDefaultSelector(type: string | undefined): string | undefined {
  if (!type || type === "plugin" || type === "preset-dependency") {
    return undefined;
  }

  return listResources({ type: type as never })[0]?.name;
}

export async function runPresetAddWizard(input: {
  selector?: string;
  type?: string;
  version?: string;
  shouldPrompt: boolean;
}): Promise<PresetAddWizardResult> {
  const type = await resolveOrPrompt({
    value: input.type,
    shouldPrompt: input.shouldPrompt,
    prompt: async () =>
      promptForValue({
        message: `Attachment type (${PRESET_ATTACHMENT_TYPES.join(", ")})`,
        default: getDefaultType(input.selector),
      }),
  });

  const selector = await resolveOrPrompt({
    value: input.selector,
    shouldPrompt: input.shouldPrompt,
    prompt: async () =>
      promptForValue({
        message: type === "plugin"
          ? "Plugin reference"
          : type === "preset-dependency"
            ? "Dependency preset name"
            : "Resource name or ID",
        default: getDefaultSelector(type),
      }),
  });

  const version = await resolveOrPrompt({
    value: input.version,
    shouldPrompt:
      input.shouldPrompt && (type === "plugin" || type === "preset-dependency"),
    prompt: async () =>
      promptForValue({
        message: type === "plugin"
          ? "Plugin version constraint"
          : "Dependency version constraint",
        default: "^1.0.0",
      }),
  });

  return { selector, type, version };
}
