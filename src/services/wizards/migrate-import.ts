import {
  detectImportScopeFromFile,
  type MigrateScope,
} from "../migrate-scope.js";
import { promptForValue } from "./shared.js";

export async function runMigrateImportWizard(): Promise<{
  file: string;
  scope: MigrateScope;
}> {
  const file = await promptForValue({ message: "Import file path" });
  const scope = detectImportScopeFromFile(file);
  return { file, scope };
}
