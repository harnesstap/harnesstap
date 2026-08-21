import { tryHandle as tryEnvironments } from "./parity-handlers/environments.js";
import { tryHandle as tryApply } from "./parity-handlers/apply.js";
import { tryHandle as tryImport } from "./parity-handlers/import.js";
import { tryHandle as tryProfileDelete } from "./parity-handlers/profile-delete.js";
import { tryHandle as tryPublish } from "./parity-handlers/publish.js";
import { tryHandle as tryResourceMutate } from "./parity-handlers/resource-mutate.js";
import { tryHandle as tryMarketplaceRemove } from "./parity-handlers/marketplace-remove.js";
import { tryHandle as tryMarketplaceUpdate } from "./parity-handlers/marketplace-update.js";
import { tryHandle as tryMarketplaceTree } from "./parity-handlers/marketplace-tree.js";
import { tryHandle as tryCatalogScope } from "./parity-handlers/catalog-scope.js";
import { tryHandle as tryCloudOrgs } from "./parity-handlers/cloud-orgs.js";
import { tryHandle as tryPluginOriginUpdate } from "./parity-handlers/plugin-origin-update.js";
import { tryHandle as tryLibraryPlugins } from "./parity-handlers/library-plugins.js";
import { tryHandle as tryProjectHistory } from "./parity-handlers/project-history.js";
import { tryHandle as tryProjectConfig } from "./parity-handlers/project-config.js";
import { tryHandle as tryStashApply } from "./parity-handlers/stash-apply.js";
import { tryHandle as tryResolveOrder } from "./parity-handlers/resolve-order.js";
import { tryHandle as tryProfileDefaultEnv } from "./parity-handlers/profile-default-env.js";

export interface ParityRouteDeps {
  isAgentSwitchInProgress: () => boolean;
}

const HANDLERS = [
  tryEnvironments,
  tryApply,
  tryImport,
  tryProfileDelete,
  tryPublish,
  tryResourceMutate,
  tryMarketplaceRemove,
  tryMarketplaceUpdate,
  tryMarketplaceTree,
  tryCatalogScope,
  tryCloudOrgs,
  tryPluginOriginUpdate,
  tryLibraryPlugins,
  tryProjectHistory,
  tryProjectConfig,
  tryStashApply,
  tryResolveOrder,
  tryProfileDefaultEnv,
] as const;

export async function tryParityRoutes(
  request: Request,
  token: string,
  deps: ParityRouteDeps,
): Promise<Response | null> {
  for (const handler of HANDLERS) {
    const response = await handler(request, token, deps);
    if (response) {
      return response;
    }
  }
  return null;
}
