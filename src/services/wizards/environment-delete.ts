import { listEnvironments } from "../../models/environment.js";
import { promptForSearchableChoice, promptForValue } from "./shared.js";

function filterEnvironmentsBySearch<T extends {
  name: string;
  description?: string;
  id: string;
}>(environments: T[], search?: string): T[] {
  const normalizedSearch = search?.trim().toLowerCase();
  if (!normalizedSearch) {
    return environments;
  }

  return environments.filter((environment) =>
    `${environment.name} ${environment.description ?? ""} ${environment.id}`
      .toLowerCase()
      .includes(normalizedSearch),
  );
}

export async function runEnvironmentDeleteWizard(input?: {
  search?: string;
}): Promise<string | undefined> {
  const environments = filterEnvironmentsBySearch(listEnvironments(), input?.search);
  if (environments.length > 0) {
    return promptForSearchableChoice({
      message: "Which environment do you want to delete?",
      choices: environments.map((environment) => ({
        name: environment.name,
        value: environment.name,
      })),
    });
  }

  const selector = await promptForValue({
    message: "Environment name or ID to delete",
    default: input?.search,
  });
  return selector.length > 0 ? selector : undefined;
}
