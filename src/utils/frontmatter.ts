import matter from "gray-matter";

/**
 * Parse YAML frontmatter without gray-matter's content cache.
 *
 * Called without options, gray-matter stores each input in a process-wide
 * cache before parsing it. When the YAML is invalid the parse throws, but the
 * half-built entry (empty `data`) stays cached, so the next parse of the same
 * text returns it without an error. A long-lived process (the sidecar, a
 * second import) then reads a broken file as one with no frontmatter. Passing
 * options turns the cache off; the parse itself is the same.
 */
export function parseFrontmatter(text: string): matter.GrayMatterFile<string> {
  return matter(text, {});
}

/**
 * Like {@link parseFrontmatter}, but when the YAML is invalid only because a
 * flat `key: value` line holds an unquoted `: ` (for example
 * `description: Search in three steps: search, timeline`), read each such
 * line as a string, as Claude Code does. Anything else still throws.
 */
export function parseFrontmatterLenient(text: string): matter.GrayMatterFile<string> {
  try {
    return parseFrontmatter(text);
  } catch (error) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (!match) throw error;
    const data: Record<string, unknown> = {};
    for (const line of (match[1] ?? "").split(/\r?\n/)) {
      if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
      const field = /^([A-Za-z0-9_-]+):[ \t]*(.*)$/.exec(line);
      if (!field || !field[1]) throw error;
      const value = (field[2] ?? "").trim();
      if (value === "" || /^[[{|>&*!]/.test(value)) throw error;
      data[field[1]] = value;
    }
    const strict = parseFrontmatter("---\n---\n");
    return { ...strict, data, content: text.slice(match[0].length), matter: match[1] ?? "" };
  }
}
