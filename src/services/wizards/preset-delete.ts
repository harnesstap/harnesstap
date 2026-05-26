import { listPresets } from "../../models/preset.js";
import { promptForValue } from "./shared.js";

export async function runPresetDeleteWizard(): Promise<string> {
  return promptForValue({
    message: "Preset name or ID to delete",
    default: listPresets()[0]?.name,
  });
}
