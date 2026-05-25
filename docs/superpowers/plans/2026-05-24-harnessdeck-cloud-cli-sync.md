# HarnessDeck Cloud CLI Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add HarnessDeck Cloud auth, org context, and preset search/install/publish workflows to the existing `harnessdeck` CLI without changing the local `project apply` model.

**Architecture:** Keep cloud state file-based under `HARNESSDECK_HOME` / `~/.harnessdeck`, add a shared cloud client for auth + authenticated requests, wire a small `cloud` command group for session/context, and extend `preset` with remote content verbs. Reuse the existing bundle exporter/importer and temp-bundle pipeline so cloud installs land in the same local preset store that `project apply` already consumes.

**Tech Stack:** TypeScript, Commander, Node 20 fetch/Response APIs, better-sqlite3, Bun, Vitest

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/config/cloud-profiles.ts` | File-backed cloud profile store under `~/.harnessdeck` / `HARNESSDECK_HOME` |
| `src/services/cloud-client.ts` | Device-code auth, token refresh, whoami/org/search/install/publish HTTP helpers |
| `src/services/preset-source.ts` | Shared temp-bundle writer reused by URL fetches and cloud installs |
| `src/services/exporter.ts` | Add preset-name override support for cloud installs using `--as` |
| `src/index.ts` | Wire `cloud` commands plus `preset search/install/publish` into the existing CLI |
| `test/config/cloud-profiles.test.ts` | Cloud profile file-store round-trip and active-profile behavior |
| `test/services/cloud-client.test.ts` | Cloud client auth, refresh, and error handling with mocked fetch |
| `test/services/exporter.test.ts` | Import override for cloud installs |
| `test/cli/cloud.test.ts` | `cloud login/logout/whoami/orgs` CLI behavior |
| `test/cli/preset-cloud.test.ts` | `preset search/install/publish` CLI behavior and unchanged `project apply` follow-through |
| `test/cli/help-organization.test.ts` | Top-level help includes the new `cloud` group and subcommands |
| `test/cli/output-format.test.ts` | JSON output coverage for cloud-aware structured commands |
| `README.md` | User-facing command examples and data-location docs for cloud profiles |

---

### Task 1: Add file-backed cloud profile storage

**Files:**
- Create: `src/config/cloud-profiles.ts`
- Test: `test/config/cloud-profiles.test.ts`

- [ ] **Step 1: Write the failing profile-store tests**

`test/config/cloud-profiles.test.ts`

```ts
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

const ORIGINAL_HOME = process.env.HARNESSDECK_HOME;

function useTempHarnessdeckHome(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.env.HARNESSDECK_HOME = dir;
  return dir;
}

afterEach(() => {
  if (ORIGINAL_HOME === undefined) {
    delete process.env.HARNESSDECK_HOME;
  } else {
    process.env.HARNESSDECK_HOME = ORIGINAL_HOME;
  }
});

describe("cloud profile store", () => {
  it("round-trips a saved profile under HARNESSDECK_HOME", async () => {
    useTempHarnessdeckHome("hd-cloud-profiles-");
    const store = await import("../../src/config/cloud-profiles.ts");

    store.saveCloudProfile("default", {
      cloudBaseUrl: "https://cloud.harnessdeck.dev",
      userId: "user_1",
      userEmail: "dev@example.com",
      orgId: "org_1",
      orgSlug: "acme",
      scopes: ["read", "publish"],
      accessToken: "access-1",
      accessTokenExpiresAt: "2026-05-24T12:00:00Z",
      refreshToken: "refresh-1",
      refreshTokenExpiresAt: "2026-06-24T12:00:00Z",
    });

    expect(store.loadCloudProfiles()).toMatchObject({
      default_profile: "default",
      profiles: {
        default: expect.objectContaining({
          cloudBaseUrl: "https://cloud.harnessdeck.dev",
          orgSlug: "acme",
          scopes: ["read", "publish"],
        }),
      },
    });
  });

  it("updates the default profile and removes token material on logout", async () => {
    useTempHarnessdeckHome("hd-cloud-profiles-");
    const store = await import("../../src/config/cloud-profiles.ts");

    store.saveCloudProfile("work", {
      cloudBaseUrl: "https://cloud.harnessdeck.dev",
      orgSlug: "acme",
      scopes: ["read"],
      accessToken: "access-1",
      accessTokenExpiresAt: "2026-05-24T12:00:00Z",
      refreshToken: "refresh-1",
    });
    store.setDefaultCloudProfile("work");
    store.clearCloudTokens("work");

    expect(store.getCloudProfile("work")).toEqual(
      expect.objectContaining({
        profileName: "work",
        profile: expect.objectContaining({
          cloudBaseUrl: "https://cloud.harnessdeck.dev",
          orgSlug: "acme",
          accessToken: undefined,
          refreshToken: undefined,
        }),
      }),
    );
  });
});
```

- [ ] **Step 2: Run the config test and verify it fails**

Run: `bun run test:run test/config/cloud-profiles.test.ts`

Expected: FAIL because `src/config/cloud-profiles.ts` does not exist yet.

- [ ] **Step 3: Implement the cloud profile store**

`src/config/cloud-profiles.ts`

```ts
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { getHarnessdeckDir } from "../db/connection.js";

