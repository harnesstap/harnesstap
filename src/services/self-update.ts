import { spawn } from "node:child_process";
import { chmodSync, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import semver from "semver";
import { getHarnesstapDir } from "../db/connection.js";
import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { PACKAGE_VERSION } from "../version.js";

export type UpdateFetch = (
  input: string | URL,
  init?: RequestInit & { timeoutMs?: number; retries?: number },
) => Promise<Response>;

export const GITHUB_REPO = "harnesstap/harnesstap";
export const GITHUB_LATEST_RELEASE_API =
  `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
export const NPM_LATEST_API = "https://registry.npmjs.org/harnesstap/latest";
export const NPM_PACKAGE_NAME = "harnesstap";

export const UPDATE_CHECK_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const UPDATE_LOOKUP_TIMEOUT_MS = 2_500;
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 120_000;

export type PublishedVersionChannel = "npm" | "github";
export type DesktopOs = "macos" | "windows" | "linux";
export type DesktopArch = "x64" | "arm64";

export interface DesktopReleaseAsset {
  name: string;
  browser_download_url: string;
}

export interface PublishedRelease {
  version: string;
  notes: string;
  htmlUrl: string;
  assets: DesktopReleaseAsset[];
}

export interface UpdateCheckCache {
  lastLookupAt: string | null;
  latestVersion: string | null;
  latestNotes: string | null;
  latestHtmlUrl: string | null;
  assets: DesktopReleaseAsset[];
  notifiedVersion: string | null;
}

export interface CliUpdateNotice {
  currentVersion: string;
  latestVersion: string;
  channel: PublishedVersionChannel;
  installHint: string;
  htmlUrl: string;
}

export interface DesktopUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  notes: string;
  htmlUrl: string;
  asset: DesktopReleaseAsset | null;
}

const EMPTY_CACHE: UpdateCheckCache = {
  lastLookupAt: null,
  latestVersion: null,
  latestNotes: null,
  latestHtmlUrl: null,
  assets: [],
  notifiedVersion: null,
};

const UPDATE_CHECK_FILENAME = "update-check.json";

export function updateCheckPath(harnesstapDir: string): string {
  return join(harnesstapDir, UPDATE_CHECK_FILENAME);
}

export function normalizePublishedVersion(version: string): string {
  const trimmed = version.trim();
  return trimmed.startsWith("v") || trimmed.startsWith("V")
    ? trimmed.slice(1)
    : trimmed;
}

export function isNewerPublishedVersion(latest: string, current: string): boolean {
  const latestVersion = normalizePublishedVersion(latest);
  const currentVersion = normalizePublishedVersion(current);
  if (!semver.valid(latestVersion) || !semver.valid(currentVersion)) {
    return false;
  }
  return semver.gt(latestVersion, currentVersion);
}

export function detectCliInstallChannel(
  scriptPath = process.argv[1] ?? "",
  env: NodeJS.ProcessEnv = process.env,
): PublishedVersionChannel {
  if (env.HARNESSTAP_UPDATE_CHANNEL === "npm" || env.HARNESSTAP_UPDATE_CHANNEL === "github") {
    return env.HARNESSTAP_UPDATE_CHANNEL;
  }
  if (env.npm_package_name === NPM_PACKAGE_NAME) {
    return "npm";
  }
  const normalized = scriptPath.replaceAll("\\", "/");
  if (
    normalized.includes("/node_modules/harnesstap/")
    || normalized.includes("/node_modules/.bin/")
    || normalized.includes("/_npx/")
    || normalized.includes("/.npm/_npx/")
  ) {
    return "npm";
  }
  return "github";
}

export function cliInstallHint(
  channel: PublishedVersionChannel,
  version: string,
): string {
  const normalized = normalizePublishedVersion(version);
  switch (channel) {
    case "npm":
      return `npm install -g ${NPM_PACKAGE_NAME}@${normalized}`;
    case "github":
      return `https://github.com/${GITHUB_REPO}/releases/tag/v${normalized}`;
    default: {
      const exhaustive: never = channel;
      return exhaustive;
    }
  }
}

