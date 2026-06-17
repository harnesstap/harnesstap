import type { CompletionCandidate } from "./types.js";

export function filterByPrefix(
  candidates: CompletionCandidate[],
  prefix: string,
): CompletionCandidate[] {
  const normalized = prefix.toLowerCase();
  const seen = new Set<string>();
  const results: CompletionCandidate[] = [];

  for (const candidate of candidates) {
    if (!candidate.value.toLowerCase().startsWith(normalized)) {
      continue;
    }
    if (seen.has(candidate.value)) {
      continue;
    }
    seen.add(candidate.value);
    results.push(candidate);
  }

  return results.sort((left, right) => left.value.localeCompare(right.value));
}

export function normalizeFlagName(flag: string): string {
  const trimmed = flag.trim();
  const longMatch = trimmed.match(/^--([^=]+)/);
  if (longMatch?.[1]) {
    return longMatch[1];
  }
  const shortMatch = trimmed.match(/^-([^-])/);
  if (shortMatch?.[1]) {
    return shortMatch[1];
  }
  return trimmed.replace(/^-+/, "");
}

export function flagsMatch(flag: string | undefined, expected: string): boolean {
  if (!flag) {
    return false;
  }
  const normalized = normalizeFlagName(flag);
  return normalized === expected || normalized === expected[0];
}