export interface CloudProfile {
  cloudBaseUrl: string;
  userId?: string;
  userEmail?: string;
  userName?: string;
  orgId?: string;
  orgSlug?: string;
  scopes: string[];
  accessToken?: string;
  accessTokenExpiresAt?: string;
  refreshToken?: string;
  refreshTokenExpiresAt?: string;
}

export interface CloudProfileStoreFile {
  default_profile: string;
  profiles: Record<string, CloudProfile>;
}

const DEFAULT_STORE: CloudProfileStoreFile = {
  default_profile: "default",
  profiles: {},
};

export function getCloudProfilesPath(): string {
  return join(getHarnessdeckDir(), "cloud-profiles.json");
}

export function loadCloudProfiles(): CloudProfileStoreFile {
  const path = getCloudProfilesPath();
  if (!existsSync(path)) return DEFAULT_STORE;
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as Partial<CloudProfileStoreFile>;
  return {
    default_profile: parsed.default_profile ?? "default",
    profiles: parsed.profiles ?? {},
  };
}

function writeStore(store: CloudProfileStoreFile): void {
  const dir = getHarnessdeckDir();
  const path = getCloudProfilesPath();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2), "utf-8");
  chmodSync(path, 0o600);
}

export function saveCloudProfile(profileName: string, profile: CloudProfile): CloudProfileStoreFile {
  const store = loadCloudProfiles();
  const next: CloudProfileStoreFile = {
    default_profile: store.default_profile || profileName,
    profiles: { ...store.profiles, [profileName]: profile },
  };
  if (!next.default_profile) next.default_profile = profileName;
  writeStore(next);
  return next;
}

export function setDefaultCloudProfile(profileName: string): void {
  const store = loadCloudProfiles();
  writeStore({ ...store, default_profile: profileName });
}

export function getCloudProfile(profileName?: string): {
  profileName: string;
  profile: CloudProfile;
} {
  const store = loadCloudProfiles();
  const resolvedName = profileName ?? store.default_profile;
  const profile = store.profiles[resolvedName];
  if (!profile) {
    throw new Error(`Cloud profile not found: ${resolvedName}`);
  }
  return { profileName: resolvedName, profile };
}

export function updateCloudProfile(
  profileName: string,
  patch: Partial<CloudProfile>,
): CloudProfile {
  const current = getCloudProfile(profileName).profile;
  const merged = { ...current, ...patch };
  saveCloudProfile(profileName, merged);
  return merged;
}

export function clearCloudTokens(profileName: string): void {
  updateCloudProfile(profileName, {
    accessToken: undefined,
    accessTokenExpiresAt: undefined,
    refreshToken: undefined,
    refreshTokenExpiresAt: undefined,
  });
}

export function removeCloudProfile(profileName: string): void {
  const store = loadCloudProfiles();
  const { [profileName]: _, ...rest } = store.profiles;
  writeStore({
    default_profile:
      store.default_profile === profileName ? Object.keys(rest)[0] ?? "default" : store.default_profile,
    profiles: rest,
  });
}
```

- [ ] **Step 4: Re-run the config test and verify it passes**

Run: `bun run test:run test/config/cloud-profiles.test.ts`

Expected: PASS with both profile round-trip tests green.

- [ ] **Step 5: Commit**

```bash
git add src/config/cloud-profiles.ts test/config/cloud-profiles.test.ts
git commit -m $'feat: add cloud profile store\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

---

### Task 2: Add the shared cloud client and temp-bundle helper

**Files:**
- Create: `src/services/cloud-client.ts`
- Modify: `src/services/preset-source.ts`
- Test: `test/services/cloud-client.test.ts`

- [ ] **Step 1: Write the failing cloud-client tests**

`test/services/cloud-client.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import type { CloudProfile } from "../../src/config/cloud-profiles.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("cloud client", () => {
  it("polls device auth until a token is issued", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          device_code: "device-1",
          user_code: "ABCD-1234",
          verification_uri: "https://cloud.harnessdeck.dev/cli/auth/device",
          verification_uri_complete:
            "https://cloud.harnessdeck.dev/cli/auth/device?user_code=ABCD-1234",
          expires_in: 600,
          interval: 0,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
          orgId: "org_1",
          orgSlug: "acme",
          scopes: ["read", "publish"],
        }),
      );

    const client = await import("../../src/services/cloud-client.ts");
    const device = await client.requestDeviceCode("https://cloud.harnessdeck.dev", {
      fetchImpl: fetchMock as typeof fetch,
    });
    const token = await client.pollDeviceToken(
      "https://cloud.harnessdeck.dev",
      device.device_code,
      {
        intervalSeconds: device.interval,
        fetchImpl: fetchMock as typeof fetch,
        sleep: async () => undefined,
      },
    );

    expect(token).toMatchObject({
      access_token: "access-1",
      refresh_token: "refresh-1",
      orgSlug: "acme",
    });
  });

  it("refreshes an expired profile before searching libraries", async () => {
    const updates: CloudProfile[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
          orgId: "org_1",
          orgSlug: "acme",
          scopes: ["read", "publish"],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse([
          { slug: "starter", name: "Starter", latestVersion: "1.2.3", tags: ["team"] },
        ]),
      );

    const clientModule = await import("../../src/services/cloud-client.ts");
    const client = clientModule.createCloudClient({
      profileName: "default",
      profile: {
        cloudBaseUrl: "https://cloud.harnessdeck.dev",
        orgId: "org_1",
        orgSlug: "acme",
        scopes: ["read"],
        accessToken: "expired-access",
        accessTokenExpiresAt: "2000-01-01T00:00:00.000Z",
        refreshToken: "refresh-1",
      },
      onProfileUpdate(next) {
        updates.push(next);
      },
      fetchImpl: fetchMock as typeof fetch,
    });

    const results = await client.searchLibraries({ query: "starter" });

    expect(results[0]?.slug).toBe("starter");
    expect(updates[0]?.accessToken).toBe("access-2");
  });
});
```

