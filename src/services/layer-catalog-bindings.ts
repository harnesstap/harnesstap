import {
  ensureRegisteredPublishCatalog,
  formatPublishCatalogSelector,
  loadRegisteredCatalogs,
  parsePublishCatalogSelector,
  registerPublishCatalog,
  unregisterPublishCatalog,
  type RegisteredCatalog,
} from "../config/catalog.js";
import { getLayer, listLayers } from "../models/layer-model.js";
import { isProfileLayer } from "../constants/profile.js";
import {
  assertResolvablePublishTargets,
  buildLayerCatalogBindingsView,
  clearLayerPublishTargets,
  listLayerPublishTargets,
  removeLayerPublishTarget,
  setLayerPublishTargets,
} from "./layer-publish-targets.js";
import { promptForInteractiveLayerCatalogBindings } from "./wizards/layer-catalog-bindings.js";
import { promptForChoice, shouldUseWizard } from "./wizards/shared.js";
import { ui } from "../ui/index.js";

function sortLayersForPicker<T extends { name: string; tags: string[] }>(layers: T[]): T[] {
  return [...layers].sort((left, right) => {
    const leftProfile = isProfileLayer(left) ? 0 : 1;
    const rightProfile = isProfileLayer(right) ? 0 : 1;
    if (leftProfile !== rightProfile) {
      return leftProfile - rightProfile;
    }
    return left.name.localeCompare(right.name);
  });
}

export async function handleLayerCatalogRegisterCommand(
  selector: string,
  opts: { account?: string; format?: string },
): Promise<void> {
  const parsed = parsePublishCatalogSelector(selector);
  const withAccount = opts.account?.trim()
    ? { ...parsed, account: opts.account.trim() }
    : parsed;
  const { catalog, created } = registerPublishCatalog(formatPublishCatalogSelector(withAccount));
  if (opts.format === "json") {
    console.log(JSON.stringify({ catalog, created }, null, 2));
    return;
  }
  if (created) {
    ui.success(`Registered publish catalog ${ui.theme.accent(formatPublishCatalogSelector(catalog))}`);
    return;
  }
  ui.info(`Publish catalog ${ui.theme.accent(formatPublishCatalogSelector(catalog))} is already registered.`);
}

export async function handleLayerCatalogUnregisterCommand(
  selector: string,
  opts: { format?: string },
): Promise<void> {
  const parsed = parsePublishCatalogSelector(selector);
  unregisterPublishCatalog(formatPublishCatalogSelector(parsed));
  if (opts.format === "json") {
    console.log(JSON.stringify({ removed: parsed }, null, 2));
    return;
  }
  ui.success(`Unregistered publish catalog ${ui.theme.accent(formatPublishCatalogSelector(parsed))}`);
}

export async function handleLayerCatalogRegisteredCommand(opts: {
  format?: string;
}): Promise<void> {
  const registered = loadRegisteredCatalogs();
  if (opts.format === "json") {
    console.log(JSON.stringify({ registered }, null, 2));
    return;
  }
  if (registered.length === 0) {
    ui.dim("No publish catalogs registered.");
    ui.hint("Register one: ht layer catalog register org/catalog");
    return;
  }
  for (const catalog of registered) {
    console.log(formatPublishCatalogSelector(catalog));
  }
}

function renderBindingsView(view: ReturnType<typeof buildLayerCatalogBindingsView>): void {
  if (view.mode === "all_registered") {
    ui.info(`Layer ${ui.theme.accent(view.layer)} publishes to all registered catalogs (${view.effective.length}).`);
  } else {
    ui.info(
      `Layer ${ui.theme.accent(view.layer)} publishes to ${view.effective.length} of ${view.registered.length} registered catalogs.`,
    );
  }
  if (view.effective.length === 0) {
    ui.dim("No effective publish catalogs.");
    return;
  }
  for (const catalog of view.effective) {
    console.log(`  ${formatPublishCatalogSelector(catalog)}`);
  }
}

