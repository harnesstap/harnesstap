export const DEFAULT_CATALOG_SLUG = "default";

export type ParsedPluginSelector =
  | {
      scope: "local";
      name: string;
      version?: string;
    }
  | {
      scope: "published";
      org: string;
      catalog: string;
      name: string;
      version?: string;
    };

const INVALID_SELECTOR_MESSAGE =
  "Invalid plugin selector. Use name, name@version, or org/catalog/name[@version].";

function splitVersionFromSegment(segment: string): { name: string; version?: string } {
  if (!segment) {
    throw new Error(INVALID_SELECTOR_MESSAGE);
  }
  const atIndex = segment.lastIndexOf("@");
  if (atIndex === 0) {
    throw new Error(INVALID_SELECTOR_MESSAGE);
  }
  if (atIndex > 0) {
    const name = segment.slice(0, atIndex);
    const version = segment.slice(atIndex + 1);
    if (!name || !version) {
      throw new Error(INVALID_SELECTOR_MESSAGE);
    }
    return { name, version };
  }
  return { name: segment };
}

export function parsePluginSelector(selector: string): ParsedPluginSelector {
  const trimmed = selector.trim();
  if (!trimmed) {
    throw new Error(INVALID_SELECTOR_MESSAGE);
  }

  if (!trimmed.includes("/")) {
    const { name, version } = splitVersionFromSegment(trimmed);
    if (!name) {
      throw new Error(INVALID_SELECTOR_MESSAGE);
    }
    return { scope: "local", name, version };
  }

  const segments = trimmed.split("/").filter((part) => part.length > 0);
  if (segments.length !== 3) {
    throw new Error(INVALID_SELECTOR_MESSAGE);
  }

  const lastIndex = segments.length - 1;
  const lastSegment = segments[lastIndex];
  if (!lastSegment) {
    throw new Error(INVALID_SELECTOR_MESSAGE);
  }
  const { name: pluginName, version } = splitVersionFromSegment(lastSegment);
  if (!pluginName) {
    throw new Error(INVALID_SELECTOR_MESSAGE);
  }
  segments[lastIndex] = pluginName;

  const [org, catalog, name] = segments;
  if (!org || !catalog || !name) {
    throw new Error(INVALID_SELECTOR_MESSAGE);
  }
  return {
    scope: "published",
    org,
    catalog,
    name,
    version,
  };
}

export function formatPublishedSelector(input: {
  org: string;
  catalog: string;
  name: string;
}): string {
  if (input.catalog === DEFAULT_CATALOG_SLUG) {
    return `${input.org}/${input.name}`;
  }
  return `${input.org}/${input.catalog}/${input.name}`;
}

export function formatPublishedSelectorWithVersion(selector: {
  org: string;
  catalog: string;
  name: string;
  version?: string;
}): string {
  const base = formatPublishedSelector(selector);
  return selector.version ? `${base}@${selector.version}` : base;
}

/** Three-part selector for install/resolve paths (always includes catalog). */
export function formatCanonicalPublishedSelector(input: {
  org: string;
  catalog: string;
  name: string;
}): string {
  return `${input.org}/${input.catalog}/${input.name}`;
}

export function formatCanonicalPublishedSelectorWithVersion(selector: {
  org: string;
  catalog: string;
  name: string;
  version?: string;
}): string {
  const base = formatCanonicalPublishedSelector(selector);
  return selector.version ? `${base}@${selector.version}` : base;
}

export function resolvedRemotePluginFromCatalog(input: {
  org: string;
  catalog: string;
  name: string;
  version?: string | null;
}): ResolvedRemotePluginSelector {
  return {
    org_slug: input.org,
    catalog_slug: input.catalog,
    plugin_slug: input.name,
    ...(input.version ? { version: input.version } : {}),
  };
}

export interface ResolvedRemotePluginSelector {
  org_slug: string;
  catalog_slug: string;
  plugin_slug: string;
  version?: string;
}

export function resolveRemotePluginSelector(
  selector: string,
  opts: { org?: string; catalog?: string; version?: string },
): ResolvedRemotePluginSelector {
  const parsed = parsePluginSelector(selector);

  if (parsed.scope === "local") {
    if (opts.version && parsed.version) {
      throw new Error(
        "--version conflicts with version in selector. Remove --version or use selector without version.",
      );
    }
    if (!opts.org) {
      throw new Error(
        "org is required. Provide it in the selector as org/catalog/plugin or use --org <slug>",
      );
    }

    return {
      org_slug: opts.org,
      catalog_slug: opts.catalog ?? DEFAULT_CATALOG_SLUG,
      plugin_slug: parsed.name,
      version: opts.version ?? parsed.version,
    };
  }

  if (opts.org && opts.org !== parsed.org) {
    throw new Error(
      "--org conflicts with org in selector. Remove --org or use selector without org.",
    );
  }
  if (opts.catalog && opts.catalog !== parsed.catalog) {
    throw new Error(
      "--catalog conflicts with catalog in selector. Remove --catalog or use selector without catalog.",
    );
  }
  if (opts.version && parsed.version) {
    throw new Error(
      "--version conflicts with version in selector. Remove --version or use selector without version.",
    );
  }

  return {
    org_slug: parsed.org,
    catalog_slug: opts.catalog ?? parsed.catalog,
    plugin_slug: parsed.name,
    version: opts.version ?? parsed.version,
  };
}
