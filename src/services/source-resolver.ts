import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { projectNameFromUrl } from "./git.js";

export interface GitRemoteSource {
  kind: "git";
  url: string;
  label: string;
  owner: string;
  repo: string;
}

export interface LocalRemoteSource {
  kind: "local";
  path: string;
  label: string;
}

export type ResolvedRemoteSource = GitRemoteSource | LocalRemoteSource;

const GITHUB_SHORTHAND = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function parseOwnerRepo(label: string): { owner: string; repo: string } {
  const [owner, repo] = label.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid source: ${label}`);
  }
  return { owner, repo };
}

export function resolveRemoteSource(input: string): ResolvedRemoteSource {
  const trimmed = input.trim();

  if (existsSync(trimmed)) {
    return {
      kind: "local",
      path: resolve(trimmed),
      label: basename(resolve(trimmed)),
    };
  }

  if (GITHUB_SHORTHAND.test(trimmed)) {
    const { owner, repo } = parseOwnerRepo(trimmed);
    return {
      kind: "git",
      url: `https://github.com/${owner}/${repo}.git`,
      label: trimmed,
      owner,
      repo,
    };
  }

  if (trimmed.startsWith("git@") || trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const label = projectNameFromUrl(trimmed);
    const { owner, repo } = parseOwnerRepo(label);
    const url = trimmed.endsWith(".git") ? trimmed : `${trimmed.replace(/\/$/, "")}.git`;
    return { kind: "git", url, label, owner, repo };
  }

  throw new Error(
    `Unrecognized source "${input}". Use owner/repo, a Git URL, or a local path.`,
  );
}

export function sourceCacheDir(harnessdeckDir: string, owner: string, repo: string): string {
  return `${harnessdeckDir}/cache/sources/${owner}/${repo}`;
}
