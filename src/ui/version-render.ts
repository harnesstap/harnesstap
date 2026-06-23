import semver from "semver";
import { theme } from "./theme.js";

function normalizeVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}

function parseCoreParts(version: string): [number, number, number] | null {
  const parsed = semver.parse(normalizeVersion(version), { loose: true });
  if (!parsed) {
    return null;
  }
  return [parsed.major, parsed.minor, parsed.patch];
}

export function formatVersionWithDrift(current: string, latest: string | null): string {
  if (!current) {
    return theme.muted("—");
  }
  if (!latest) {
    return current;
  }

  const normalizedCurrent = normalizeVersion(current);
  const normalizedLatest = normalizeVersion(latest);

  if (normalizedCurrent === normalizedLatest) {
    return theme.success(normalizedCurrent);
  }

  const currentParts = parseCoreParts(normalizedCurrent);
  const latestParts = parseCoreParts(normalizedLatest);
  if (!currentParts || !latestParts) {
    if (semver.valid(normalizedCurrent) && semver.valid(normalizedLatest)) {
      return semver.gte(normalizedCurrent, normalizedLatest)
        ? theme.success(normalizedCurrent)
        : theme.danger(normalizedCurrent);
    }
    return normalizedCurrent;
  }

  if (semver.gte(normalizedCurrent, normalizedLatest)) {
    return theme.success(normalizedCurrent);
  }

  let firstDivergentIndex = 3;
  for (let index = 0; index < currentParts.length; index += 1) {
    if (currentParts[index] !== latestParts[index]) {
      firstDivergentIndex = index;
      break;
    }
  }

  const segments = normalizedCurrent.split(".");
  let rendered = "";
  for (let index = 0; index < segments.length; index += 1) {
    if (index > 0) {
      rendered += ".";
    }
    const segment = segments[index] ?? "";
    rendered += index < firstDivergentIndex
      ? theme.success(segment)
      : theme.danger(segment);
  }
  return rendered;
}
