import { listLayers } from "../../models/layer.js";
import { promptForChoice, promptForValue } from "./shared.js";

export async function runProjectApplyWizard(): Promise<string> {
  const layers = listLayers();
  if (layers.length > 0) {
    return promptForChoice({
      message: "Which layer should be applied?",
      choices: layers.map((layer) => ({
        name: `${layer.name}@${layer.version}`,
        value: layer.name,
      })),
    });
  }

  return promptForValue({
    message: "Layer name, bundle path, or URL",
  });
}