- [ ] **Step 2: Run the service test and verify it fails**

Run: `bun run test:run test/services/cloud-client.test.ts`

Expected: FAIL because `src/services/cloud-client.ts` does not exist yet.

- [ ] **Step 3: Implement the cloud client and shared temp-bundle writer**

`src/services/cloud-client.ts`

```ts
import type { ExportBundle } from "../types.js";
import type { CloudProfile } from "../config/cloud-profiles.js";

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

export interface DeviceTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  orgId: string;
  orgSlug: string;
  scopes: string[];
}

export interface CloudClientOptions {
  profileName: string;
  profile: CloudProfile;
  onProfileUpdate: (next: CloudProfile) => void;
  fetchImpl?: typeof fetch;
}

export async function requestDeviceCode(
  baseUrl: string,
  opts: { fetchImpl?: typeof fetch } = {},
): Promise<DeviceCodeResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const response = await fetchImpl(`${baseUrl}/api/cli/device/code`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scopes: ["read", "publish", "admin"] }),
  });
  return (await response.json()) as DeviceCodeResponse;
}

export async function pollDeviceToken(
  baseUrl: string,
  deviceCode: string,
  opts: {
    intervalSeconds: number;
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<DeviceTokenResponse> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let intervalSeconds = opts.intervalSeconds;

  for (;;) {
    const response = await fetchImpl(`${baseUrl}/api/cli/device/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_code: deviceCode }),
    });

    if (response.ok) {
      return (await response.json()) as DeviceTokenResponse;
    }

    const errorBody = (await response.json()) as { error?: string };
    if (errorBody.error === "authorization_pending") {
      await sleep(intervalSeconds * 1000);
      continue;
    }
    if (errorBody.error === "slow_down") {
      intervalSeconds += 5;
      await sleep(intervalSeconds * 1000);
      continue;
    }
    throw new Error(errorBody.error ?? `Device flow failed (${response.status})`);
  }
}

function isExpired(iso: string | undefined): boolean {
  return !iso || Date.parse(iso) <= Date.now();
}

export function createCloudClient(opts: CloudClientOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let profile = opts.profile;

  async function refreshIfNeeded(): Promise<void> {
    if (!isExpired(profile.accessTokenExpiresAt)) return;
    if (!profile.refreshToken) {
      throw new Error(`Cloud login required for profile ${opts.profileName}`);
    }

    const response = await fetchImpl(`${profile.cloudBaseUrl}/api/cli/token/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refresh_token: profile.refreshToken }),
    });
    if (!response.ok) {
      throw new Error("Cloud session refresh failed; run `harnessdeck cloud login`.");
    }

    const refreshed = (await response.json()) as DeviceTokenResponse;
    profile = {
      ...profile,
      orgId: refreshed.orgId,
      orgSlug: refreshed.orgSlug,
      scopes: refreshed.scopes,
      accessToken: refreshed.access_token,
      accessTokenExpiresAt: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      refreshToken: refreshed.refresh_token,
    };
    opts.onProfileUpdate(profile);
  }

  async function authorizedRequest(path: string, init: RequestInit = {}): Promise<Response> {
    await refreshIfNeeded();
    const headers = new Headers(init.headers ?? {});
    headers.set("authorization", `Bearer ${profile.accessToken}`);
    if (!(init.body instanceof FormData) && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }

    return fetchImpl(`${profile.cloudBaseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  async function authorizedJson<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await authorizedRequest(path, init);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Cloud request failed (${response.status}): ${body}`);
    }
    return (await response.json()) as T;
  }

  return {
    async whoami() {
      return authorizedJson<{ id: string; email: string; name?: string }>("/api/me");
    },
    async listOrgs() {
      return authorizedJson<Array<{ id: string; slug: string; scopes: string[] }>>("/api/me/orgs");
    },
    async searchLibraries(opts: { query: string; tag?: string; public?: boolean }) {
      const search = new URLSearchParams();
      search.set("q", opts.query);
      if (opts.tag) search.set("tag", opts.tag);
      const basePath = opts.public
        ? "/api/public/libraries"
        : `/api/orgs/${profile.orgSlug}/libraries`;
      return authorizedJson<Array<{ slug: string; name: string; latestVersion?: string; tags?: string[] }>>(
        `${basePath}?${search.toString()}`,
      );
    },
    async downloadLibraryBundle(opts: {
      orgSlug: string;
      librarySlug: string;
      version?: string;
    }): Promise<{ version: string; body: string }> {
      const version =
        opts.version ??
        (
          await authorizedJson<{ latestVersion: string }>(
            `/api/orgs/${opts.orgSlug}/libraries/${opts.librarySlug}`,
          )
        ).latestVersion;
      const response = await authorizedRequest(
        `/api/orgs/${opts.orgSlug}/libraries/${opts.librarySlug}/versions/${version}/bundle`,
      );
      if (!response.ok) {
        throw new Error(`Cloud install failed (${response.status})`);
      }
      return {
        version,
        body: await response.text(),
      };
    },
    async publishPresetBundle(opts: {
      orgSlug: string;
      librarySlug: string;
      version?: string;
      changelog?: string;
      bundle: ExportBundle;
    }) {
      const form = new FormData();
      form.set(
        "metadata",
        new Blob(
          [
            JSON.stringify({
              version: opts.version,
              changelog: opts.changelog,
            }),
          ],
          { type: "application/json" },
        ),
        "metadata.json",
      );
      form.set(
        "bundle",
        new Blob([JSON.stringify(opts.bundle)], { type: "application/json" }),
        "bundle.json",
      );

      const response = await authorizedRequest(
        `/api/orgs/${opts.orgSlug}/libraries/${opts.librarySlug}/versions`,
        {
          method: "POST",
          body: form,
        },
      );
      if (!response.ok) {
        throw new Error(`Cloud publish failed (${response.status})`);
      }
      return (await response.json()) as {
        id: string;
        version: string;
        publishedAt: string;
        url: string;
      };
    },
    async revokeRefreshToken() {
      if (!profile.refreshToken) return;
      await fetchImpl(`${profile.cloudBaseUrl}/api/cli/token/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: profile.refreshToken }),
      });
    },
  };
}
```

`src/services/preset-source.ts`

```ts
export function writePresetBundleToTempFile(body: string): string {
  const dir = mkdtempSync(join(tmpdir(), "harnessdeck-bundle-"));
  const filePath = join(dir, "remote.harnessdeck.json");
  writeFileSync(filePath, body, "utf-8");
  return filePath;
}

