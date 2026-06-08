import type { ResourceType } from "../../types.js";
import { listResources } from "../../models/resource.js";
import {
  sortResourcesByUpdatedAt,
  toResourceListRows,
} from "../../ui/resource-list-render.js";
import { promptForInteractiveResourceList } from "./interactive-resource-list.js";

export type ResourceListWizardResult = {
  search?: string;
};

export async function runResourceListWizard(input?: {
  type?: ResourceType;
  search?: string;
  showId?: boolean;
  showAll?: boolean;
}): Promise<ResourceListWizardResult | undefined> {
  const resources = sortResourcesByUpdatedAt(
    toResourceListRows(
      listResources(input?.type ? { type: input.type } : undefined),
    ),
  );
  if (resources.length === 0) {
    return input?.search ? { search: input.search } : undefined;
  }

  const result = await promptForInteractiveResourceList({
    message: "Filter resources",
    resources,
    typeFilter: input?.type,
    showId: input?.showId,
    showAll: input?.showAll,
    initialQuery: input?.search,
  });

  return {
    search: result.query.length > 0 ? result.query : undefined,
  };
}
