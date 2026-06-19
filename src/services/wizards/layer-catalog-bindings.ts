import {
  formatPublishCatalogSelector,
  loadRegisteredCatalogs,
  publishCatalogKey,
  type RegisteredCatalog,
} from "../../config/catalog.js";
import type { Layer } from "../../types.js";
import {
  clearLayerPublishTargets,
  listLayerPublishTargets,
  setLayerPublishTargets,
} from "../layer-publish-targets.js";
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

export async function promptForInteractiveLayerCatalogBindings(input: {
  layer: Layer;
}): Promise<void> {
  const registered = groupRegisteredCatalogs(loadRegisteredCatalogs());
  if (registered.length === 0) {
    throw new Error(
      "No publish catalogs registered. Run `hd layer catalog register org/catalog` first.",
    );
  }

  const allowList = listLayerPublishTargets(input.layer.id);
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
    message: `Publish catalogs for layer ${input.layer.name}`,
    choices,
    default: [...selectedKeys],
  });

  const selectedSet = new Set(selected);
  if (selectedSet.size === registered.length) {
    clearLayerPublishTargets(input.layer.id);
    ui.success(`Layer ${ui.theme.accent(input.layer.name)} will publish to all registered catalogs.`);
    return;
  }

  if (selectedSet.size === 0) {
    throw new Error("Select at least one publish catalog.");
  }

  const targets = registered.filter((catalog) => selectedSet.has(publishCatalogKey(catalog)));
  setLayerPublishTargets(input.layer.id, targets);
  ui.success(
    `Layer ${ui.theme.accent(input.layer.name)} publish targets: ${targets
      .map((target) => formatPublishCatalogSelector(target))
      .join(", ")}`,
  );
}