export async function fetchPresetBundleToTempFile(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch preset bundle (${response.status}): ${url}`);
  }
  return writePresetBundleToTempFile(await response.text());
}
```

- [ ] **Step 4: Re-run the service test and verify it passes**

Run: `bun run test:run test/services/cloud-client.test.ts`

Expected: PASS with device flow polling and token refresh tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/cloud-client.ts src/services/preset-source.ts test/services/cloud-client.test.ts
git commit -m $'feat: add cloud client primitives\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

---

### Task 3: Add `harnessdeck cloud` auth and org commands

**Files:**
- Modify: `src/index.ts`
- Create: `test/cli/cloud.test.ts`
- Modify: `test/cli/help-organization.test.ts`
- Modify: `test/cli/output-format.test.ts`

- [ ] **Step 1: Write the failing CLI auth tests**

`test/cli/cloud.test.ts`

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { runCli } from "../helpers/cli.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CLI cloud commands", () => {
  it("logs in, prints whoami JSON, switches orgs, and logs out", async () => {
    const context = await createTestContext("cli-cloud");

    try {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            device_code: "device-1",
            user_code: "ABCD-1234",
            verification_uri: "https://cloud.harnessdeck.dev/cli/auth/device",
            verification_uri_complete:
              "https://cloud.harnessdeck.dev/cli/auth/device?user_code=ABCD-1234",
            expires_in: 600,
            interval: 0,
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            orgId: "org_1",
            orgSlug: "acme",
            scopes: ["read", "publish"],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ id: "user_1", email: "dev@example.com", name: "Dev" }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ id: "user_1", email: "dev@example.com", name: "Dev" }),
        )
        .mockResolvedValueOnce(
          jsonResponse([
            { id: "org_1", slug: "acme", scopes: ["read", "publish"] },
            { id: "org_2", slug: "beta", scopes: ["read"] },
          ]),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }));

      vi.stubGlobal("fetch", fetchMock);

      const login = await runCli(["cloud", "login", "--cloud-url", "https://cloud.harnessdeck.dev"]);
      expect(login.stdout).toContain("ABCD-1234");

      const whoami = await runCli(["cloud", "whoami", "--format", "json"]);
      expect(JSON.parse(whoami.stdout)).toEqual(
        expect.objectContaining({
          profile: "default",
          user_email: "dev@example.com",
          org_slug: "acme",
        }),
      );

      const orgs = await runCli(["cloud", "orgs", "--switch", "beta", "--format", "json"]);
      expect(JSON.parse(orgs.stdout)).toEqual(
        expect.objectContaining({
          active_org: "beta",
          orgs: expect.arrayContaining([expect.objectContaining({ slug: "beta" })]),
        }),
      );

      const logout = await runCli(["cloud", "logout"]);
      expect(logout.stdout).toContain("Logged out");
    } finally {
      await context.cleanup();
    }
  });
});
```

Update `test/cli/help-organization.test.ts`

```ts
const cloudHelp = await runCli(["cloud", "-h"]);

