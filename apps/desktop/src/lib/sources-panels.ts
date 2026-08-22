export function marketplaceSubmitCloseAction(
  refresh?: { ok: boolean; message: string },
): "close" | "stay-warning" {
  if (refresh !== undefined && !refresh.ok) {
    return "stay-warning";
  }
  return "close";
}

function samePlatforms(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((item, index) => item === b[index]);
}

export function marketplaceDraftIsDirty(input: {
  url: string;
  name: string;
  platforms: readonly string[];
  baselineUrl: string;
  baselineName: string;
  baselinePlatforms: readonly string[];
}): boolean {
  return (
    input.url.trim() !== input.baselineUrl.trim()
    || input.name.trim() !== input.baselineName.trim()
    || !samePlatforms(input.platforms, input.baselinePlatforms)
  );
}

export function connectCatalogDraftIsDirty(input: {
  selector: string;
  account: string;
  org: string;
}): boolean {
  return Boolean(
    input.selector.trim() || input.account.trim() || input.org.trim(),
  );
}
