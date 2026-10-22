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
