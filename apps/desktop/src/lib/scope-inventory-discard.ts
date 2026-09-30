import { packageDirectoryDisplayPath } from "./resource-display";
import { resourceTypeTabUnit } from "./resource-type-tabs";
import type { ProfileContentsResource } from "./types";

/** First page of discard-confirm paths; matches Library Content file lists. */
export const DISCARD_PATHS_PAGE_SIZE = 20;

export type DiscardPathRow = {
  key: string;
  label: string;
  path: string;
};

export function discardTypeUnit(type: string): string {
  return resourceTypeTabUnit(type, 1);
}

export function formatDiscardResourceSubject(item: {
  type: string;
  label: string;
}): string {
  const name = item.label.trim();
  return `${discardTypeUnit(item.type)} ${name}`.trim();
}

export function discardResourceTitle(item: {
  type: string;
  label: string;
}): string {
  return `Discard ${formatDiscardResourceSubject(item)}?`;
}

export function discardResourceDescription(): string {
  return "This deletes the live copy on disk.";
}

export function discardAllTitle(count: number): string {
  if (count === 1) {
    return "Discard 1 resource?";
  }
  return `Discard ${count} resources?`;
}

export function discardAllDescription(count: number): string {
  if (count === 1) {
    return discardResourceDescription();
  }
  return "This deletes their live copies on disk.";
}

export function formatDiscardFileCount(count: number): string {
  if (count === 1) {
    return "Deletes 1 file.";
  }
  return `Deletes ${count} files.`;
}

function looksLikeDiskPath(value: string): boolean {
  return /[\\/]/.test(value) || value.includes(".");
}

export function discardPathForResource(
  resource: Pick<ProfileContentsResource, "source">,
): string | null {
  const source = resource.source?.trim() ?? "";
  if (!source || source === "manual" || !looksLikeDiskPath(source)) {
    return null;
  }
  return packageDirectoryDisplayPath(source);
}

export function collectDiscardPathRows(
  items: ReadonlyArray<{
    key: string;
    type: string;
    label: string;
    resource: Pick<ProfileContentsResource, "source">;
  }>,
): DiscardPathRow[] {
  const rows: DiscardPathRow[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const path = discardPathForResource(item.resource);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    rows.push({
      key: item.key,
      label: formatDiscardResourceSubject(item),
      path,
    });
  }
  return rows;
}

export function sliceDiscardPaths(
  rows: readonly DiscardPathRow[],
  visibleCount: number,
): DiscardPathRow[] {
  if (visibleCount >= rows.length) {
    return [...rows];
  }
  return rows.slice(0, Math.max(0, visibleCount));
}