expect(help.stdout).toContain("cloud");
expect(cloudHelp.stdout).toContain("login");
expect(cloudHelp.stdout).toContain("whoami");
expect(cloudHelp.stdout).toContain("orgs");
```

Update `test/cli/output-format.test.ts`

```ts
const whoami = await runCli(["cloud", "whoami", "--format", "json"]);
expect(JSON.parse(whoami.stdout)).toEqual(
  expect.objectContaining({
    profile: expect.any(String),
    org_slug: expect.any(String),
  }),
);

const orgs = await runCli(["cloud", "orgs", "--format", "json"]);
expect(JSON.parse(orgs.stdout)).toEqual(
  expect.objectContaining({
    active_org: expect.any(String),
    orgs: expect.any(Array),
  }),
);
```

- [ ] **Step 2: Run the CLI tests and verify they fail**

Run: `bun run test:run test/cli/cloud.test.ts test/cli/help-organization.test.ts test/cli/output-format.test.ts`

Expected: FAIL because the `cloud` command group does not exist yet.

- [ ] **Step 3: Implement the cloud command group in `src/index.ts`**

Add imports near the top of `src/index.ts`:

```ts
import {
  clearCloudTokens,
  getCloudProfile,
  removeCloudProfile,
  saveCloudProfile,
  setDefaultCloudProfile,
  updateCloudProfile,
} from "./config/cloud-profiles.js";
import {
  createCloudClient,
  pollDeviceToken,
  requestDeviceCode,
} from "./services/cloud-client.js";
```

Add handlers:

```ts
async function handleCloudLoginCommand(opts: {
  profile?: string;
  cloudUrl?: string;
  org?: string;
}): Promise<void> {
  const profileName = opts.profile ?? "default";
  const cloudBaseUrl = opts.cloudUrl ?? "https://cloud.harnessdeck.dev";
  const device = await requestDeviceCode(cloudBaseUrl);

  log.info(`Open ${device.verification_uri_complete ?? device.verification_uri}`);
  log.info(`Enter code: ${device.user_code}`);

  const token = await pollDeviceToken(cloudBaseUrl, device.device_code, {
    intervalSeconds: device.interval,
  });
  let nextProfile = {
    cloudBaseUrl,
    orgId: token.orgId,
    orgSlug: opts.org ?? token.orgSlug,
    scopes: token.scopes,
    accessToken: token.access_token,
    accessTokenExpiresAt: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    refreshToken: token.refresh_token,
  };

  const client = createCloudClient({
    profileName,
    profile: nextProfile,
    onProfileUpdate(profile) {
      nextProfile = profile;
    },
  });
  const me = await client.whoami();
  saveCloudProfile(profileName, {
    ...nextProfile,
    userId: me.id,
    userEmail: me.email,
    userName: me.name,
  });
  setDefaultCloudProfile(profileName);
  log.success(`Logged in to ${cloudBaseUrl} as ${me.email}`);
}

async function handleCloudWhoamiCommand(opts: {
  profile?: string;
  format?: string;
}): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const resolved = getCloudProfile(opts.profile);
  const client = createCloudClient({
    profileName: resolved.profileName,
    profile: resolved.profile,
    onProfileUpdate(next) {
      updateCloudProfile(resolved.profileName, next);
    },
  });
  const me = await client.whoami();
  const payload = {
    profile: resolved.profileName,
    cloud_base_url: resolved.profile.cloudBaseUrl,
    user_id: me.id,
    user_email: me.email,
    user_name: me.name,
    org_slug: resolved.profile.orgSlug,
    scopes: resolved.profile.scopes,
    access_token_expires_at: resolved.profile.accessTokenExpiresAt,
  };
  if (format === "json") {
    printJson(payload);
    return;
  }
  log.info(`${payload.user_email} @ ${payload.org_slug} (${payload.profile})`);
}

async function handleCloudOrgsCommand(opts: {
  profile?: string;
  switch?: string;
  format?: string;
}): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const resolved = getCloudProfile(opts.profile);
  const client = createCloudClient({
    profileName: resolved.profileName,
    profile: resolved.profile,
    onProfileUpdate(next) {
      updateCloudProfile(resolved.profileName, next);
    },
  });
  const orgs = await client.listOrgs();
  const activeOrg = opts.switch ?? resolved.profile.orgSlug;

  if (opts.switch) {
    const match = orgs.find((org) => org.slug === opts.switch);
    if (!match) {
      throw new Error(`Org not found for profile ${resolved.profileName}: ${opts.switch}`);
    }
    updateCloudProfile(resolved.profileName, {
      orgId: match.id,
      orgSlug: match.slug,
      scopes: match.scopes,
    });
  }

  const payload = {
    profile: resolved.profileName,
    active_org: activeOrg,
    orgs,
  };
  if (format === "json") {
    printJson(payload);
    return;
  }
  for (const org of orgs) {
    const marker = org.slug === activeOrg ? "*" : " ";
    log.info(`${marker} ${org.slug} (${org.scopes.join(",")})`);
  }
}
```

Wire the command group before `harness`:

```ts
const cloudCmd = program
  .command("cloud")
  .description("Manage HarnessDeck Cloud auth and org context");
cloudCmd.helpCommand(false);

cloudCmd
  .command("login")
  .option("--profile <name>", "Cloud profile name", "default")
  .option("--cloud-url <url>", "HarnessDeck Cloud base URL")
  .option("--org <slug>", "Initial active org slug")
  .description("Log in with the device-code flow and save a cloud profile")
  .action(handleCloudLoginCommand);