export function githubReleaseHtmlUrl(version: string): string {
  return `https://github.com/${GITHUB_REPO}/releases/tag/v${normalizePublishedVersion(version)}`;
}

export function loadUpdateCheckCache(harnesstapDir: string): UpdateCheckCache {
  const path = updateCheckPath(harnesstapDir);
  if (!existsSync(path)) {
    return { ...EMPTY_CACHE };
  }
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<UpdateCheckCache>;
    const assets = Array.isArray(raw.assets)
      ? raw.assets.filter((asset): asset is DesktopReleaseAsset => (
        typeof asset?.name === "string"
        && typeof asset?.browser_download_url === "string"
      ))
      : [];
    return {
      lastLookupAt: typeof raw.lastLookupAt === "string" ? raw.lastLookupAt : null,
      latestVersion: typeof raw.latestVersion === "string" ? raw.latestVersion : null,
      latestNotes: typeof raw.latestNotes === "string" ? raw.latestNotes : null,
      latestHtmlUrl: typeof raw.latestHtmlUrl === "string" ? raw.latestHtmlUrl : null,
      assets,
      notifiedVersion: typeof raw.notifiedVersion === "string" ? raw.notifiedVersion : null,
    };
  } catch {
    return { ...EMPTY_CACHE };
  }
}

export function saveUpdateCheckCache(
  harnesstapDir: string,
  cache: UpdateCheckCache,
): void {
  mkdirSync(harnesstapDir, { recursive: true });
  writeFileSync(updateCheckPath(harnesstapDir), `${JSON.stringify(cache, null, 2)}\n`, "utf-8");
}

export function isUpdateLookupFresh(
  cache: UpdateCheckCache,
  now: Date = new Date(),
  maxAgeMs = UPDATE_CHECK_MAX_AGE_MS,
): boolean {
  if (!cache.lastLookupAt) {
    return false;
  }
  const lookedUp = Date.parse(cache.lastLookupAt);
  if (Number.isNaN(lookedUp)) {
    return false;
  }
  return now.getTime() - lookedUp <= maxAgeMs;
}

export function publishedReleaseUserAgent(): string {
  return `HarnessTap/${PACKAGE_VERSION} (+https://github.com/${GITHUB_REPO})`;
}

function githubHeaders(): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": publishedReleaseUserAgent(),
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function fetchNpmLatestVersion(
  fetchFn: UpdateFetch = fetchWithTimeout,
): Promise<string> {
  const response = await fetchFn(NPM_LATEST_API, {
    headers: { Accept: "application/json", "User-Agent": publishedReleaseUserAgent() },
    timeoutMs: UPDATE_LOOKUP_TIMEOUT_MS,
    retries: 0,
  });
  if (!response.ok) {
    throw new Error(`npm latest lookup failed (${response.status})`);
  }
  const body = (await response.json()) as { version?: unknown };
  if (typeof body.version !== "string" || body.version.trim().length === 0) {
    throw new Error("npm latest lookup returned no version");
  }
  return normalizePublishedVersion(body.version);
}

export async function fetchGithubLatestRelease(
  fetchFn: UpdateFetch = fetchWithTimeout,
): Promise<PublishedRelease> {
  const response = await fetchFn(GITHUB_LATEST_RELEASE_API, {
    headers: githubHeaders(),
    timeoutMs: UPDATE_LOOKUP_TIMEOUT_MS,
    retries: 0,
  });
  if (!response.ok) {
    throw new Error(`GitHub latest release lookup failed (${response.status})`);
  }
  const body = (await response.json()) as {
    tag_name?: unknown;
    body?: unknown;
    html_url?: unknown;
    assets?: unknown;
  };
  if (typeof body.tag_name !== "string" || body.tag_name.trim().length === 0) {
    throw new Error("GitHub latest release lookup returned no tag");
  }
  const version = normalizePublishedVersion(body.tag_name);
  const assets = Array.isArray(body.assets)
    ? body.assets.flatMap((asset): DesktopReleaseAsset[] => {
      if (!asset || typeof asset !== "object") {
        return [];
      }
      const record = asset as Record<string, unknown>;
      if (typeof record.name !== "string" || typeof record.browser_download_url !== "string") {
        return [];
      }
      return [{ name: record.name, browser_download_url: record.browser_download_url }];
    })
    : [];
  return {
    version,
    notes: typeof body.body === "string" ? body.body : "",
    htmlUrl: typeof body.html_url === "string" && body.html_url.length > 0
      ? body.html_url
      : githubReleaseHtmlUrl(version),
    assets,
  };
}

