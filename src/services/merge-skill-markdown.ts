import matter from "gray-matter";

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function generatedIsLiveSubset(live: string, generated: string): boolean {
  const liveNorm = normalizeNewlines(live);
  const generatedNorm = normalizeNewlines(generated).replace(/\s+$/u, "");
  if (generatedNorm.length === 0) {
    return true;
  }
  if (liveNorm.startsWith(generatedNorm) || liveNorm.includes(generatedNorm)) {
    return true;
  }
  const liveParsed = matter(liveNorm);
  const generatedParsed = matter(generatedNorm);
  const generatedBody = generatedParsed.content.trim();
  if (generatedBody.length === 0) {
    return true;
  }
  return liveParsed.content.includes(generatedBody);
}

/**
 * Merge a thin profile SKILL.md snapshot into a richer live file:
 * extra live frontmatter keys and body are kept when the generated file is a
 * subset (prefix / contained body). Profile name/description overlay live.
 * A true body rewrite (generated body not contained in live) replaces the body.
 */
export function mergeSkillMarkdown(
  live: string | null | undefined,
  generated: string,
): string {
  if (!live) {
    return generated;
  }
  const liveParsed = matter(normalizeNewlines(live));
  const generatedParsed = matter(normalizeNewlines(generated));
  const data: Record<string, unknown> = {
    ...(liveParsed.data as Record<string, unknown>),
    ...(generatedParsed.data as Record<string, unknown>),
  };
  const keepLiveBody = generatedIsLiveSubset(live, generated);
  const body = keepLiveBody ? liveParsed.content : generatedParsed.content;
  const nonEmpty = Object.fromEntries(
    Object.entries(data).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
  if (Object.keys(nonEmpty).length === 0) {
    return body.startsWith("\n") ? body.slice(1) : body;
  }
  return matter.stringify(body.replace(/^\n/, ""), nonEmpty);
}
