import { listPresets } from "../../models/preset.js";
import { promptForChoice, promptForValue } from "./shared.js";

export async function runProjectApplyWizard(): Promise<string> {
  const presets = listPresets();
  if (presets.length > 0) {
    return promptForChoice({
      message: "Which preset should be applied?",
      choices: presets.map((preset) => ({
        name: `${preset.name}@${preset.version}`,
        value: preset.name,
      })),
    });
  }

  return promptForValue({
    message: "Preset name, bundle path, or URL",
  });
}
