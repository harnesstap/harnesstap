import { promptForValue } from "./shared.js";

export async function runPresetFromProjectWizard(): Promise<string> {
  return promptForValue({
    message: "New preset name",
  });
}
