import { resolvePluginSelector } from "../models/plugin-model.js";
import { createPersistingCloudClient } from "./cloud-account-auth.js";
import { cloudErrorDetail, requestIdSuffix } from "./cloud-api-error.js";
import type { CloudClient, CloudDuplicateResponse } from "./cloud-client.js";
import { type DuplicateMode, type DuplicateResult, duplicatePlugin } from "./plugin-duplicate.js";
import { catalogUpstreamBase, PluginForkError } from "./plugin-fork.js";
import { parsePluginSelector } from "./plugin-selector.js";

export type CloudDuplicateOutcome =
  | { kind: "cloud"; response: CloudDuplicateResponse }
  /** Cloud has no duplicate endpoint yet: the profile was made in the Library. */
  | { kind: "local"; result: DuplicateResult };

export interface CloudDuplicateDeps {
  createClient: (account?: string) => Promise<CloudClient | null>;
}

const defaultDeps: CloudDuplicateDeps = {
  createClient: async (account) => (await createPersistingCloudClient(account))?.client ?? null,
};

function parseTarget(to: string): { org: string; catalog: string } {
  const [org, catalog, ...rest] = to.split("/").map((part) => part.trim());
  if (!org || rest.length > 0) {
    throw new PluginForkError("not_found", `Invalid --to "${to}". Use <org>/<catalog>, e.g. my-org/default.`);
  }
  return { org, catalog: catalog || "default" };
}

/** The catalog address of the source: a published selector, or a pulled Library profile. */
function catalogSource(selector: string): { org: string; catalog: string; slug: string } | undefined {
  const parsed = parsePluginSelector(selector);
  if (parsed.scope === "published") {
    return { org: parsed.org, catalog: parsed.catalog, slug: parsed.name };
  }
  const local = resolvePluginSelector(selector);
  const base = local ? catalogUpstreamBase(local) : undefined;
  if (!base) return undefined;
  const [org, catalog, slug] = base.split("/");
  return org && catalog && slug ? { org, catalog, slug } : undefined;
}

/**
 * `profile duplicate --to <org>/<catalog>`: Cloud makes and publishes the new
 * profile. A Cloud without the endpoint (bare 404) falls back to the Library
 * duplicate when the source is installed.
 */
export async function duplicateInCloud(
  selector: string,
  opts: { name?: string; mode: DuplicateMode; to: string; account?: string },
  deps: CloudDuplicateDeps = defaultDeps,
): Promise<CloudDuplicateOutcome> {
  const target = parseTarget(opts.to);
  const source = catalogSource(selector);
  if (!source) {
    throw new PluginForkError(
      "not_found",
      `${selector} is not in a catalog, so Cloud cannot duplicate it. Drop --to to duplicate it in your Library.`,
    );
  }
  const client = await deps.createClient(opts.account);
  if (!client) {
    throw new PluginForkError("not_found", "Not signed in to HarnessTap Cloud. Run `ht auth login` first.");
  }
  const name = opts.name?.trim() || `${source.slug}-copy`;
  let response: CloudDuplicateResponse | null;
  try {
    response = await client.duplicateCatalogPlugin({
      source,
      mode: opts.mode === "copy" ? "copy" : "extends",
      name,
      targetOrg: target.org,
      targetCatalog: target.catalog,
    });
  } catch (error) {
    const detail = cloudErrorDetail(error);
    if (detail.code === "upstream_unpublished") {
      throw new PluginForkError(
        "not_found",
        `${detail.ref ?? `${source.org}/${source.catalog}/${source.slug}`} is not published, so it cannot be duplicated.${requestIdSuffix(detail)}`,
      );
    }
    if (detail.message) {
      throw new PluginForkError("not_found", `Cloud could not duplicate ${source.org}/${source.catalog}/${source.slug}: ${detail.message}${requestIdSuffix(detail)}`);
    }
    throw error;
  }
  if (response) return { kind: "cloud", response };

  if (!resolvePluginSelector(selector)) {
    throw new PluginForkError(
      "not_found",
      `Cloud cannot duplicate profiles yet and ${selector} is not in your Library. Run \`ht profile pull ${selector}\`, then duplicate without --to.`,
    );
  }
  return { kind: "local", result: duplicatePlugin(selector, { name, mode: opts.mode }) };
}
