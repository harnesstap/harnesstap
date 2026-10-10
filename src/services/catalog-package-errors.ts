export class CatalogPackageNotFoundError extends Error {
  readonly selector: string;

  constructor(selector: string) {
    super(`Catalog package not found: ${selector}`);
    this.name = "CatalogPackageNotFoundError";
    this.selector = selector;
  }
}

export class CatalogDependencyVersionError extends Error {
  readonly pluginName: string;
  readonly version: string;
  readonly catalog: string;
  readonly available: string[];
  readonly hints: string[];

  constructor(input: {
    pluginName: string;
    version: string;
    catalog: string;
    available: string[];
    requirer: string;
  }) {
    const available =
      input.available.length > 0 ? input.available.join(", ") : "(none known)";
    super(
      [
        `Catalog ${input.catalog} has no version ${input.version} of ${input.pluginName}.`,
        `  requested: ${input.pluginName}@${input.version}`,
        `  catalog: ${input.catalog}`,
        `  available: ${available}`,
        `  required by: ${input.requirer} → ${input.pluginName} ${input.version}`,
        `  fix: pin an available version, or publish ${input.pluginName}@${input.version} to ${input.catalog}`,
      ].join("\n"),
    );
    this.name = "CatalogDependencyVersionError";
    this.pluginName = input.pluginName;
    this.version = input.version;
    this.catalog = input.catalog;
    this.available = input.available;
    this.hints = [
      `ht plugin pull ${input.catalog}/${input.pluginName}@<available-version>`,
    ];
  }
}

export class CatalogPluginYankedError extends Error {
  readonly reason: string | null;

  constructor(selector: string, reason?: string | null) {
    super(
      reason?.trim()
        ? `${selector} is yanked: ${reason.trim()}`
        : `${selector} was yanked and is no longer installable.`,
    );
    this.name = "CatalogPluginYankedError";
    this.reason = reason?.trim() || null;
  }
}

export async function throwIfCatalogPackageYanked(
  response: Response,
  selector: string,
): Promise<void> {
  if (response.status !== 410) {
    return;
  }

  let reason: string | null = null;
  try {
    const body = (await response.clone().json()) as { error?: string; reason?: string };
    if (body.error === "yanked") {
      reason = body.reason ?? null;
    }
  } catch {
    // Body may be empty; the status is enough to treat the version as yanked.
  }
  throw new CatalogPluginYankedError(selector, reason);
}
