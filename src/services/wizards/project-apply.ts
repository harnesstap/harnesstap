import { toLayerChoices } from "../completion/choices.js";
import { promptForSearchableChoice, promptForValue } from "./shared.js";

export async function runProjectApplyWizard(): Promise<string> {
  const choices = toLayerChoices();
  if (choices.length > 0) {
    return promptForSearchableChoice({
      message: "Which layer should be applied?",
      choices,
    });
  }

  return promptForValue({
    message: "Layer name, layer export path, or URL",
  });
}