cloudCmd
  .command("logout")
  .option("--profile <name>", "Cloud profile name", "default")
  .description("Forget the local cloud session for a profile")
  .action(async (opts: { profile?: string }) => {
    const resolved = getCloudProfile(opts.profile);
    const client = createCloudClient({
      profileName: resolved.profileName,
      profile: resolved.profile,
      onProfileUpdate() {},
    });
    await client.revokeRefreshToken();
    clearCloudTokens(resolved.profileName);
    removeCloudProfile(resolved.profileName);
    log.success(`Logged out profile ${resolved.profileName}`);
  });

cloudCmd
  .command("whoami")
  .option("--profile <name>", "Cloud profile name")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Show the active cloud identity and org context")
  .action(handleCloudWhoamiCommand);

cloudCmd
  .command("orgs")
  .option("--profile <name>", "Cloud profile name")
  .option("--switch <slug>", "Set the active org for this profile")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("List accessible orgs and optionally switch the active org")
  .action(handleCloudOrgsCommand);
```

- [ ] **Step 4: Re-run the CLI tests and verify they pass**

Run: `bun run test:run test/cli/cloud.test.ts test/cli/help-organization.test.ts test/cli/output-format.test.ts`

Expected: PASS with the new `cloud` group visible in help and JSON output working for `whoami`.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/cli/cloud.test.ts test/cli/help-organization.test.ts test/cli/output-format.test.ts
git commit -m $'feat: add cloud auth commands\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

---

### Task 4: Add `preset search`, `preset install`, and `preset publish`

**Files:**
- Modify: `src/index.ts`
- Modify: `src/services/exporter.ts`
- Create: `test/cli/preset-cloud.test.ts`
- Modify: `test/services/exporter.test.ts`
- Modify: `test/cli/output-format.test.ts`

- [ ] **Step 1: Write the failing preset-cloud tests**

`test/cli/preset-cloud.test.ts`

```ts
import { describe, expect, it, vi, afterEach } from "vitest";
import { createTestContext } from "../helpers/db.ts";
import { initGitRepo } from "../helpers/git.ts";
import { runCli } from "../helpers/cli.ts";
import { makeResourceInput } from "../helpers/resources.ts";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CLI cloud-backed preset workflows", () => {
  it("searches, installs, publishes, and applies a cloud-installed preset", async () => {
    const context = await createTestContext("cli-preset-cloud");

    try {
      initGitRepo(context.projectDir, "git@github.com:acme/cloud-preset.git");
      await runCli(["init"]);

      const profiles = await import("../../src/config/cloud-profiles.ts");
      profiles.saveCloudProfile("default", {
        cloudBaseUrl: "https://cloud.harnessdeck.dev",
        userId: "user_1",
        userEmail: "dev@example.com",
        orgId: "org_1",
        orgSlug: "acme",
        scopes: ["read", "publish"],
        accessToken: "access-1",
        accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
        refreshToken: "refresh-1",
      });

      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse([{ slug: "starter", name: "Starter", latestVersion: "1.2.3" }]),
        )
        .mockResolvedValueOnce(
          jsonResponse({ slug: "starter", latestVersion: "1.2.3" }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              $schema: "urn:harnessdeck:bundle:v1",
              version: 1,
              preset: { name: "starter", description: "Cloud starter", tags: [] },
              resources: [{ type: "instruction", name: "guide", description: "", content: "# Guide", metadata: {} }],
              plugins: [],
              embedded_plugins: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            id: "ver_1",
            version: "1.2.4",
            publishedAt: "2026-05-24T12:00:00Z",
            url: "/api/orgs/acme/libraries/starter/versions/1.2.4",
          }),
        );

      vi.stubGlobal("fetch", fetchMock);

      const search = await runCli(["preset", "search", "starter", "--format", "json"]);
      expect(JSON.parse(search.stdout)[0]).toEqual(
        expect.objectContaining({ slug: "starter", latestVersion: "1.2.3" }),
      );

      const install = await runCli(["preset", "install", "acme/starter", "--format", "json"]);
      expect(JSON.parse(install.stdout)).toEqual(
        expect.objectContaining({ preset_name: "starter", org_slug: "acme", version: "1.2.3" }),
      );

      const presetModel = await import("../../src/models/preset.ts");
      expect(presetModel.getPreset("starter")).toBeDefined();

      const apply = await runCli([
        "project",
        "apply",
        "starter",
        "--project",
        context.projectDir,
        "--platform",
        "claude-code",
        "--dry-run",
      ]);
      expect(apply.stdout).toContain(".claude");

      const resourceModel = await import("../../src/models/resource.ts");
      const local = presetModel.createPreset({ name: "local-starter" });
      const resource = resourceModel.createResource(
        makeResourceInput({ type: "instruction", name: "guide", content: "# Guide" }),
      );
      presetModel.addResourceToPreset(local.id, resource.id);

      const publish = await runCli([
        "preset",
        "publish",
        "local-starter",
        "--library",
        "starter",
        "--format",
        "json",
      ]);
      expect(JSON.parse(publish.stdout)).toEqual(
        expect.objectContaining({ version: "1.2.4" }),
      );
    } finally {
      await context.cleanup();
    }
  });

  it("fails install when the local preset name already exists and --as is missing", async () => {
    const context = await createTestContext("cli-preset-cloud-conflict");

    try {
      await runCli(["init"]);
      const presetModel = await import("../../src/models/preset.ts");
      presetModel.createPreset({ name: "starter" });

      const profiles = await import("../../src/config/cloud-profiles.ts");
      profiles.saveCloudProfile("default", {
        cloudBaseUrl: "https://cloud.harnessdeck.dev",
        orgSlug: "acme",
        scopes: ["read"],
        accessToken: "access-1",
        accessTokenExpiresAt: "2099-01-01T00:00:00.000Z",
      });

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              $schema: "urn:harnessdeck:bundle:v1",
              version: 1,
              preset: { name: "starter", description: "", tags: [] },
              resources: [],
              plugins: [],
              embedded_plugins: [],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      );

      const result = await runCli(["preset", "install", "acme/starter"]);
      expect(result.stderr).toContain("already exists");
    } finally {
      await context.cleanup();
    }
  });
});
```

Add the importer override test to `test/services/exporter.test.ts`

```ts
it("imports a bundle under an override name", async () => {
  const context = await createInitializedTestContext("export-import-override");

  try {
    const exporter = await import("../../src/services/exporter.ts");
    const bundlePath = join(context.projectDir, "bundle.json");
    writeTextFile(
      bundlePath,
      JSON.stringify({
        $schema: "urn:harnessdeck:bundle:v1",
        version: 1,
        preset: { name: "starter", description: "", tags: [] },
        resources: [],
        plugins: [],
        embedded_plugins: [],
      }),
    );

    const imported = exporter.importFromFile(bundlePath, {
      presetNameOverride: "starter-cloud",
    });

    expect(imported.preset.name).toBe("starter-cloud");
  } finally {
    await context.cleanup();
  }
});
```

Update `test/cli/output-format.test.ts`

```ts
const search = await runCli(["preset", "search", "starter", "--format", "json"]);
expect(Array.isArray(JSON.parse(search.stdout))).toBe(true);