export async function lookupPublishedRelease(
  channel: PublishedVersionChannel,
  fetchFn: UpdateFetch = fetchWithTimeout,
): Promise<PublishedRelease> {
  switch (channel) {
    case "github":
      return fetchGithubLatestRelease(fetchFn);
    case "npm": {
      const version = await fetchNpmLatestVersion(fetchFn);
      try {
        const github = await fetchGithubLatestRelease(fetchFn);
        if (github.version === version) {
          return github;
        }
      } catch {
        // npm is the CLI source of truth; GitHub notes are optional.
      }
      return {
        version,
        notes: "",
        htmlUrl: githubReleaseHtmlUrl(version),
        assets: [],
      };
    }
    default: {
      const exhaustive: never = channel;
      return exhaustive;
    }
  }
}

export function releaseFromCache(cache: UpdateCheckCache): PublishedRelease | null {
  if (!cache.latestVersion) {
    return null;
  }
  return {
    version: cache.latestVersion,
    notes: cache.latestNotes ?? "",
    htmlUrl: cache.latestHtmlUrl ?? githubReleaseHtmlUrl(cache.latestVersion),
    assets: cache.assets,
  };
}

export async function resolvePublishedRelease(options: {
  channel: PublishedVersionChannel;
  harnesstapDir?: string;
  now?: Date;
  fetchFn?: UpdateFetch;
  forceRefresh?: boolean;
}): Promise<PublishedRelease | null> {
  const harnesstapDir = options.harnesstapDir ?? getHarnesstapDir();
  const now = options.now ?? new Date();
  const cache = loadUpdateCheckCache(harnesstapDir);
  if (!options.forceRefresh && isUpdateLookupFresh(cache, now)) {
    return releaseFromCache(cache);
  }

  try {
    const release = await lookupPublishedRelease(
      options.channel,
      options.fetchFn ?? fetchWithTimeout,
    );
    saveUpdateCheckCache(harnesstapDir, {
      ...cache,
      lastLookupAt: now.toISOString(),
      latestVersion: release.version,
      latestNotes: release.notes,
      latestHtmlUrl: release.htmlUrl,
      assets: release.assets,
    });
    return release;
  } catch {
    return releaseFromCache(cache);
  }
}

export function formatCliUpdateNotice(notice: CliUpdateNotice): string {
  return (
    `A newer HarnessTap CLI is available: ${notice.currentVersion} → ${notice.latestVersion}. ` +
    `Install: ${notice.installHint}`
  );
}

export function shouldSkipCliUpdateNotice(
  argv: string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.HARNESSTAP_SKIP_UPDATE_CHECK === "1" || env.HARNESSTAP_SKIP_UPDATE_CHECK === "true") {
    return true;
  }
  if (env.HARNESSTAP_UPDATE_CHECK !== "1" && (Boolean(env.BUN_TEST) || env.NODE_ENV === "test")) {
    return true;
  }
  const args = argv.slice(2);
  if (args[0] === "__complete" || args[0] === "completion") {
    return true;
  }
  if (args.includes("--json")) {
    return true;
  }
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--format" && args[index + 1] === "json") {
      return true;
    }
    if (token === "--format=json") {
      return true;
    }
  }
  return false;
}

