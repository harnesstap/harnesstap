/**
 * Agent Plugins §5.5 package-name rules: 1-64 characters from `a-z0-9-.`,
 * alphanumeric first and last, no `--` and no `..`.
 *
 * These apply to the package name only. Local plugin names stay unrestricted,
 * which is why the slug is stored as an overridable column rather than
 * recomputed on every export: republish must be stable.
 */
const AP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9.-]{0,62}[a-z0-9])?$/;

export const AP_NAME_MAX_LENGTH = 64;

export function isValidApName(name: string): boolean {
  if (!AP_NAME_PATTERN.test(name)) return false;
  return !name.includes("--") && !name.includes("..");
}

/**
 * Agent Skills name: 1-64 chars, lowercase letters, digits, and single hyphens.
 * Must not start or end with a hyphen. The directory name must match.
 */
const AGENT_SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidAgentSkillName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && AGENT_SKILL_NAME.test(name);
}

export function slugifyAgentSkillName(source: string): string {
  let slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (slug.length > 64) {
    slug = slug.slice(0, 64).replace(/-+$/, "");
  }
  return slug.length > 0 ? slug : "skill";
}

export function slugifyApName(source: string): string {
  let slug = source
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");

  if (slug.length > AP_NAME_MAX_LENGTH) {
    slug = slug.slice(0, AP_NAME_MAX_LENGTH).replace(/[^a-z0-9]+$/, "");
  }

  return slug.length > 0 ? slug : "plugin";
}
