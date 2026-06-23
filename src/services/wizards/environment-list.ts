import { listEnvironmentsCommand } from "../environment-commands.js";
import {
  filterEnvironmentsBySearch,
  type EnvironmentListRow,
} from "../../ui/environment-list-render.js";
import { promptForInteractiveEnvironmentList } from "./interactive-environment-list.js";

export type EnvironmentListWizardResult = {
  search?: string;
};

export async function runEnvironmentListWizard(input?: {
  search?: string;
}): Promise<EnvironmentListWizardResult | undefined> {
  const environments = listEnvironmentsCommand();
  if (environments.length === 0) {
    return input?.search ? { search: input.search } : undefined;
  }

  const result = await promptForInteractiveEnvironmentList({
    message: "Filter environments",
    environments,
    initialQuery: input?.search,
  });

  return {
    search: result.query.length > 0 ? result.query : undefined,
  };
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