const install = await runCli(["preset", "install", "acme/starter", "--format", "json"]);
expect(JSON.parse(install.stdout)).toEqual(
  expect.objectContaining({
    preset_name: expect.any(String),
    version: expect.any(String),
  }),
);

const publish = await runCli([
  "preset",
  "publish",
  "starter",
  "--library",
  "starter",
  "--format",
  "json",
]);
expect(JSON.parse(publish.stdout)).toEqual(
  expect.objectContaining({
    version: expect.any(String),
    url: expect.any(String),
  }),
);
```

- [ ] **Step 2: Run the preset-cloud tests and verify they fail**

Run: `bun run test:run test/services/exporter.test.ts test/cli/preset-cloud.test.ts`

Expected: FAIL because `preset search`, `preset install`, and `preset publish` do not exist and `importFromFile` does not accept a name override.

- [ ] **Step 3: Implement the preset cloud workflows**

Update `src/services/exporter.ts`

```ts
export interface ImportPresetOptions {
  embeddedTargetDir?: string;
  presetNameOverride?: string;
}

function importPresetFromBundleParsed(
  bundle: ExportBundle,
  filePath: string,
  opts?: ImportPresetOptions,
): { preset: Preset; resources: Resource[] } {
  const presetName = opts?.presetNameOverride ?? bundle.preset.name;
  const preset = createPreset({
    name: presetName,
    description: bundle.preset.description,
    tags: bundle.preset.tags,
    ...(claude ? { claude } : {}),
  });
  // keep the rest of the existing import flow unchanged
}
```

Add handlers in `src/index.ts`

```ts
function resolveCloudClientForPresetCommand(profileName?: string) {
  const resolved = getCloudProfile(profileName);
  const client = createCloudClient({
    profileName: resolved.profileName,
    profile: resolved.profile,
    onProfileUpdate(next) {
      updateCloudProfile(resolved.profileName, next);
    },
  });
  return { ...resolved, client };
}

function parseRemoteLibrarySelector(selector: string): {
  orgSlug: string;
  librarySlug: string;
  version?: string;
} {
  const [libraryRef, version] = selector.split("@");
  const [orgSlug, librarySlug] = libraryRef.split("/");
  if (!orgSlug || !librarySlug) {
    throw new Error(`Invalid remote library selector: ${selector}`);
  }
  return { orgSlug, librarySlug, version };
}

