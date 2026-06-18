import fs from "node:fs";
import { join } from "node:path";
import { getHarnessdeckDir } from "../db/connection.js";

export interface CloudAccount {
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

export interface CloudAccountStoreFile {
  default_account?: string | null;
  accounts: Record<string, CloudAccount>;
}

export function getCloudAccountsPath(): string {
  return join(getHarnessdeckDir(), "cloud-accounts.json");
}

export async function loadCloudAccounts(): Promise<CloudAccountStoreFile> {
  const path = getCloudAccountsPath();
  if (!fs.existsSync(path)) {
    return { default_account: undefined, accounts: {} };
  }
  const raw = fs.readFileSync(path, "utf8");
  try {
    const parsed = JSON.parse(raw) as CloudAccountStoreFile;
    if (!parsed.accounts) parsed.accounts = {};
    return parsed;
  } catch (_error) {
    return { default_account: undefined, accounts: {} };
  }
}

async function writeStore(file: CloudAccountStoreFile): Promise<void> {
  const dir = getHarnessdeckDir();
  fs.mkdirSync(dir, { recursive: true });
  const path = getCloudAccountsPath();
  fs.writeFileSync(path, JSON.stringify(file, null, 2), { encoding: "utf8" });
  try {
    fs.chmodSync(path, 0o600);
  } catch (_error) {
    // ignore on filesystems that don't support chmod
  }
}

export async function saveCloudAccount(accountName: string, account: CloudAccount): Promise<void> {
  const store = await loadCloudAccounts();
  store.accounts = store.accounts || {};
  store.accounts[accountName] = account;
  await writeStore(store);
}

export async function setDefaultCloudAccount(accountName: string | null): Promise<void> {
  const store = await loadCloudAccounts();
  store.default_account = accountName ?? null;
  await writeStore(store);
}

export async function getCloudAccount(accountName?: string): Promise<{
  accountName?: string | null;
  account?: CloudAccount | undefined;
}> {
  const store = await loadCloudAccounts();
  const name = accountName ?? store.default_account ?? undefined;
  if (!name) return { accountName: undefined, account: undefined };
  return { accountName: name, account: store.accounts ? store.accounts[name] : undefined };
}

export async function updateCloudAccount(
  accountName: string,
  patch: Partial<CloudAccount>,
): Promise<void> {
  const store = await loadCloudAccounts();
  store.accounts = store.accounts || {};
  const existing = store.accounts[accountName] || ({} as CloudAccount);
  store.accounts[accountName] = { ...existing, ...patch };
  await writeStore(store);
}

export async function clearCloudTokens(accountName: string): Promise<void> {
  const store = await loadCloudAccounts();
  if (!store.accounts) return;
  const account = store.accounts[accountName];
  if (!account) return;
  delete account.accessToken;
  delete account.accessTokenExpiresAt;
  delete account.refreshToken;
  delete account.refreshTokenExpiresAt;
  store.accounts[accountName] = account;
  await writeStore(store);
}

export async function removeCloudAccount(accountName: string): Promise<void> {
  const store = await loadCloudAccounts();
  if (store.accounts && accountName in store.accounts) {
    delete store.accounts[accountName];
  }
  if (store.default_account === accountName) {
    store.default_account = undefined;
  }
  await writeStore(store);
}
