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
