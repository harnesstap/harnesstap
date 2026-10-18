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

const CLOUD_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;

/**
 * Cloud's slug rule for a duplicate name (harnesstap-cloud#143): trim,
 * lowercase, runs of other characters become "-", edge hyphens stripped,
 * "--" collapsed, at most 64 characters, then the slug pattern must match.
 * Returns undefined when Cloud would answer 400 invalid_input.
 */
export function cloudSlugFromName(name: string): string | undefined {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 64);
  return CLOUD_SLUG_PATTERN.test(slug) ? slug : undefined;
}

function invalidNameMessage(name: string): string {
  return `"${name}" cannot be used as a Cloud profile name: it needs letters or digits, and its slug must be at most 64 characters without a hyphen at either end. Try a name such as planner-copy.`;
}

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
  const name = opts.name?.trim() || `${source.slug}-copy`;
  const slug = cloudSlugFromName(name);
  if (!slug) {
    throw new PluginForkError("not_found", invalidNameMessage(name));
  }
  const client = await deps.createClient(opts.account);
  if (!client) {
    throw new PluginForkError("not_found", "Not signed in to HarnessTap Cloud. Run `ht auth login` first.");
  }
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
    throw new PluginForkError(
      "not_found",
      cloudDuplicateErrorMessage(error, { selector, source, target, name, slug }) ?? (error instanceof Error ? error.message : String(error)),
    );
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

/** One clear message per Cloud duplicate error (harnesstap-cloud#143). */
export function cloudDuplicateErrorMessage(
  error: unknown,
  ctx: {
    selector: string;
    source: { org: string; catalog: string; slug: string };
    target: { org: string; catalog: string };
    name: string;
    slug: string;
  },
): string | undefined {
  const detail = cloudErrorDetail(error);
  const request = requestIdSuffix(detail);
  const sourceLabel = `${ctx.source.org}/${ctx.source.catalog}/${ctx.source.slug}`;
  const to = `${ctx.target.org}/${ctx.target.catalog}`;
  switch (detail.code) {
    case "invalid_input":
      return `${invalidNameMessage(ctx.name)}${request}`;
    case "duplicate_slug":
      return `${to} already has a profile with the slug ${ctx.slug}. Pick another name, e.g. \`ht profile duplicate ${sourceLabel} ${ctx.slug}-2 --to ${to}\`.${request}`;
    case "not_found":
      return `Cloud cannot find ${sourceLabel}: it is hidden, private, or does not exist. Check the selector, or sign in with an account that can see it.${request}`;
    case "forbidden":
      return `Cloud does not know the organization ${ctx.target.org}, or this account cannot publish there. Check --to ${to}.${request}`;
    case "catalog_not_found":
      return `Cloud cannot find the catalog in ${to}${detail.message ? ` (${detail.message.replace(/\.$/, "")})` : ""}. Check --to <org>/<catalog>.${request}`;
    case "upstream_unpublished":
      return `${detail.ref ?? sourceLabel} is not published, so it cannot be duplicated.${request}`;
    default:
      return detail.message ? `Cloud could not duplicate ${sourceLabel}: ${detail.message}${request}` : undefined;
  }
}
