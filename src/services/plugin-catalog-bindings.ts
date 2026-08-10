import {
  ensureRegisteredPublishCatalog,
  formatPublishCatalogSelector,
  loadRegisteredCatalogs,
  parsePublishCatalogSelector,
  registerPublishCatalog,
  unregisterPublishCatalog,
  type RegisteredCatalog,
} from "../config/catalog.js";
import { getPlugin, listPlugins } from "../models/plugin-model.js";
import { isProfilePlugin } from "../constants/profile.js";
import {
  assertResolvablePublishTargets,
  buildPluginCatalogBindingsView,
  clearPluginPublishTargets,
  listPluginPublishTargets,
  removePluginPublishTarget,
  setPluginPublishTargets,
} from "./plugin-publish-targets.js";
import { promptForInteractivePluginCatalogBindings } from "./wizards/plugin-catalog-bindings.js";
import { promptForChoice, shouldUseWizard } from "./wizards/shared.js";
import { ui } from "../ui/index.js";

function sortPluginsForPicker<T extends { name: string; tags: string[] }>(plugins: T[]): T[] {
  return [...plugins].sort((left, right) => {
    const leftProfile = isProfilePlugin(left) ? 0 : 1;
    const rightProfile = isProfilePlugin(right) ? 0 : 1;
    if (leftProfile !== rightProfile) {
      return leftProfile - rightProfile;
    }
    return left.name.localeCompare(right.name);
  });
}

export async function handlePluginCatalogRegisterCommand(
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

export async function handlePluginCatalogUnregisterCommand(
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

export async function handlePluginCatalogRegisteredCommand(opts: {
  format?: string;
}): Promise<void> {
  const registered = loadRegisteredCatalogs();
  if (opts.format === "json") {
    console.log(JSON.stringify({ registered }, null, 2));
    return;
  }
  if (registered.length === 0) {
    ui.dim("No publish catalogs registered.");
    ui.hint("Register one: ht plugin catalog register org/catalog");
    return;
  }
  for (const catalog of registered) {
    console.log(formatPublishCatalogSelector(catalog));
  }
}

function renderBindingsView(view: ReturnType<typeof buildPluginCatalogBindingsView>): void {
  if (view.mode === "all_registered") {
    ui.info(`Plugin ${ui.theme.accent(view.plugin)} publishes to all registered catalogs (${view.effective.length}).`);
  } else {
    ui.info(
      `Plugin ${ui.theme.accent(view.plugin)} publishes to ${view.effective.length} of ${view.registered.length} registered catalogs.`,
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
  pluginName: string,
  opts: {
    add?: string[];
    remove?: string[];
    clear?: boolean;
    account?: string;
    format?: string;
  },
): Promise<void> {
  const plugin = getPlugin(pluginName);
  if (!plugin) {
    throw new Error(`Plugin not found: ${pluginName}`);
  }

  if (opts.clear) {
    clearPluginPublishTargets(plugin.id);
    if (opts.format === "json") {
      console.log(JSON.stringify(buildPluginCatalogBindingsView(plugin), null, 2));
      return;
    }
    ui.success(`Plugin ${ui.theme.accent(plugin.name)} will publish to all registered catalogs.`);
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
    setPluginPublishTargets(plugin.id, targets);
    if (opts.format === "json") {
      console.log(JSON.stringify(buildPluginCatalogBindingsView(plugin), null, 2));
      return;
    }
    ui.success(
      `Plugin ${ui.theme.accent(plugin.name)} publish targets: ${targets
        .map((target) => formatPublishCatalogSelector(target))
        .join(", ")}`,
    );
    return;
  }

  if (opts.remove && opts.remove.length > 0) {
    for (const selector of opts.remove) {
      const parsed = parsePublishCatalogSelector(selector);
      removePluginPublishTarget(plugin.id, parsed);
    }
    if (listPluginPublishTargets(plugin.id).length === 0) {
      clearPluginPublishTargets(plugin.id);
    }
    if (opts.format === "json") {
      console.log(JSON.stringify(buildPluginCatalogBindingsView(plugin), null, 2));
      return;
    }
    renderBindingsView(buildPluginCatalogBindingsView(plugin));
    return;
  }

  const view = buildPluginCatalogBindingsView(plugin);
  if (opts.format === "json") {
    console.log(JSON.stringify(view, null, 2));
    return;
  }
  renderBindingsView(view);
}

export async function handlePluginCatalogBindingsCommand(
  pluginName: string | undefined,
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

  if (hasMutation && !pluginName) {
    throw new Error("Plugin name is required when using --add, --remove, or --clear.");
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

  if (pluginName && hasMutation) {
    await applyBindingMutations(pluginName, opts);
    return;
  }

  if (pluginName) {
    const canPrompt = shouldUseWizard({
      interactive: opts.interactive,
      noInteractive: opts.noInteractive,
      format,
      missingRequiredArgs: false,
    });
    if (canPrompt) {
      const plugin = getPlugin(pluginName);
      if (!plugin) {
        throw new Error(`Plugin not found: ${pluginName}`);
      }
      await promptForInteractivePluginCatalogBindings({ plugin });
      return;
    }
    await applyBindingMutations(pluginName, { ...opts, format });
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
      "Plugin name is required in non-interactive mode. Pass a plugin name or use an interactive terminal.",
    );
  }

  const plugins = sortPluginsForPicker(listPlugins());
  if (plugins.length === 0) {
    throw new Error("No local plugins found. Create one with `ht plugin from-project` or `ht init`.");
  }

  const selectedName = await promptForChoice({
    message: "Select plugin to configure publish catalogs",
    choices: plugins.map((plugin) => ({
      name: `${plugin.name}@${plugin.version}`,
      value: plugin.name,
    })),
  });
  const plugin = getPlugin(selectedName);
  if (!plugin) {
    throw new Error(`Plugin not found: ${selectedName}`);
  }
  await promptForInteractivePluginCatalogBindings({ plugin });
}

export function resolvePublishTargetsForPlugin(pluginId: string): RegisteredCatalog[] {
  return assertResolvablePublishTargets(pluginId);
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
