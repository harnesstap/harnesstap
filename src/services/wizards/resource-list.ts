import type { ResourceType } from "../../types.js";
import { listResources } from "../../models/resource.js";
import {
  sortResourcesByUpdatedAt,
  toResourceListRows,
} from "../../ui/resource-list-render.js";
import { promptForInteractiveResourceList } from "./interactive-resource-list.js";

export async function runResourceListWizard(input?: {
  type?: ResourceType;
  search?: string;
  showId?: boolean;
}): Promise<string | undefined> {
  const resources = sortResourcesByUpdatedAt(
    toResourceListRows(
      listResources(input?.type ? { type: input.type } : undefined),
    ),
  );
  if (resources.length === 0) {
    return input?.search;
  }

  const query = await promptForInteractiveResourceList({
    message: "Filter resources",
    resources,
    typeFilter: input?.type,
    showId: input?.showId,
    initialQuery: input?.search,
  });

  return query.length > 0 ? query : undefined;
}
