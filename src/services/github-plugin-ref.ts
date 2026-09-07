export class GitPluginImportError extends Error {
  readonly code:
    | "invalid_ref"
    | "clone_failed"
    | "missing_plugin_json"
    | "name_conflict";

  constructor(
    code: GitPluginImportError["code"],
    message: string,
  ) {
    super(message);
    this.name = "GitPluginImportError";
    this.code = code;
  }
}

export const MISSING_PLUGIN_JSON_MESSAGE =
  "No plugin.json found at the repository root. Import currently supports Agent Plugins packages only; scanning the tree as loose resources is not available yet.";

const OWNER_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const GH_PREFIX = /^gh:/i;

function invalidRef(input: string): GitPluginImportError {
  return new GitPluginImportError(
    "invalid_ref",
    `Unrecognized GitHub plugin source "${input}". Use https://github.com/owner/repo, owner/repo, or gh:owner/repo.`,
  );
}

function ownerRepoFromPath(pathname: string): { owner: string; repo: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const owner = parts[0];
  const repo = (parts[1] ?? "").replace(/\.git$/i, "");
  if (!owner || !repo || !OWNER_REPO.test(`${owner}/${repo}`)) {
    return null;
  }
  return { owner, repo };
}

/** Canonical clone URL stored as the git origin locator. */
export function normalizeGitHubPluginUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw invalidRef(input);
  }

  const withoutGh = GH_PREFIX.test(trimmed) ? trimmed.replace(GH_PREFIX, "") : trimmed;
  const candidate = withoutGh.trim();

  if (OWNER_REPO.test(candidate.replace(/\.git$/i, ""))) {
    const [owner, repo] = candidate.replace(/\.git$/i, "").split("/");
    if (!owner || !repo) {
      throw invalidRef(input);
    }
    return `https://github.com/${owner}/${repo}.git`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw invalidRef(input);
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "github.com" || (parsed.protocol !== "https:" && parsed.protocol !== "http:")) {
    throw invalidRef(input);
  }

  const pair = ownerRepoFromPath(parsed.pathname);
  if (!pair) {
    throw invalidRef(input);
  }
  return `https://github.com/${pair.owner}/${pair.repo}.git`;
}

export function isGitHubPluginRef(input: string): boolean {
  try {
    normalizeGitHubPluginUrl(input);
    return true;
  } catch {
    return false;
  }
}
