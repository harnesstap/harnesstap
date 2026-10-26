/** Tags typed into the profile tag field ("a, b") appended to the current pills. */
export function appendProfileTags(existing: readonly string[], input: string): string[] {
  const next = [...existing];
  for (const raw of input.split(",")) {
    const tag = raw.trim();
    if (tag && tag !== "profile" && !next.includes(tag)) next.push(tag);
  }
  return next;
}
