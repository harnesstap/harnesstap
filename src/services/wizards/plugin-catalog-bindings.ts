import {
  formatPublishCatalogSelector,
  loadRegisteredCatalogs,
  publishCatalogKey,
  type RegisteredCatalog,
} from "../../config/catalog.js";
import type { Plugin } from "../../types.js";
import {
  clearPluginPublishTargets,
  listPluginPublishTargets,
  setPluginPublishTargets,
} from "../plugin-publish-targets.js";
import { promptForSearchableMultiSelect } from "./searchable-multi-select.js";
import { ui } from "../../ui/index.js";

function groupRegisteredCatalogs(catalogs: RegisteredCatalog[]): RegisteredCatalog[] {
  return [...catalogs].sort((left, right) => {
    const orgCompare = left.org.localeCompare(right.org);
    if (orgCompare !== 0) {
      return orgCompare;
    }
    return left.catalog.localeCompare(right.catalog);
  });
}

function formatCatalogChoiceName(catalog: RegisteredCatalog): string {
  return `${catalog.org} / ${catalog.catalog}`;
}

export async function promptForInteractivePluginCatalogBindings(input: {
  plugin: Plugin;
}): Promise<void> {
  const registered = groupRegisteredCatalogs(loadRegisteredCatalogs());
  if (registered.length === 0) {
    throw new Error(
      "No publish catalogs registered. Run `ht plugin catalog register org/catalog` first.",
    );
  }

  const allowList = listPluginPublishTargets(input.plugin.id);
  const registeredKeys = new Set(registered.map((entry) => publishCatalogKey(entry)));
  const effectiveAllowList = allowList.filter((entry) =>
    registeredKeys.has(publishCatalogKey(entry)),
  );
  const allRegistered = allowList.length === 0;
  const selectedKeys = new Set(
    (allRegistered ? registered : effectiveAllowList).map((entry: RegisteredCatalog) =>
      publishCatalogKey(entry),
    ),
  );

  const choices = registered.map((catalog) => ({
    name: formatCatalogChoiceName(catalog),
    value: publishCatalogKey(catalog),
    short: formatPublishCatalogSelector(catalog),
  }));

  const header = allRegistered
    ? `Publishing to: all registered (${registered.length} catalogs)`
    : `Publishing to: ${effectiveAllowList.length} of ${registered.length} registered catalogs`;
  ui.info(header);

  const selected = await promptForSearchableMultiSelect({
    message: `Publish catalogs for plugin ${input.plugin.name}`,
    choices,
    default: [...selectedKeys],
  });

  const selectedSet = new Set(selected);
  if (selectedSet.size === registered.length) {
    clearPluginPublishTargets(input.plugin.id);
    ui.success(`Plugin ${ui.theme.accent(input.plugin.name)} will publish to all registered catalogs.`);
    return;
  }

  if (selectedSet.size === 0) {
    throw new Error("Select at least one publish catalog.");
  }

  const targets = registered.filter((catalog) => selectedSet.has(publishCatalogKey(catalog)));
  setPluginPublishTargets(input.plugin.id, targets);
  ui.success(
    `Plugin ${ui.theme.accent(input.plugin.name)} publish targets: ${targets
      .map((target) => formatPublishCatalogSelector(target))
      .join(", ")}`,
  );
}