async function handlePresetSearchCommand(
  query: string,
  opts: { profile?: string; tag?: string; public?: boolean; format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { client } = resolveCloudClientForPresetCommand(opts.profile);
  const results = await client.searchLibraries({
    query,
    tag: opts.tag,
    public: opts.public,
  });

  if (format === "json") {
    printJson(results);
    return;
  }
  for (const row of results) {
    log.info(`${row.slug} ${row.latestVersion ?? "(no versions)"} ${row.name}`);
  }
}

async function handlePresetInstallCommand(
  selector: string,
  opts: { profile?: string; as?: string; format?: string },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { client } = resolveCloudClientForPresetCommand(opts.profile);
  const target = parseRemoteLibrarySelector(selector);
  const localName = opts.as ?? target.librarySlug;

  if (getPreset(localName)) {
    log.error(`Local preset already exists: ${localName}. Use --as to rename the install.`);
    return;
  }

  const downloaded = await client.downloadLibraryBundle(target);
  const tempFile = writePresetBundleToTempFile(downloaded.body);
  const imported = importFromFile(tempFile, { presetNameOverride: localName });
  const payload = {
    preset_name: imported.preset.name,
    org_slug: target.orgSlug,
    library_slug: target.librarySlug,
    version: downloaded.version,
  };
  if (format === "json") {
    printJson(payload);
    return;
  }
  log.success(`Installed preset ${payload.preset_name} from ${target.orgSlug}/${target.librarySlug}`);
}

async function handlePresetPublishCommand(
  presetName: string,
  opts: {
    library: string;
    profile?: string;
    version?: string;
    changelog?: string;
    format?: string;
  },
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { profile, client } = resolveCloudClientForPresetCommand(opts.profile);
  const bundle = exportPreset(presetName);
  const result = await client.publishPresetBundle({
    orgSlug: profile.orgSlug ?? "",
    librarySlug: opts.library,
    version: opts.version,
    changelog: opts.changelog,
    bundle,
  });

  if (format === "json") {
    printJson(result);
    return;
  }
  log.success(`Published ${presetName} to ${opts.library}@${result.version}`);
}
```

Wire the new `preset` subcommands:

```ts
presetCmd
  .command("search")
  .argument("<query>", "Search query")
  .option("--profile <name>", "Cloud profile name")
  .option("--tag <tag>", "Filter by library tag")
  .option("--public", "Search the public registry instead of the active org")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Search remote cloud preset libraries")
  .action(handlePresetSearchCommand);

presetCmd
  .command("install")
  .argument("<org/library[@version]>", "Remote library selector")
  .option("--profile <name>", "Cloud profile name")
  .option("--as <preset-name>", "Override the local preset name")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Install a remote cloud library as a local preset")
  .action(handlePresetInstallCommand);

presetCmd
  .command("publish")
  .argument("<preset>", "Local preset name or ID")
  .requiredOption("--library <slug>", "Remote library slug")
  .option("--profile <name>", "Cloud profile name")
  .option("--version <semver>", "Explicit publish version")
  .option("--changelog <text>", "Release notes")
  .option("--format <mode>", "Output format: human or json", "human")
  .description("Publish a local preset bundle to HarnessDeck Cloud")
  .action(handlePresetPublishCommand);
```

- [ ] **Step 4: Re-run the preset-cloud tests and verify they pass**

Run: `bun run test:run test/services/exporter.test.ts test/cli/preset-cloud.test.ts test/cli/output-format.test.ts`

Expected: PASS with search/install/publish behavior green and JSON output assertions passing.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts src/services/exporter.ts test/services/exporter.test.ts test/cli/preset-cloud.test.ts test/cli/output-format.test.ts
git commit -m $'feat: add cloud preset workflows\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

---

### Task 5: Document the cloud flows and run the focused verification suite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the README command examples**

Insert a new section after “Import and export” in `README.md`:

````md
## HarnessDeck Cloud

HarnessDeck Cloud keeps auth/context under `harnessdeck cloud ...` and remote preset workflows under `harnessdeck preset ...`.

```bash
harnessdeck cloud login
harnessdeck cloud whoami --format json
harnessdeck preset search starter --format json
harnessdeck preset install acme/starter
harnessdeck project apply starter --project . --platform claude-code
harnessdeck preset publish starter --library starter --format json
```

Cloud profiles live under `~/.harnessdeck/cloud-profiles.json` (or `HARNESSDECK_HOME` when set).
````

- [ ] **Step 2: Run the focused verification suite**

Run:

```bash
bun run test:run \
  test/config/cloud-profiles.test.ts \
  test/services/cloud-client.test.ts \
  test/services/exporter.test.ts \
  test/cli/cloud.test.ts \
  test/cli/preset-cloud.test.ts \
  test/cli/help-organization.test.ts \
  test/cli/output-format.test.ts \
  && bun run build
```

Expected: PASS for the targeted tests, then a successful build.

- [ ] **Step 3: Commit the README update**

```bash
git add README.md
git commit -m $'docs: document harnessdeck cloud workflows\n\nCo-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>'
```

---

## Spec Coverage Check

- Cloud profile storage under `HARNESSDECK_HOME` / `~/.harnessdeck` is covered by **Task 1**.
- Shared auth + refresh + remote request execution is covered by **Task 2**.
- `cloud login/logout/whoami/orgs` is covered by **Task 3**.
- `preset search/install/publish` and unchanged `project apply` follow-through are covered by **Task 4**.
- README/help/output-contract follow-through is covered by **Tasks 3-5**.

## Placeholder Scan

- No `TODO`, `TBD`, or “similar to above” placeholders remain.
- Every code-changing task names exact files, includes a representative code snippet, and specifies an exact command to run.

## Type Consistency Check

- `CloudProfile`, `CloudProfileStoreFile`, `createCloudClient`, `requestDeviceCode`, `pollDeviceToken`, `writePresetBundleToTempFile`, and `presetNameOverride` are named consistently across tasks.
- The CLI commands stay aligned with the approved spec: `cloud login/logout/whoami/orgs` and `preset search/install/publish`.
