/**
 * Shared count/plural helper for CLI and Desktop (W3-2).
 * Desktop can import this module or mirror `apps/desktop/src/lib/plurals.ts`.
 */

export function formatCount(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

export function pluralNoun(count: number, noun: string, plural = `${noun}s`): string {
  return count === 1 ? noun : plural;
}
