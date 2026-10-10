/**
 * Mirror of `src/copy/plurals.ts` for Desktop (W3-2 / PR-D4).
 * Keep this file in sync with the CLI helper.
 */

export function formatCount(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

export function pluralNoun(count: number, noun: string, plural = `${noun}s`): string {
  return count === 1 ? noun : plural;
}