async function applyBindingMutations(
  layerName: string,
  opts: {
    add?: string[];
    remove?: string[];
    clear?: boolean;
    account?: string;
    format?: string;
  },
): Promise<void> {
  const layer = getLayer(layerName);
  if (!layer) {
    throw new Error(`Layer not found: ${layerName}`);
  }

  if (opts.clear) {
    clearLayerPublishTargets(layer.id);
    if (opts.format === "json") {
      console.log(JSON.stringify(buildLayerCatalogBindingsView(layer), null, 2));
      return;
    }
    ui.success(`Layer ${ui.theme.accent(layer.name)} will publish to all registered catalogs.`);
    return;
  }

  if (opts.add && opts.add.length > 0) {
    const targets: RegisteredCatalog[] = [];
    for (const selector of opts.add) {
      const { catalog, created } = ensureRegisteredPublishCatalog(selector, {
        account: opts.account,
      });
      if (created && opts.format !== "json") {
        ui.info(`Registered publish catalog ${formatPublishCatalogSelector(catalog)}`);
      }
      targets.push(catalog);
    }
    setLayerPublishTargets(layer.id, targets);
    if (opts.format === "json") {
      console.log(JSON.stringify(buildLayerCatalogBindingsView(layer), null, 2));
      return;
    }
    ui.success(
      `Layer ${ui.theme.accent(layer.name)} publish targets: ${targets
        .map((target) => formatPublishCatalogSelector(target))
        .join(", ")}`,
    );
    return;
  }

  if (opts.remove && opts.remove.length > 0) {
    for (const selector of opts.remove) {
      const parsed = parsePublishCatalogSelector(selector);
      removeLayerPublishTarget(layer.id, parsed);
    }
    if (listLayerPublishTargets(layer.id).length === 0) {
      clearLayerPublishTargets(layer.id);
    }
    if (opts.format === "json") {
      console.log(JSON.stringify(buildLayerCatalogBindingsView(layer), null, 2));
      return;
    }
    renderBindingsView(buildLayerCatalogBindingsView(layer));
    return;
  }

  const view = buildLayerCatalogBindingsView(layer);
  if (opts.format === "json") {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  renderBindingsView(view);
}

export async function handleLayerCatalogBindingsCommand(
  layerName: string | undefined,
  opts: {
    add?: string[];
    remove?: string[];
    clear?: boolean;
    account?: string;
    format?: string;
    interactive?: boolean;
    noInteractive?: boolean;
  },
): Promise<void> {
  const format = opts.format ?? "human";
  const hasMutation = Boolean(
    opts.clear || (opts.add && opts.add.length > 0) || (opts.remove && opts.remove.length > 0),
  );

  if (hasMutation && !layerName) {
    throw new Error("Layer name is required when using --add, --remove, or --clear.");
  }

  const mutationFlags = [
    opts.clear ? "--clear" : undefined,
    opts.add && opts.add.length > 0 ? "--add" : undefined,
    opts.remove && opts.remove.length > 0 ? "--remove" : undefined,
  ].filter((flag): flag is string => Boolean(flag));
  if (mutationFlags.length > 1) {
    throw new Error(
      `Use only one of ${mutationFlags.join(", ")} per invocation.`,
    );
  }

  if (layerName && hasMutation) {
    await applyBindingMutations(layerName, opts);
    return;
  }

  if (layerName) {
    const canPrompt = shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format,
      missingRequiredArgs: false,
    });
    if (canPrompt) {
      const layer = getLayer(layerName);
      if (!layer) {
        throw new Error(`Layer not found: ${layerName}`);
      }
      await promptForInteractiveLayerCatalogBindings({ layer });
      return;
    }
    await applyBindingMutations(layerName, { ...opts, format });
    return;
  }

  const canPrompt = shouldUseWizard({
    interactive: opts.interactive,
    noInteractive: opts.noInteractive,
    format,
    missingRequiredArgs: true,
  });
  if (!canPrompt) {
    throw new Error(
      "Layer name is required in non-interactive mode. Pass a layer name or use an interactive terminal.",
    );
  }

  const layers = sortLayersForPicker(listLayers());
  if (layers.length === 0) {
    throw new Error("No local layers found. Create one with `ht layer from-project` or `ht init`.");
  }

  const selectedName = await promptForChoice({
    message: "Select layer to configure publish catalogs",
    choices: layers.map((layer) => ({
      name: `${layer.name}@${layer.version}`,
      value: layer.name,
    })),
  });
  const layer = getLayer(selectedName);
  if (!layer) {
    throw new Error(`Layer not found: ${selectedName}`);
  }
  await promptForInteractiveLayerCatalogBindings({ layer });
}

export function resolvePublishTargetsForLayer(layerId: string): RegisteredCatalog[] {
  return assertResolvablePublishTargets(layerId);
}

export function resolveOneOffPublishTarget(input: {
  catalogSelector?: string;
  org?: string;
  catalog?: string;
  account?: string;
}): RegisteredCatalog[] {
  if (input.catalogSelector) {
    const parsed = parsePublishCatalogSelector(input.catalogSelector);
    return [
      input.account?.trim()
        ? { ...parsed, account: input.account.trim() }
        : parsed,
    ];
  }
  if (input.org?.trim()) {
    return [
      {
        org: input.org.trim().toLowerCase(),
        catalog: (input.catalog?.trim() || "default").toLowerCase(),
        ...(input.account?.trim() ? { account: input.account.trim() } : {}),
      },
    ];
  }
  return [];
}
