import semver from "semver";

const GIT_SHA = /^[0-9a-f]{7,40}$/i;

function gitBuildMetadata(sha: string | undefined): string | undefined {
  const trimmed = sha?.trim();
  if (!trimmed) {
    return undefined;
  }
  const compact = trimmed.replace(/[^0-9a-z]/gi, "").slice(0, 12).toLowerCase();
  if (!compact) {
    return undefined;
  }
  return compact;
}

/**
 * Map a plugin.json version or git SHA to a semver that Agent Plugins accepts.
 * Valid semver is kept. Anything else becomes `0.0.0+git.<sha12>` when a SHA
 * is available, otherwise `0.0.0`.
 */
export function semverSafePluginVersion(
  version: string | undefined,
  gitSha?: string,
): string {
  const trimmed = version?.trim();
  if (trimmed && semver.valid(trimmed)) {
    return trimmed;
  }
  const sha = gitBuildMetadata(trimmed && GIT_SHA.test(trimmed) ? trimmed : gitSha);
  if (sha) {
    return `0.0.0+git.${sha}`;
  }
  return "0.0.0";
}

export function pluginDescriptionFromManifest(
  description: string | undefined,
): string {
  return description?.trim() ?? "";
}
