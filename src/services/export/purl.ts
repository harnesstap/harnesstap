import type { LockEntry } from "../lockfile.js";

const HOST_DOMAIN_TO_PURL: Record<string, string> = {
  "github.com": "github",
  "gitlab.com": "gitlab",
  "bitbucket.org": "bitbucket",
};

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment);
}

function encodePath(ownerRepo: string): string {
  return ownerRepo.split("/").map(encodeSegment).join("/");
}

function canonicalRepoPath(repoUrl: string): string {
  const scrubbed = scrubUrl(repoUrl);
  try {
    const parsed = new URL(scrubbed);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/i, "");
    if (parsed.protocol === "file:") {
      return path ? `file:///${path}` : scrubbed;
    }
    return host ? `${host}/${path}` : path;
  } catch {
    return scrubbed.replace(/^git@([^:]+):/, (_, host: string) => `${host.toLowerCase()}/`);
  }
}

function pathParts(repoUrl: string): string[] {
  return canonicalRepoPath(repoUrl).split("/").filter(Boolean);
}

function hostSegment(repoUrl: string): string {
  const parts = pathParts(repoUrl);
  const first = parts[0];
  if (first && first.includes(".")) {
    return first.toLowerCase();
  }
  return "";
}

function ownerRepo(repoUrl: string): string {
  const parts = pathParts(repoUrl);
  const first = parts[0];
  if (first && first.includes(".")) {
    return parts.slice(1).join("/");
  }
  return parts.join("/");
}

function basename(repoUrl: string): string {
  const path = ownerRepo(repoUrl);
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? repoUrl;
}

function purlTypeFor(entry: LockEntry, repoUrl: string): string | undefined {
  const host = hostSegment(repoUrl);
  const mapped = HOST_DOMAIN_TO_PURL[host];
  if (mapped) {
    return mapped;
  }
  // Host-less git identity keys treat GitHub as the implicit default, matching APM.
  if (entry.source === "git" && !host && ownerRepo(repoUrl).includes("/")) {
    return "github";
  }
  return undefined;
}

/**
 * Remove userinfo and query-string credentials from a recorded URL.
 * Scheme, host, port, path, and fragment are preserved.
 */
export function scrubUrl(url: string): string {
  if (!url) {
    return url;
  }

  try {
    const parsed = new URL(url);
    if (!parsed.username && !parsed.password && !parsed.search) {
      return url;
    }
    const port = parsed.port ? `:${parsed.port}` : "";
    return `${parsed.protocol}//${parsed.hostname}${port}${parsed.pathname}${parsed.hash}`;
  } catch {
    if (url.startsWith("git@") || url.startsWith("ssh://")) {
      const query = url.indexOf("?");
      return query === -1 ? url : url.slice(0, query);
    }
    const at = url.lastIndexOf("@");
    const hostStart = at !== -1 ? url.slice(at + 1) : url;
    const query = hostStart.indexOf("?");
    return query === -1 ? hostStart : hostStart.slice(0, query);
  }
}

function hashVersion(entry: LockEntry): string | undefined {
  return entry.content_hash || entry.integrity || undefined;
}

/**
 * Package URL identity from lockfile-recorded fields only.
 * Catalog/marketplace entries use a stable HT generic purl — never a fake OCI id.
 */
export function buildPurl(entry: LockEntry): string {
  const repoUrl = entry.repo_url ? scrubUrl(entry.repo_url) : "";

  if (entry.source === "local") {
    const name = encodeSegment(entry.name || (repoUrl ? basename(repoUrl) : "local"));
    const version = hashVersion(entry);
    return version ? `pkg:generic/${name}@${version}` : `pkg:generic/${name}`;
  }

  if (entry.source === "catalog" || entry.source === "marketplace") {
    const name = encodeSegment(entry.name || (repoUrl ? basename(repoUrl) : "catalog"));
    const version = hashVersion(entry) || entry.version;
    return version
      ? `pkg:generic/harnesstap/${name}@${version}`
      : `pkg:generic/harnesstap/${name}`;
  }

  if (entry.resolved_commit && repoUrl) {
    const purlType = purlTypeFor(entry, repoUrl);
    if (purlType) {
      return `pkg:${purlType}/${encodePath(ownerRepo(repoUrl))}@${entry.resolved_commit}`;
    }
    return `pkg:generic/${encodeSegment(basename(repoUrl))}@${entry.resolved_commit}`;
  }

  if (entry.resolved_commit) {
    return `pkg:generic/${encodeSegment(entry.name || "package")}@${entry.resolved_commit}`;
  }

  const name = encodeSegment(entry.name || (repoUrl ? basename(repoUrl) : "package"));
  const version = hashVersion(entry) || entry.version;
  return version ? `pkg:generic/${name}@${version}` : `pkg:generic/${name}`;
}

export function componentName(entry: LockEntry): string {
  if (entry.repo_url) {
    const path = ownerRepo(scrubUrl(entry.repo_url));
    if (path) {
      return path;
    }
  }
  return entry.name || "package";
}

export function componentVersion(entry: LockEntry): string | undefined {
  return (
    entry.version
    || entry.resolved_commit
    || entry.content_hash
    || entry.integrity
    || undefined
  );
}
