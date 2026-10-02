import { resolveGithubAppClientId } from "../config/github-app.js";
import {
  clearGithubSession,
  loadGithubSession,
  saveGithubSession,
  type GithubSession,
} from "../config/github-session.js";
import { ensureGithubSessionAccess } from "../services/github-credentials.js";
import {
  type GithubDeviceCodeResponse,
  type GithubDeviceTokenPollOnceResult,
  fetchGithubUser,
  pollGithubDeviceTokenOnce,
  requestGithubDeviceCode,
  resolveGithubDeviceVerificationUris,
  sessionFromDeviceToken,
} from "../services/github-device-flow.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

export interface GithubPendingLogin {
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_at: number;
}

export interface GithubAuthStatus {
  authenticated: boolean;
  login?: string;
  name?: string;
  clientId?: string;
  pendingLogin?: GithubPendingLogin;
}

export interface GithubAuthLoginPollResult {
  status: "pending" | "complete" | "error";
  intervalMs?: number;
  message?: string;
  auth?: GithubAuthStatus;
}

interface PendingGithubDeviceLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresAt: number;
  intervalMs: number;
}

export interface GithubAuthDeps {
  getSession(): GithubSession | null;
  saveSession(session: GithubSession): void;
  clearSession(): void;
  ensureAccess(): Promise<GithubSession | null>;
  requestDeviceCode(): Promise<GithubDeviceCodeResponse>;
  pollDeviceTokenOnce(
    deviceCode: string,
    opts?: { intervalMs?: number },
  ): Promise<GithubDeviceTokenPollOnceResult>;
  fetchUser(accessToken: string): Promise<{ login: string; id: number; name?: string }>;
  now(): number;
  getPending(): PendingGithubDeviceLogin | null;
  setPending(pending: PendingGithubDeviceLogin | null): void;
}

export interface GithubAuthHandlers {
  handleStatus(request: Request, token: string): Promise<Response>;
  handleLogin(request: Request, token: string): Promise<Response>;
  handleLoginPoll(request: Request, token: string): Promise<Response>;
  handleLoginCancel(request: Request, token: string): Promise<Response>;
  handleLogout(request: Request, token: string): Promise<Response>;
}

let pendingLogin: PendingGithubDeviceLogin | null = null;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pendingPayload(pending: PendingGithubDeviceLogin): GithubPendingLogin {
  return {
    user_code: pending.userCode,
    verification_uri: pending.verificationUri,
    verification_uri_complete: pending.verificationUriComplete,
    expires_at: pending.expiresAt,
  };
}

async function buildStatus(deps: GithubAuthDeps): Promise<GithubAuthStatus> {
  const pending = deps.getPending();
  const pendingLoginPayload =
    pending && pending.expiresAt > deps.now()
      ? pendingPayload(pending)
      : undefined;
  if (pending && pending.expiresAt <= deps.now()) {
    deps.setPending(null);
  }

  const session = await deps.ensureAccess();
  if (!session?.accessToken) {
    return {
      authenticated: false,
      clientId: resolveGithubAppClientId(),
      ...(pendingLoginPayload ? { pendingLogin: pendingLoginPayload } : {}),
    };
  }

  return {
    authenticated: true,
    ...(session.login ? { login: session.login } : {}),
    ...(session.name ? { name: session.name } : {}),
    clientId: session.clientId || resolveGithubAppClientId(),
    ...(pendingLoginPayload ? { pendingLogin: pendingLoginPayload } : {}),
  };
}

function createDefaultGithubAuthDeps(): GithubAuthDeps {
  return {
    getSession: loadGithubSession,
    saveSession: saveGithubSession,
    clearSession: clearGithubSession,
    ensureAccess: ensureGithubSessionAccess,
    requestDeviceCode: requestGithubDeviceCode,
    pollDeviceTokenOnce: pollGithubDeviceTokenOnce,
    fetchUser: fetchGithubUser,
    now: () => Date.now(),
    getPending: () => pendingLogin,
    setPending: (next) => {
      pendingLogin = next;
    },
  };
}

export function createGithubAuthHandlers(
  deps: GithubAuthDeps = createDefaultGithubAuthDeps(),
): GithubAuthHandlers {
  return {
    async handleStatus(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
      return jsonResponse(await buildStatus(deps));
    },

    async handleLogin(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
      try {
        const device = await deps.requestDeviceCode();
        const now = deps.now();
        const uris = resolveGithubDeviceVerificationUris(device);
        const pending: PendingGithubDeviceLogin = {
          deviceCode: device.device_code,
          userCode: device.user_code,
          verificationUri: uris.verification_uri,
          verificationUriComplete: uris.verification_uri_complete,
          expiresAt: now + (device.expires_in ?? 900) * 1000,
          intervalMs: (device.interval ?? 5) * 1000,
        };
        deps.setPending(pending);
        return jsonResponse({
          ...(await buildStatus(deps)),
          pendingLogin: pendingPayload(pending),
        } satisfies GithubAuthStatus);
      } catch (error) {
        return jsonResponse(
          {
            error: "github_login_failed",
            message: errorMessage(error),
          },
          { status: 502 },
        );
      }
    },

    async handleLoginPoll(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
      const pending = deps.getPending();
      if (!pending) {
        return jsonResponse(
          {
            status: "error",
            message: "No GitHub login in progress",
          } satisfies GithubAuthLoginPollResult,
          { status: 409 },
        );
      }
      if (pending.expiresAt <= deps.now()) {
        deps.setPending(null);
        return jsonResponse(
          {
            status: "error",
            message: "GitHub login code expired",
          } satisfies GithubAuthLoginPollResult,
          { status: 410 },
        );
      }
      try {
        const result = await deps.pollDeviceTokenOnce(pending.deviceCode, {
          intervalMs: pending.intervalMs,
        });
        if (result.status === "pending") {
          pending.intervalMs = result.intervalMs;
          deps.setPending(pending);
          return jsonResponse({
            status: "pending",
            intervalMs: result.intervalMs,
          } satisfies GithubAuthLoginPollResult);
        }
        if (result.status === "error") {
          deps.setPending(null);
          return jsonResponse(
            {
              status: "error",
              message: result.message,
            } satisfies GithubAuthLoginPollResult,
            { status: 502 },
          );
        }
        let identity: { login: string; id: number; name?: string } | undefined;
        try {
          identity = await deps.fetchUser(result.token.access_token);
        } catch {
          // best-effort
        }
        deps.saveSession(
          sessionFromDeviceToken(result.token, identity, {
            now: () => deps.now(),
          }),
        );
        deps.setPending(null);
        return jsonResponse({
          status: "complete",
          auth: await buildStatus(deps),
        } satisfies GithubAuthLoginPollResult);
      } catch (error) {
        deps.setPending(null);
        return jsonResponse(
          {
            status: "error",
            message: errorMessage(error),
          } satisfies GithubAuthLoginPollResult,
          { status: 502 },
        );
      }
    },

    async handleLoginCancel(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
      deps.setPending(null);
      return jsonResponse(await buildStatus(deps));
    },

    async handleLogout(request, token) {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
      deps.setPending(null);
      deps.clearSession();
      return jsonResponse(await buildStatus(deps));
    },
  };
}
