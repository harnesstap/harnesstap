import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  applyDesktopUpdate,
  detectCliInstallChannel,
  downloadDesktopInstaller,
  formatCliUpdateNotice,
  isNewerPublishedVersion,
  isUpdateLookupFresh,
  loadUpdateCheckCache,
  maybeNotifyCliUpdate,
  normalizeDesktopPlatform,
  resolvePublishedRelease,
  saveUpdateCheckCache,
  selectDesktopReleaseAsset,
  shouldSkipCliUpdateNotice,
  type DesktopReleaseAsset,
  type UpdateFetch,
} from "../../src/services/self-update.js";
import { tryHandle as trySelfUpdate } from "../../src/agent/parity-handlers/self-update.js";

const RELEASE_ASSETS: DesktopReleaseAsset[] = [
  { name: "HarnessTap_1.0.3_aarch64.dmg", browser_download_url: "https://example.test/aarch64.dmg" },
  { name: "HarnessTap_1.0.3_x64.dmg", browser_download_url: "https://example.test/x64.dmg" },
  { name: "HarnessTap_1.0.3_x64-setup.exe", browser_download_url: "https://example.test/x64.exe" },
  { name: "HarnessTap_1.0.3_arm64-setup.exe", browser_download_url: "https://example.test/arm64.exe" },
  { name: "HarnessTap_1.0.3_x64_en-US.msi", browser_download_url: "https://example.test/x64.msi" },
  { name: "HarnessTap_1.0.3_amd64.AppImage", browser_download_url: "https://example.test/amd64.AppImage" },
  { name: "HarnessTap_1.0.3_aarch64.AppImage", browser_download_url: "https://example.test/aarch64.AppImage" },
  { name: "HarnessTap_1.0.3_amd64.deb", browser_download_url: "https://example.test/amd64.deb" },
  { name: "HarnessTap-1.0.3-1.x86_64.rpm", browser_download_url: "https://example.test/x86_64.rpm" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function githubLatestBody(version = "v1.0.3") {
  return {
    tag_name: version,
    body: "## harnesstap v1.0.3\n\n### Fixed\n\n- Example fix\n",
    html_url: `https://github.com/harnesstap/harnesstap/releases/tag/${version}`,
    assets: RELEASE_ASSETS,
  };
}

describe("published version compare", () => {
  it("treats a higher semver as newer and strips the v prefix", () => {
    expect(isNewerPublishedVersion("v1.0.3", "1.0.2")).toBe(true);
    expect(isNewerPublishedVersion("1.0.2", "1.0.2")).toBe(false);
    expect(isNewerPublishedVersion("1.0.1", "1.0.2")).toBe(false);
    expect(isNewerPublishedVersion("not-a-version", "1.0.2")).toBe(false);
  });
});

describe("CLI install channel", () => {
  it("uses npm when the running script lives in node_modules", () => {
    expect(detectCliInstallChannel("/usr/lib/node_modules/harnesstap/dist/index.js", {})).toBe("npm");
    expect(detectCliInstallChannel("/opt/ht/bin/ht", { npm_package_name: "harnesstap" })).toBe("npm");
  });

  it("uses GitHub for a standalone binary install", () => {
    expect(detectCliInstallChannel("/Applications/HarnessTap.app/Contents/MacOS/ht", {})).toBe("github");
  });
});

describe("desktop asset selection", () => {
  it("picks the GitHub installer for the host os and arch", () => {
    expect(selectDesktopReleaseAsset(RELEASE_ASSETS, "macos", "arm64")?.name).toBe(
      "HarnessTap_1.0.3_aarch64.dmg",
    );
    expect(selectDesktopReleaseAsset(RELEASE_ASSETS, "macos", "x64")?.name).toBe(
      "HarnessTap_1.0.3_x64.dmg",
    );
    expect(selectDesktopReleaseAsset(RELEASE_ASSETS, "windows", "x64")?.name).toBe(
      "HarnessTap_1.0.3_x64-setup.exe",
    );
    expect(selectDesktopReleaseAsset(RELEASE_ASSETS, "windows", "arm64")?.name).toBe(
      "HarnessTap_1.0.3_arm64-setup.exe",
    );
    expect(selectDesktopReleaseAsset(RELEASE_ASSETS, "linux", "x64")?.name).toBe(
      "HarnessTap_1.0.3_amd64.AppImage",
    );
    expect(selectDesktopReleaseAsset(RELEASE_ASSETS, "linux", "arm64")?.name).toBe(
      "HarnessTap_1.0.3_aarch64.AppImage",
    );
  });

  it("falls back to MSI or deb when the preferred installer is missing", () => {
    expect(
      selectDesktopReleaseAsset(
        RELEASE_ASSETS.filter((asset) => !asset.name.endsWith("-setup.exe")),
        "windows",
        "x64",
      )?.name,
    ).toBe("HarnessTap_1.0.3_x64_en-US.msi");
    expect(
      selectDesktopReleaseAsset(
        RELEASE_ASSETS.filter((asset) => !asset.name.toLowerCase().endsWith(".appimage")),
        "linux",
        "x64",
      )?.name,
    ).toBe("HarnessTap_1.0.3_amd64.deb");
  });

  it("normalizes platform and arch aliases", () => {
    expect(normalizeDesktopPlatform("darwin", "aarch64")).toEqual({ os: "macos", arch: "arm64" });
    expect(normalizeDesktopPlatform("win32", "x86_64")).toEqual({ os: "windows", arch: "x64" });
    expect(normalizeDesktopPlatform("linux", "amd64")).toEqual({ os: "linux", arch: "x64" });
    expect(normalizeDesktopPlatform("freebsd", "x64")).toBeNull();
  });
});

describe("update lookup cache", () => {
  it("reuses a lookup that is at most one day old", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-update-cache-"));
    const now = new Date("2026-09-03T12:00:00.000Z");
    saveUpdateCheckCache(dir, {
      lastLookupAt: "2026-09-03T00:00:00.000Z",
      latestVersion: "1.0.3",
      latestNotes: "cached notes",
      latestHtmlUrl: "https://github.com/harnesstap/harnesstap/releases/tag/v1.0.3",
      assets: RELEASE_ASSETS,
      notifiedVersion: null,
    });
    const fetchFn = mock(() => {
      throw new Error("network should not run");
    }) as unknown as UpdateFetch;

    const release = await resolvePublishedRelease({
      channel: "github",
      harnesstapDir: dir,
      now,
      fetchFn,
    });

    expect(release?.version).toBe("1.0.3");
    expect(fetchFn).not.toHaveBeenCalled();
    expect(isUpdateLookupFresh(loadUpdateCheckCache(dir), now)).toBe(true);
  });

  it("looks up again after the daily cache expires", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-update-stale-"));
    saveUpdateCheckCache(dir, {
      lastLookupAt: "2026-09-01T12:00:00.000Z",
      latestVersion: "1.0.2",
      latestNotes: "",
      latestHtmlUrl: null,
      assets: [],
      notifiedVersion: "1.0.2",
    });
    const fetchFn: UpdateFetch = mock((input: string | URL) => {
      const url = String(input);
      if (url.includes("github.com")) {
        return Promise.resolve(jsonResponse(githubLatestBody()));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const release = await resolvePublishedRelease({
      channel: "github",
      harnesstapDir: dir,
      now: new Date("2026-09-03T12:00:00.000Z"),
      fetchFn,
    });

    expect(release?.version).toBe("1.0.3");
    expect(loadUpdateCheckCache(dir).latestVersion).toBe("1.0.3");
    expect(loadUpdateCheckCache(dir).notifiedVersion).toBe("1.0.2");
  });
});

describe("CLI update notice", () => {
  const previousExit = process.exitCode;

  afterEach(() => {
    process.exitCode = previousExit;
  });

  it("prints once per discovered version and stays quiet afterward", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-update-notice-"));
    const fetchFn: UpdateFetch = mock(() => Promise.resolve(jsonResponse(githubLatestBody())));
    const writes: string[] = [];
    const argv = ["node", "/opt/HarnessTap/ht", "plugin", "list"];

    const first = await maybeNotifyCliUpdate({
      argv,
      env: { HARNESSTAP_UPDATE_CHECK: "1", HARNESSTAP_UPDATE_CHANNEL: "github" },
      harnesstapDir: dir,
      currentVersion: "1.0.2",
      now: new Date("2026-09-03T12:00:00.000Z"),
      fetchFn,
      writeNotice: (message) => writes.push(message),
    });
    const second = await maybeNotifyCliUpdate({
      argv,
      env: { HARNESSTAP_UPDATE_CHECK: "1", HARNESSTAP_UPDATE_CHANNEL: "github" },
      harnesstapDir: dir,
      currentVersion: "1.0.2",
      now: new Date("2026-09-03T18:00:00.000Z"),
      fetchFn,
      writeNotice: (message) => writes.push(message),
    });

    expect(first?.latestVersion).toBe("1.0.3");
    expect(second).toBeNull();
    expect(writes).toEqual([
      formatCliUpdateNotice({
        currentVersion: "1.0.2",
        latestVersion: "1.0.3",
        channel: "github",
        installHint: "https://github.com/harnesstap/harnesstap/releases/tag/v1.0.3",
        htmlUrl: "https://github.com/harnesstap/harnesstap/releases/tag/v1.0.3",
      }),
    ]);
    expect(loadUpdateCheckCache(dir).notifiedVersion).toBe("1.0.3");
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("uses npm latest for an npm install", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-update-npm-"));
    const fetchFn: UpdateFetch = mock((input: string | URL) => {
      const url = String(input);
      if (url.includes("registry.npmjs.org")) {
        return Promise.resolve(jsonResponse({ version: "1.0.4" }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });
    const writes: string[] = [];

    const notice = await maybeNotifyCliUpdate({
      argv: ["node", "/usr/lib/node_modules/harnesstap/dist/index.js", "status"],
      env: { HARNESSTAP_UPDATE_CHECK: "1" },
      harnesstapDir: dir,
      currentVersion: "1.0.2",
      fetchFn,
      writeNotice: (message) => writes.push(message),
    });

    expect(notice?.channel).toBe("npm");
    expect(notice?.latestVersion).toBe("1.0.4");
    expect(writes[0]).toContain("npm install -g harnesstap@1.0.4");
  });

  it("does not fail the command when lookup errors", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-update-fail-"));
    const fetchFn: UpdateFetch = mock(() => Promise.reject(new Error("offline")));
    const writes: string[] = [];

    await expect(
      maybeNotifyCliUpdate({
        argv: ["node", "/usr/lib/node_modules/harnesstap/dist/index.js", "status"],
        env: { HARNESSTAP_UPDATE_CHECK: "1" },
        harnesstapDir: dir,
        currentVersion: "1.0.2",
        fetchFn,
        writeNotice: (message) => writes.push(message),
      }),
    ).resolves.toBeNull();
    expect(writes).toEqual([]);
  });

  it("skips JSON output and bun tests unless explicitly enabled", () => {
    expect(shouldSkipCliUpdateNotice(["ht", "plugin", "list", "--format", "json"], {})).toBe(true);
    expect(shouldSkipCliUpdateNotice(["ht", "plugin", "list"], { BUN_TEST: "1" })).toBe(true);
    expect(
      shouldSkipCliUpdateNotice(["ht", "plugin", "list"], {
        BUN_TEST: "1",
        HARNESSTAP_UPDATE_CHECK: "1",
      }),
    ).toBe(false);
  });
});

describe("desktop installer apply", () => {
  it("downloads the selected GitHub asset and launches it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-update-apply-"));
    mkdirSync(join(dir, "cache", "updates"), { recursive: true });
    const launched: string[] = [];
    const fetchFn: UpdateFetch = mock((input: string | URL) => {
      const url = String(input);
      if (url.includes("releases/latest")) {
        return Promise.resolve(jsonResponse(githubLatestBody()));
      }
      if (url.endsWith(".dmg")) {
        return Promise.resolve(new Response("dmg-bytes", { status: 200 }));
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const result = await applyDesktopUpdate({
      harnesstapDir: dir,
      currentVersion: "1.0.2",
      fetchFn,
      platform: "darwin",
      arch: "arm64",
      launch: (filePath) => launched.push(filePath),
    });

    expect(result.asset).toBe("HarnessTap_1.0.3_aarch64.dmg");
    expect(readFileSync(result.path, "utf-8")).toBe("dmg-bytes");
    expect(launched).toEqual([result.path]);
  });

  it("downloads through downloadDesktopInstaller without requiring a live release", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ht-update-dl-"));
    const fetchFn: UpdateFetch = mock(() => Promise.resolve(new Response("exe", { status: 200 })));
    const launched: string[] = [];
    const windowsSetup = RELEASE_ASSETS.find((asset) => asset.name.endsWith("_x64-setup.exe"));
    expect(windowsSetup).toBeDefined();
    if (!windowsSetup) {
      throw new Error("missing windows setup asset fixture");
    }
    const downloaded = await downloadDesktopInstaller({
      asset: windowsSetup,
      harnesstapDir: dir,
      fetchFn,
      launch: (filePath) => launched.push(filePath),
      platform: "win32",
    });
    expect(downloaded.path.endsWith("HarnessTap_1.0.3_x64-setup.exe")).toBe(true);
    expect(launched).toHaveLength(1);
  });
});

describe("agent self-update routes", () => {
  it("requires auth and leaves unrelated paths alone", async () => {
    const health = await trySelfUpdate(
      new Request("http://127.0.0.1/v1/health"),
      "token",
      { isAgentSwitchInProgress: () => false },
    );
    expect(health).toBeNull();

    const unauthorized = await trySelfUpdate(
      new Request("http://127.0.0.1/v1/app-update"),
      "token",
      { isAgentSwitchInProgress: () => false },
    );
    expect(unauthorized?.status).toBe(401);
  });
});
