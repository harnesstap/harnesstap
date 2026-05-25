import fs from "node:fs";
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
  accessTokenExpiresAt?: string | number;
  refreshToken?: string;
  refreshTokenExpiresAt?: string | number;
}

export interface CloudProfileStoreFile {
  default_profile?: string | null;
  profiles: Record<string, CloudProfile>;
}

export function getCloudProfilesPath(): string {
  return join(getHarnessdeckDir(), "cloud-profiles.json");
}

export async function loadCloudProfiles(): Promise<CloudProfileStoreFile> {
  const p = getCloudProfilesPath();
  if (!fs.existsSync(p)) {
    return { default_profile: undefined, profiles: {} };
  }
  const raw = fs.readFileSync(p, "utf8");
  try {
    const parsed = JSON.parse(raw) as CloudProfileStoreFile;
    if (!parsed.profiles) parsed.profiles = {};
    return parsed;
  } catch (_e) {
    return { default_profile: undefined, profiles: {} };
  }
}

async function writeStore(file: CloudProfileStoreFile): Promise<void> {
  const dir = getHarnessdeckDir();
  fs.mkdirSync(dir, { recursive: true });
  const p = getCloudProfilesPath();
  fs.writeFileSync(p, JSON.stringify(file, null, 2), { encoding: "utf8" });
  try {
    fs.chmodSync(p, 0o600);
  } catch (_e) {
    // ignore on filesystems that don't support chmod
  }
}

export async function saveCloudProfile(profileName: string, profile: CloudProfile): Promise<void> {
  const store = await loadCloudProfiles();
  store.profiles = store.profiles || {};
  store.profiles[profileName] = profile;
  await writeStore(store);
}

export async function setDefaultCloudProfile(profileName: string | null): Promise<void> {
  const store = await loadCloudProfiles();
  store.default_profile = profileName ?? null;
  await writeStore(store);
}

export async function getCloudProfile(profileName?: string): Promise<{ profileName?: string | null; profile?: CloudProfile | undefined }> {
  const store = await loadCloudProfiles();
  const name = profileName ?? store.default_profile ?? undefined;
  if (!name) return { profileName: undefined, profile: undefined };
  return { profileName: name, profile: store.profiles ? store.profiles[name] : undefined };
}

export async function updateCloudProfile(profileName: string, patch: Partial<CloudProfile>): Promise<void> {
  const store = await loadCloudProfiles();
  store.profiles = store.profiles || {};
  const existing = store.profiles[profileName] || ({} as CloudProfile);
  store.profiles[profileName] = { ...existing, ...patch };
  await writeStore(store);
}

export async function clearCloudTokens(profileName: string): Promise<void> {
  const store = await loadCloudProfiles();
  if (!store.profiles) return;
  const p = store.profiles[profileName];
  if (!p) return;
  delete p.accessToken;
  delete p.accessTokenExpiresAt;
  delete p.refreshToken;
  delete p.refreshTokenExpiresAt;
  store.profiles[profileName] = p;
  await writeStore(store);
}

export async function removeCloudProfile(profileName: string): Promise<void> {
  const store = await loadCloudProfiles();
  if (store.profiles && profileName in store.profiles) {
    delete store.profiles[profileName];
  }
  if (store.default_profile === profileName) {
    store.default_profile = undefined;
  }
  await writeStore(store);
}
