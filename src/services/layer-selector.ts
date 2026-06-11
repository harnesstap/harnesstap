export const DEFAULT_CATALOG_SLUG = "default";

export type ParsedLayerSelector =
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
  "Invalid layer selector. Use name, name@version, or org/catalog/name[@version].";

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

export function parseLayerSelector(selector: string): ParsedLayerSelector {
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
  const { name: layerName, version } = splitVersionFromSegment(lastSegment);
  if (!layerName) {
    throw new Error(INVALID_SELECTOR_MESSAGE);
  }
  segments[lastIndex] = layerName;

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

export interface ResolvedRemoteLayerSelector {
  org_slug: string;
  catalog_slug: string;
  layer_slug: string;
  version?: string;
}

export function resolveRemoteLayerSelector(
  selector: string,
  opts: { org?: string; catalog?: string; version?: string },
): ResolvedRemoteLayerSelector {
  const parsed = parseLayerSelector(selector);

  if (parsed.scope === "local") {
    if (opts.version && parsed.version) {
      throw new Error(
        "--version conflicts with version in selector. Remove --version or use selector without version.",
      );
    }
    if (!opts.org) {
      throw new Error(
        "org is required. Provide it in the selector as org/catalog/layer or use --org <slug>",
      );
    }

    return {
      org_slug: opts.org,
      catalog_slug: opts.catalog ?? DEFAULT_CATALOG_SLUG,
      layer_slug: parsed.name,
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
    layer_slug: parsed.name,
    version: opts.version ?? parsed.version,
  };
}
