import { promptForValue } from "./shared.js";

export async function runPluginFromProjectWizard(): Promise<string> {
  return promptForValue({
    message: "New plugin name",
  });
}
