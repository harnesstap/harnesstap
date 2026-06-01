import { listLayers } from "../../models/layer.js";
import { promptForChoice, promptForValue } from "./shared.js";

export async function runLayerDeleteWizard(): Promise<string> {
  const layers = listLayers();
  if (layers.length > 0) {
    return promptForChoice({
      message: "Which layer do you want to delete?",
      choices: layers.map((layer) => ({
        name: `${layer.name}@${layer.version}`,
        value: `${layer.name}@${layer.version}`,
      })),
    });
  }

  return promptForValue({
    message: "Layer name or ID to delete",
  });
}
