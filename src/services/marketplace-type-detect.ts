import { existsSync } from "node:fs";
import { join } from "node:path";
import type { PluginMarketplacePlatform } from "../config/settings.js";
import type { RunCommand } from "../plugins/run-command.js";
import { runCommandWithTimeout } from "../utils/run-command-with-timeout.js";
import { normalizeMarketplaceUrl } from "./marketplace-registry.js";

export const GH_DETECT_TIMEOUT_MS = 20_000;

export type MarketplaceTypeDetectStatus = "inferred" | "ambiguous" | "error";

export interface MarketplaceTypeDetectResult {
  status: MarketplaceTypeDetectStatus;
  platforms: PluginMarketplacePlatform[];
  manifests: string[];
  message: string;
}

export interface GithubContentsProbe {
  status: number;
}

export type FetchGithubContents = (
  owner: string,
  repo: string,
  path: string,
) => Promise<GithubContentsProbe>;

export interface DetectMarketplaceTypeOptions {
  runCommand?: RunCommand;
  fetchGithub?: FetchGithubContents;
}

interface ManifestCandidate {
  path: string;
  platform: PluginMarketplacePlatform | null;
}

export const MARKETPLACE_TYPE_CANDIDATES: readonly ManifestCandidate[] = [
  { path: ".claude-plugin/marketplace.json", platform: "claude-code" },
  { path: ".cursor-plugin/marketplace.json", platform: "cursor" },
  { path: ".github/plugin/marketplace.json", platform: "copilot-cli" },
  { path: ".codex-plugin/marketplace.json", platform: null },
  { path: "marketplace.json", platform: null },
];

const OWNER_REPO_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const GITHUB_SCP = /^(?:[^@/\s]+@)?github\.com:(.+)$/i;

export function parseGithubOwnerRepo(
  source: string,
): { owner: string; repo: string } | null {
  const trimmed = source.trim();
  if (!trimmed) {
    return null;
  }

  const scp = GITHUB_SCP.exec(trimmed);
  if (scp?.[1]) {
    return ownerRepoFromPath(`/${scp[1]}`);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  if (host !== "github.com") {
    return null;
  }
  return ownerRepoFromPath(parsed.pathname);
}

function ownerRepoFromPath(pathname: string): { owner: string; repo: string } | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) {
    return null;
  }
  const owner = parts[0];
  const repo = (parts[1] ?? "").replace(/\.git$/i, "");
  if (!owner || !repo || !OWNER_REPO_SEGMENT.test(owner) || !OWNER_REPO_SEGMENT.test(repo)) {
    return null;
  }
  return { owner, repo };
}

function looksLikeLocalPath(value: string): boolean {
  if (value.startsWith("file:")) return true;
  if (value.startsWith("/") || value.startsWith("./") || value.startsWith("../")) {
    return true;
  }
  if (value.startsWith("~/")) return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true;
  return false;
}

function platformLabel(platform: PluginMarketplacePlatform): string {
  switch (platform) {
    case "claude-code":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    case "goose":
      return "Goose";
    case "copilot-cli":
      return "Copilot CLI";
    default: {
      const _exhaustive: never = platform;
      return _exhaustive;
    }
  }
}

export function joinMarketplacePlatformLabels(
  platforms: readonly PluginMarketplacePlatform[],
): string {
  const labels = platforms.map(platformLabel);
  if (labels.length === 0) {
    return "";
  }
  if (labels.length === 1) {
    return labels[0] ?? "";
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

function resultFromManifests(manifests: string[]): MarketplaceTypeDetectResult {
  const platforms: PluginMarketplacePlatform[] = [];
  const seen = new Set<PluginMarketplacePlatform>();
  for (const relative of manifests) {
    const candidate = MARKETPLACE_TYPE_CANDIDATES.find((item) => item.path === relative);
    if (!candidate?.platform || seen.has(candidate.platform)) {
      continue;
    }
    seen.add(candidate.platform);
    platforms.push(candidate.platform);
  }

  if (platforms.length > 0) {
    return {
      status: "inferred",
      platforms,
      manifests,
      message: `Inferred: ${joinMarketplacePlatformLabels(platforms)}`,
    };
  }

  if (manifests.length === 1 && manifests[0] === "marketplace.json") {
    return {
      status: "ambiguous",
      platforms: [],
      manifests,
      message: "Could not tell marketplace type. Found marketplace.json at the repo root.",
    };
  }

  if (manifests.length > 0) {
    return {
      status: "ambiguous",
      platforms: [],
      manifests,
      message: `Could not tell marketplace type. Found ${manifests.join(", ")}.`,
    };
  }

  return {
    status: "error",
    platforms: [],
    manifests: [],
    message: "No marketplace manifest found.",
  };
}

function detectFromFilesystem(root: string): MarketplaceTypeDetectResult {
  const manifests = MARKETPLACE_TYPE_CANDIDATES
    .filter((candidate) => existsSync(join(root, candidate.path)))
    .map((candidate) => candidate.path);
  return resultFromManifests(manifests);
}

function runGh(
  runCommand: RunCommand,
  args: string[],
): ReturnType<RunCommand> {
  return runCommand("gh", args, { timeoutMs: GH_DETECT_TIMEOUT_MS });
}

function ghAvailable(runCommand: RunCommand): boolean {
  return runGh(runCommand, ["--version"]).exitCode === 0;
}

type RemoteProbe = "present" | "absent" | "auth" | "failed";

function classifyGithubFailure(stderr: string, stdout: string, status?: number): RemoteProbe {
  if (status === 401 || status === 403) {
    return "auth";
  }
  if (status === 404) {
    return "absent";
  }
  const text = `${stderr}\n${stdout}`;
  if (/401|403|Bad credentials|Requires authentication|HTTP\s*403|HTTP\s*401/i.test(text)) {
    return "auth";
  }
  if (/404|Not Found/i.test(text)) {
    return "absent";
  }
  return "failed";
}

function probeGhPath(
  runCommand: RunCommand,
  owner: string,
  repo: string,
  path: string,
): RemoteProbe {
  const result = runGh(runCommand, ["api", `repos/${owner}/${repo}/contents/${path}`]);
  if (result.exitCode === 0) {
    return "present";
  }
  return classifyGithubFailure(result.stderr, result.stdout);
}

function ghRepoReadable(runCommand: RunCommand, owner: string, repo: string): boolean {
  return runGh(runCommand, ["api", `repos/${owner}/${repo}`]).exitCode === 0;
}

async function defaultFetchGithub(
  owner: string,
  repo: string,
  path: string,
): Promise<GithubContentsProbe> {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/${encoded}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "HarnessTap",
      },
    },
  );
  return { status: response.status };
}

