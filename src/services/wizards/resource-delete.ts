import { listResources } from "../../models/resource.js";
import { promptForChoice, promptForValue } from "./shared.js";

export async function runResourceDeleteWizard(): Promise<string> {
  const resources = listResources();
  if (resources.length > 0) {
    return promptForChoice({
      message: "Which resource do you want to delete?",
      choices: resources.map((resource) => ({
        name: `${resource.type} ${resource.name} (${resource.id})`,
        value: resource.id,
      })),
    });
  }

  return promptForValue({
    message: "Resource name or ID to delete",
  });
}
