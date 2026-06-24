import type { Command } from "commander";
import {
  getCloudAccount,
  removeCloudAccount,
  saveCloudAccount,
  setDefaultCloudAccount,
  updateCloudAccount,
} from "../../config/cloud-accounts.js";
import { resolveCloudBaseUrl } from "../../config/catalog.js";
import {
  createCloudClient,
  deviceVerificationUri,
  pollDeviceToken,
  requestDeviceCode,
} from "../../services/cloud-client.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { configureCommandGroup } from "../help.js";

async function handleCloudLoginCommand(
  accountName: string | undefined,
  opts: { baseUrl?: string } = {},
): Promise<void> {
  const name = accountName ?? "default";
  const baseUrl = resolveCloudBaseUrl(opts.baseUrl);
  try {
    const device = await requestDeviceCode(baseUrl);
    console.log(`Visit: ${deviceVerificationUri(baseUrl)}`);
    console.log(`Code:  ${device.user_code}`);
    const pollIntervalSeconds = device.interval ?? 5;
    const maxPolls = Math.ceil((device.expires_in ?? 600) / pollIntervalSeconds);
    const token = await pollDeviceToken(baseUrl, device.device_code, {
      interval: pollIntervalSeconds,
      maxPolls,
    });
    const now = Math.floor(Date.now() / 1000);
    const account = {
      cloudBaseUrl: baseUrl,
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      accessTokenExpiresAt: token.expires_in ? now + token.expires_in : undefined,
      refreshTokenExpiresAt: undefined,
      orgId: token.orgId,
      orgSlug: token.orgSlug,
      scopes: token.scopes ?? [],
    };
    await saveCloudAccount(name, account);
    await setDefaultCloudAccount(name);
    ui.success(`Saved cloud account: ${name}`);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleCloudWhoamiCommand(
  opts: { account?: string; format?: string } = {},
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { account } = await getCloudAccount(opts.account);
  if (!account || !account.accessToken) {
    if (format === "json") {
      printJson({});
      return;
    }
    ui.warn("Not authenticated to cloud.");
    return;
  }
  try {
    const client = createCloudClient({
      baseUrl: account.cloudBaseUrl,
      token: {
        access_token: account.accessToken as string,
        refresh_token: account.refreshToken as string | undefined,
        expires_at: typeof account.accessTokenExpiresAt === "number"
          ? (account.accessTokenExpiresAt as number)
          : undefined,
      },
    });
    const info = await client.whoami();
    if (format === "json") {
      printJson(info);
      return;
    }
    ui.info(JSON.stringify(info));
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleCloudOrgsCommand(
  opts: { account?: string; switch?: string; format?: string } = {},
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const { accountName, account } = await getCloudAccount(opts.account);
  if (!account || !account.accessToken) {
    if (format === "json") {
      printJson([]);
      return;
    }
    ui.warn("Not authenticated to cloud.");
    return;
  }
  try {
    const client = createCloudClient({
      baseUrl: account.cloudBaseUrl,
      token: {
        access_token: account.accessToken as string,
        refresh_token: account.refreshToken as string | undefined,
        expires_at: typeof account.accessTokenExpiresAt === "number"
          ? (account.accessTokenExpiresAt as number)
          : undefined,
      },
    });
    const orgs = await client.listOrgs();
    if (opts.switch) {
      const target = (orgs as Record<string, unknown>[]).find((o) => String((o as Record<string, unknown>)["slug"]) === opts.switch || String((o as Record<string, unknown>)["id"]) === opts.switch);
      if (!target) {
        process.exitCode = 1;
        ui.danger(`Organization not found: ${opts.switch}`);
        return;
      }
      if (accountName) {
        await updateCloudAccount(accountName, { orgId: String((target as Record<string, unknown>)["id"]), orgSlug: String((target as Record<string, unknown>)["slug"]) });
      }
      ui.success(`Switched to org: ${String((target as Record<string, unknown>)["slug"])}`);
      if (format === "json") {
        printJson(target);
      }
      return;
    }
    if (format === "json") {
      printJson(orgs);
      return;
    }
    for (const o of orgs as Record<string, unknown>[]) {
      ui.info(`${String(o["slug"])} ${String(o["name"])}`);
    }
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleCloudLogoutCommand(opts: { account?: string } = {}): Promise<void> {
  const { accountName, account } = await getCloudAccount(opts.account);
  if (!accountName) {
    ui.warn("No cloud account configured.");
    return;
  }
  try {
    if (account?.refreshToken) {
      try {
        const client = createCloudClient({
          baseUrl: account.cloudBaseUrl,
          token: {
            access_token: account.accessToken as string || "",
            refresh_token: account.refreshToken as string,
            expires_at: typeof account.accessTokenExpiresAt === "number"
              ? (account.accessTokenExpiresAt as number)
              : undefined,
          },
        });
        await client.revokeRefreshToken();
      } catch (_) {
        // ignore revoke errors
      }
    }
    await removeCloudAccount(accountName);
    ui.success(`Logged out: ${accountName}`);
  } catch (err) {
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

export function registerAuthCommands(root: Command): void {
  const authCmd = configureCommandGroup(
    root
      .command("auth")
      .alias("a")
      .description("Authenticate with HarnessDeck Cloud and manage cloud accounts"),
  );

  authCmd
    .command("login [account]")
    .option("--base-url <url>", "Cloud base URL")
    .description("Log into HarnessDeck Cloud via device authentication")
    .action(async (account: string | undefined, opts: { baseUrl?: string }) => {
      await handleCloudLoginCommand(account, opts);
    });

  authCmd
    .command("status")
    .option("--account <name>", "Account name")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Show authenticated user and account context")
    .action(async (opts: { account?: string; format?: string }) => {
      await handleCloudWhoamiCommand(opts);
    });

  authCmd
    .command("orgs")
    .option("--account <name>", "Account name")
    .option("--switch <org_slug>", "Switch to the given organization slug")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("List organizations and optionally switch")
    .action(async (opts: { account?: string; switch?: string; format?: string }) => {
      await handleCloudOrgsCommand(opts);
    });

  authCmd
    .command("logout")
    .option("--account <name>", "Account name")
    .description("Log out and remove local cloud account")
    .action(async (opts: { account?: string }) => {
      await handleCloudLogoutCommand(opts);
    });
}
