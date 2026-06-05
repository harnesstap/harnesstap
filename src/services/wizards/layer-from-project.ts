import { promptForValue } from "./shared.js";

export async function runLayerFromProjectWizard(): Promise<string> {
  return promptForValue({
    message: "New layer name",
  });
}
