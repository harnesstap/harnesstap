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
  trackedBranches: string | readonly string[];
  baselineUrl: string;
  baselineName: string;
  baselinePlatforms: readonly string[];
  baselineTrackedBranches: string | readonly string[];
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
  if (typeof value !== "string") {
    return parseTrackedBranchesField(value.join(" ")).join(", ");
  }
  return parseTrackedBranchesField(value).join(", ");
}

export function extraTrackedBranches(
  selected: readonly string[],
  defaultBranch: string | null,
): string[] {
  return parseTrackedBranchesField(selected.join(" ")).filter(
    (branch) => branch !== defaultBranch,
  );
}

export function marketplaceSourceLooksResolvable(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed.startsWith("file:")) {
    return trimmed.length > "file://".length;
  }
  if (
    trimmed.startsWith("/")
    || trimmed.startsWith("./")
    || trimmed.startsWith("../")
    || trimmed.startsWith("~/")
  ) {
    return trimmed.length >= 2;
  }
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return trimmed.length > 3;
  }
  if (/^git@[^:]+:\S+/.test(trimmed)) {
    return true;
  }
  if (/^ssh:\/\//i.test(trimmed) || /^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      return parsed.pathname.split("/").filter(Boolean).length >= 1;
    } catch {
      return false;
    }
  }
  return false;
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
