import { listEnvironmentsCommand } from "../environment-commands.js";
import {
  filterEnvironmentsBySearch,
  type EnvironmentListRow,
} from "../../ui/environment-list-render.js";
import {
  promptForInteractiveEnvironmentList,
  type InteractiveEnvironmentListResult,
} from "./interactive-environment-list.js";

export type EnvironmentListWizardResult = InteractiveEnvironmentListResult;

export async function runEnvironmentListWizard(input?: {
  search?: string;
}): Promise<EnvironmentListWizardResult | undefined> {
  const environments = listEnvironmentsCommand();
  if (environments.length === 0) {
    return input?.search ? { action: "filter", query: input.search } : undefined;
  }

  return promptForInteractiveEnvironmentList({
    message: "Filter environments",
    environments,
    initialQuery: input?.search,
  });
}

export function filterEnvironmentListRows(
  rows: EnvironmentListRow[],
  search?: string,
): EnvironmentListRow[] {
  if (!search) {
    return rows;
  }
  return filterEnvironmentsBySearch(rows, search);
}