export async function maybeNotifyCliUpdate(options: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  harnesstapDir?: string;
  currentVersion?: string;
  now?: Date;
  fetchFn?: UpdateFetch;
  writeNotice?: (message: string) => void;
} = {}): Promise<CliUpdateNotice | null> {
  const argv = options.argv ?? process.argv;
  const env = options.env ?? process.env;
  if (shouldSkipCliUpdateNotice(argv, env)) {
    return null;
  }
  if (typeof process.exitCode === "number" && process.exitCode !== 0) {
    return null;
  }

  try {
    const harnesstapDir = options.harnesstapDir ?? getHarnesstapDir();
    const currentVersion = options.currentVersion ?? PACKAGE_VERSION;
    const channel = detectCliInstallChannel(argv[1], env);
    const release = await resolvePublishedRelease({
      channel,
      harnesstapDir,
      now: options.now,
      fetchFn: options.fetchFn,
    });
    if (!release || !isNewerPublishedVersion(release.version, currentVersion)) {
      return null;
    }

    const cache = loadUpdateCheckCache(harnesstapDir);
    if (cache.notifiedVersion === release.version) {
      return null;
    }

    const notice: CliUpdateNotice = {
      currentVersion: normalizePublishedVersion(currentVersion),
      latestVersion: release.version,
      channel,
      installHint: cliInstallHint(channel, release.version),
      htmlUrl: release.htmlUrl,
    };
    const writeNotice = options.writeNotice ?? ((message: string) => {
      console.error(message);
    });
    writeNotice(formatCliUpdateNotice(notice));
    saveUpdateCheckCache(harnesstapDir, {
      ...loadUpdateCheckCache(harnesstapDir),
      notifiedVersion: release.version,
    });
    return notice;
  } catch {
    return null;
  }
}

export function normalizeDesktopPlatform(
  platform: NodeJS.Platform | string,
  arch: string,
): { os: DesktopOs; arch: DesktopArch } | null {
  let os: DesktopOs;
  switch (platform) {
    case "darwin":
    case "macos":
      os = "macos";
      break;
    case "win32":
    case "windows":
      os = "windows";
      break;
    case "linux":
      os = "linux";
      break;
    default:
      return null;
  }

  const normalizedArch = arch === "x86_64" || arch === "amd64" || arch === "ia32"
    ? "x64"
    : arch === "aarch64" || arch === "arm64"
      ? "arm64"
      : arch === "x64"
        ? "x64"
        : null;
  if (!normalizedArch) {
    return null;
  }
  return { os, arch: normalizedArch };
}

function assetNameMatches(name: string, suffix: string): boolean {
  return name.toLowerCase().endsWith(suffix.toLowerCase());
}

export function selectDesktopReleaseAsset(
  assets: DesktopReleaseAsset[],
  os: DesktopOs,
  arch: DesktopArch,
): DesktopReleaseAsset | null {
  const preferred: string[] = [];
  switch (os) {
    case "macos":
      preferred.push(arch === "arm64" ? "_aarch64.dmg" : "_x64.dmg");
      break;
    case "windows":
      preferred.push(
        arch === "arm64" ? "_arm64-setup.exe" : "_x64-setup.exe",
        arch === "arm64" ? "_arm64_en-us.msi" : "_x64_en-us.msi",
        arch === "arm64" ? "_arm64.msi" : "_x64.msi",
      );
      break;
    case "linux":
      preferred.push(
        arch === "arm64" ? "_aarch64.appimage" : "_amd64.appimage",
        arch === "arm64" ? "_arm64.appimage" : "_x86_64.appimage",
        arch === "arm64" ? "_arm64.deb" : "_amd64.deb",
        arch === "arm64" ? "_aarch64.rpm" : "_x86_64.rpm",
      );
      break;
    default: {
      const exhaustive: never = os;
      return exhaustive;
    }
  }

  for (const suffix of preferred) {
    const match = assets.find((asset) => assetNameMatches(asset.name, suffix));
    if (match) {
      return match;
    }
  }
  return null;
}

