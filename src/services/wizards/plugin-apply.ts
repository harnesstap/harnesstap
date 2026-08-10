import { toPluginChoices } from "../completion/choices.js";
import { promptForSearchableChoice, promptForValue } from "./shared.js";

export async function runPluginApplyWizard(): Promise<string> {
  const choices = toPluginChoices();
  if (choices.length > 0) {
    return promptForSearchableChoice({
      message: "Which plugin should be applied?",
      choices,
    });
  }

  return promptForValue({
    message: "Plugin name, plugin export path, or URL",
  });
}
