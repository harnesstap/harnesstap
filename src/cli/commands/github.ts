import type { Command } from "commander";
import {
  clearGithubSession,
  loadGithubSession,
  saveGithubSession,
} from "../../config/github-session.js";
import { resolveGithubAppClientId } from "../../config/github-app.js";
import {
  ensureGithubSessionAccess,
  resolveGithubAccessToken,
} from "../../services/github-credentials.js";
import {
  fetchGithubUser,
  pollGithubDeviceToken,
  requestGithubDeviceCode,
  sessionFromDeviceToken,
} from "../../services/github-device-flow.js";
import { ui } from "../../ui/index.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { configureCommandGroup } from "../help.js";

async function handleGithubLoginCommand(): Promise<void> {
  try {
    const device = await requestGithubDeviceCode();
    console.log(`Visit: ${device.verification_uri}`);
    console.log(`Code:  ${device.user_code}`);
    const pollIntervalSeconds = device.interval ?? 5;
    const maxPolls = Math.ceil((device.expires_in ?? 900) / pollIntervalSeconds);
    const token = await pollGithubDeviceToken(device.device_code, {
      interval: pollIntervalSeconds,
      maxPolls,
    });
    let identity: Awaited<ReturnType<typeof fetchGithubUser>> | undefined;
    try {
      identity = await fetchGithubUser(token.access_token);
    } catch {
      // Identity is best-effort; the token is still usable for git reads.
    }
    saveGithubSession(sessionFromDeviceToken(token, identity));
    ui.success(
      identity?.login
        ? `Signed in to GitHub as ${identity.login}`
        : "Signed in to GitHub",
    );
  } catch (err) {
    process.exitCode = 1;
    ui.danger(err instanceof Error ? err.message : String(err));
  }
}

async function handleGithubStatusCommand(
  opts: { format?: string } = {},
): Promise<void> {
  const format = parseOutputFormat(opts.format);
  const resolved = resolveGithubAccessToken({ lookupGhCli: true });
  const session = await ensureGithubSessionAccess();
  const payload = {
    authenticated: Boolean(session?.accessToken) || resolved.source === "harnesstap_session",
    source: resolved.source,
    login: session?.login,
    name: session?.name,
    clientId: session?.clientId ?? resolveGithubAppClientId(),
  };
  if (format === "json") {
    printJson(payload);
    return;
  }
  if (payload.authenticated && session?.login) {
    ui.info(`GitHub: signed in as ${session.login}`);
    return;
  }
  if (resolved.token) {
    ui.info(`GitHub: using ${resolved.source} (no stored HarnessTap session)`);
    return;
  }
  ui.warn("Not signed in to GitHub. Run `ht github login`.");
}

async function handleGithubLogoutCommand(): Promise<void> {
  if (!loadGithubSession()) {
    ui.warn("No GitHub session stored.");
    return;
  }
  clearGithubSession();
  ui.success("Signed out of GitHub");
}

export function registerGithubCommands(root: Command): void {
  const githubCmd = configureCommandGroup(
    root
      .command("github")
      .description("Authenticate with GitHub for private marketplace and repo reads"),
  );

  githubCmd
    .command("login")
    .description("Log into GitHub via device authentication (GitHub App user-to-server)")
    .action(async () => {
      await handleGithubLoginCommand();
    });

  githubCmd
    .command("status")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Show GitHub authentication status")
    .action(async (opts: { format?: string }) => {
      await handleGithubStatusCommand(opts);
    });

  githubCmd
    .command("logout")
    .description("Remove the stored GitHub session")
    .action(async () => {
      await handleGithubLogoutCommand();
    });
}