export function desktopUpdateStatus(options: {
  currentVersion?: string;
  release: PublishedRelease | null;
  platform?: NodeJS.Platform | string;
  arch?: string;
}): DesktopUpdateStatus {
  const currentVersion = normalizePublishedVersion(options.currentVersion ?? PACKAGE_VERSION);
  const release = options.release;
  if (!release) {
    return {
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      notes: "",
      htmlUrl: `https://github.com/${GITHUB_REPO}/releases/latest`,
      asset: null,
    };
  }

  const platform = normalizeDesktopPlatform(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  );
  const asset = platform
    ? selectDesktopReleaseAsset(release.assets, platform.os, platform.arch)
    : null;
  return {
    currentVersion,
    latestVersion: release.version,
    updateAvailable: isNewerPublishedVersion(release.version, currentVersion),
    notes: release.notes,
    htmlUrl: release.htmlUrl,
    asset,
  };
}

export async function resolveDesktopUpdateStatus(options: {
  harnesstapDir?: string;
  currentVersion?: string;
  now?: Date;
  fetchFn?: UpdateFetch;
  platform?: NodeJS.Platform | string;
  arch?: string;
} = {}): Promise<DesktopUpdateStatus> {
  const release = await resolvePublishedRelease({
    channel: "github",
    harnesstapDir: options.harnesstapDir,
    now: options.now,
    fetchFn: options.fetchFn,
  });
  return desktopUpdateStatus({
    currentVersion: options.currentVersion,
    release,
    platform: options.platform,
    arch: options.arch,
  });
}

export function updatesCacheDir(harnesstapDir: string): string {
  return join(harnesstapDir, "cache", "updates");
}

export function launchDownloadedInstaller(
  filePath: string,
  platform: NodeJS.Platform | string = process.platform,
): void {
  const detached = { detached: true, stdio: "ignore" as const };
  if (platform === "darwin" || platform === "macos") {
    spawn("open", [filePath], detached).unref();
    return;
  }
  if (platform === "win32" || platform === "windows") {
    spawn(filePath, [], detached).unref();
    return;
  }
  spawn("xdg-open", [filePath], detached).unref();
}

export async function downloadDesktopInstaller(options: {
  asset: DesktopReleaseAsset;
  harnesstapDir?: string;
  fetchFn?: UpdateFetch;
  launch?: (filePath: string) => void;
  platform?: NodeJS.Platform | string;
}): Promise<{ path: string; launched: boolean }> {
  const harnesstapDir = options.harnesstapDir ?? getHarnesstapDir();
  const destDir = updatesCacheDir(harnesstapDir);
  mkdirSync(destDir, { recursive: true });
  const destPath = join(destDir, options.asset.name);
  const fetchFn = options.fetchFn ?? fetchWithTimeout;
  const response = await fetchFn(options.asset.browser_download_url, {
    headers: githubHeaders(),
    timeoutMs: UPDATE_DOWNLOAD_TIMEOUT_MS,
    retries: 0,
    redirect: "follow",
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${options.asset.name} (${response.status})`);
  }

  const nodeStream = "getReader" in response.body
    ? Readable.fromWeb(response.body as WebReadableStream)
    : Readable.from(Buffer.from(await response.arrayBuffer()));
  await pipeline(nodeStream, createWriteStream(destPath));

  if (options.asset.name.toLowerCase().endsWith(".appimage")) {
    chmodSync(destPath, 0o755);
  }

  const launch = options.launch ?? ((filePath: string) => {
    launchDownloadedInstaller(filePath, options.platform);
  });
  launch(destPath);
  return { path: destPath, launched: true };
}

export async function applyDesktopUpdate(options: {
  harnesstapDir?: string;
  currentVersion?: string;
  fetchFn?: UpdateFetch;
  launch?: (filePath: string) => void;
  platform?: NodeJS.Platform | string;
  arch?: string;
} = {}): Promise<{ version: string; asset: string; path: string }> {
  const status = await resolveDesktopUpdateStatus(options);
  if (!status.updateAvailable || !status.asset || !status.latestVersion) {
    throw new Error("No matching Desktop installer is available for this machine");
  }
  const downloaded = await downloadDesktopInstaller({
    asset: status.asset,
    harnesstapDir: options.harnesstapDir,
    fetchFn: options.fetchFn,
    launch: options.launch,
    platform: options.platform,
  });
  return {
    version: status.latestVersion,
    asset: status.asset.name,
    path: downloaded.path,
  };
}
