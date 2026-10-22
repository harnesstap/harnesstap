import semver from "semver";
import { parseGitDependencyConstraint } from "../utils/git-dependency-constraint.js";
import { resolveApmGitDependency } from "./apm-git-resolve.js";

export type ResolveSemverTag = (url: string, range: string) => Promise<string>;

/** Pick the highest tag that satisfies `range`, the same way APM git dependencies do. */
export async function resolveSemverTagFromRemote(url: string, range: string): Promise<string> {
  const exact = semver.valid(range);
  const resolution = await resolveApmGitDependency({
    raw: url,
    sourceKind: "git",
    name: url,
    originRef: url,
    applySelector: url,
    ref: exact ? `=${exact}` : range,
  });
  if (!resolution.resolvedTag) {
    throw new Error(`No git tag satisfies ${range} for ${url}`);
  }
  return resolution.resolvedTag;
}

/**
 * What to check out for a git pin (#500): `fetchRef` is the commit, tag or
 * branch handed to git (undefined for the default branch HEAD), and
 * `pinnedRef` is the pin as written, stored on the origin locator.
 * A semver range resolves to the highest matching tag.
 */
export async function gitFetchRefForPin(
  url: string,
  rawRef: string | undefined,
  resolveSemverTag: ResolveSemverTag = resolveSemverTagFromRemote,
): Promise<{ fetchRef?: string; pinnedRef?: string }> {
  const pin = parseGitDependencyConstraint(rawRef);
  switch (pin.kind) {
    case "none":
      return {};
    case "commit":
      return { fetchRef: pin.sha, pinnedRef: pin.sha };
    case "ref":
      return { fetchRef: pin.ref, pinnedRef: pin.ref };
    case "semver":
      return { fetchRef: await resolveSemverTag(url, pin.range), pinnedRef: pin.range };
    default: {
      const _exhaustive: never = pin;
      return _exhaustive;
    }
  }
}
