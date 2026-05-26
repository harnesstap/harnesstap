import { listPresets } from "../../models/preset.js";
import { promptForValue } from "./shared.js";

export async function runProjectApplyWizard(): Promise<string> {
  return promptForValue({
    message: "Preset name, bundle path, or URL",
    default: listPresets()[0]?.name,
  });
}