function classifyHttpStatus(status: number): RemoteProbe {
  if (status === 200) {
    return "present";
  }
  return classifyGithubFailure("", "", status);
}

async function probePublicPaths(
  fetchGithub: FetchGithubContents,
  owner: string,
  repo: string,
): Promise<string[]> {
  const manifests: string[] = [];
  for (const candidate of MARKETPLACE_TYPE_CANDIDATES) {
    const probe = classifyHttpStatus(
      (await fetchGithub(owner, repo, candidate.path)).status,
    );
    if (probe === "present") {
      manifests.push(candidate.path);
    }
  }
  return manifests;
}

function privateRepoMessage(usedGh: boolean): MarketplaceTypeDetectResult {
  return {
    status: "error",
    platforms: [],
    manifests: [],
    message: usedGh
      ? "Could not read this GitHub repo. For private repos, run gh auth login."
      : "Could not read this GitHub repo. Install GitHub CLI (gh) and run gh auth login for private repos.",
  };
}

async function detectFromGithub(
  owner: string,
  repo: string,
  options: DetectMarketplaceTypeOptions,
): Promise<MarketplaceTypeDetectResult> {
  const runCommand =
    options.runCommand
    ?? ((command, args, runOptions) =>
      runCommandWithTimeout(command, args, {
        ...runOptions,
        timeoutMs: GH_DETECT_TIMEOUT_MS,
      }));
  const fetchGithub = options.fetchGithub ?? defaultFetchGithub;
  const hasGh = ghAvailable(runCommand);

  if (hasGh) {
    const manifests: string[] = [];
    const probes: RemoteProbe[] = [];
    for (const candidate of MARKETPLACE_TYPE_CANDIDATES) {
      const probe = probeGhPath(runCommand, owner, repo, candidate.path);
      probes.push(probe);
      if (probe === "present") {
        manifests.push(candidate.path);
      }
    }
    if (manifests.length > 0) {
      return resultFromManifests(manifests);
    }
    if (ghRepoReadable(runCommand, owner, repo)) {
      return resultFromManifests([]);
    }
    const publicManifests = await probePublicPaths(fetchGithub, owner, repo);
    if (publicManifests.length > 0) {
      return resultFromManifests(publicManifests);
    }
    return privateRepoMessage(true);
  }

  const publicManifests = await probePublicPaths(fetchGithub, owner, repo);
  if (publicManifests.length > 0) {
    return resultFromManifests(publicManifests);
  }
  return privateRepoMessage(false);
}

export async function detectMarketplaceType(
  source: string,
  options: DetectMarketplaceTypeOptions = {},
): Promise<MarketplaceTypeDetectResult> {
  const trimmed = source.trim();
  if (!trimmed) {
    return {
      status: "error",
      platforms: [],
      manifests: [],
      message: "URL or path is required.",
    };
  }

  const normalized = normalizeMarketplaceUrl(trimmed);
  if (existsSync(normalized)) {
    return detectFromFilesystem(normalized);
  }

  if (looksLikeLocalPath(trimmed) || looksLikeLocalPath(normalized)) {
    return {
      status: "error",
      platforms: [],
      manifests: [],
      message: "Local path not found.",
    };
  }

  const github = parseGithubOwnerRepo(trimmed) ?? parseGithubOwnerRepo(normalized);
  if (github) {
    return detectFromGithub(github.owner, github.repo, options);
  }

  return {
    status: "error",
    platforms: [],
    manifests: [],
    message: "Detection supports a local folder or a GitHub URL.",
  };
}
