import { listResources } from "../../models/resource.js";
import { promptForValue } from "./shared.js";

export async function runResourceDeleteWizard(): Promise<string> {
  return promptForValue({
    message: "Resource name or ID to delete",
    default: listResources()[0]?.name,
  });
}
