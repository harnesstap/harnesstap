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
  trackedBranches: string;
  baselineUrl: string;
  baselineName: string;
  baselinePlatforms: readonly string[];
  baselineTrackedBranches: string;
}): boolean {
  return (
    input.url.trim() !== input.baselineUrl.trim()
    || input.name.trim() !== input.baselineName.trim()
    || !samePlatforms(input.platforms, input.baselinePlatforms)
    || formatTrackedBranchesField(input.trackedBranches)
      !== formatTrackedBranchesField(input.baselineTrackedBranches)
  );
}

export function parseTrackedBranchesField(value: string): string[] {
  const seen = new Set<string>();
  const branches: string[] = [];
  for (const part of value.split(/[\s,]+/)) {
    const trimmed = part.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    branches.push(trimmed);
  }
  return branches;
}

export function formatTrackedBranchesField(value: string | readonly string[]): string {
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return parseTrackedBranchesField(value).join(", ");
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
