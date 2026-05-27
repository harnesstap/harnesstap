import { listPresets } from "../../models/preset.js";
import { promptForChoice, promptForValue } from "./shared.js";

export async function runPresetDeleteWizard(): Promise<string> {
  const presets = listPresets();
  if (presets.length > 0) {
    return promptForChoice({
      message: "Which preset do you want to delete?",
      choices: presets.map((preset) => ({
        name: `${preset.name}@${preset.version}`,
        value: `${preset.name}@${preset.version}`,
      })),
    });
  }

  return promptForValue({
    message: "Preset name or ID to delete",
  });
}
