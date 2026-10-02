import { defaultRunCommand, type RunCommand } from "../plugins/run-command.js";

/**
 * Shared GitHub credential resolution for a future login implementation.
 * See docs/design/github-login.md. This module does not run OAuth and is not
 * wired into git clone yet.
 */
export type GithubCredentialSource =
  | "harnesstap_env"
  | "gh_token_env"
  | "github_token_env"
  | "stored"
  | "gh_cli"
  | "none";

export interface GithubCredential {
  token: string | null;
  source: GithubCredentialSource;
}

export type GithubStoredTokenReader = () => string | null | Promise<string | null>;

export interface ResolveGithubCredentialOptions {
  env?: NodeJS.Dict<string>;
  readStoredToken?: GithubStoredTokenReader;
  runCommand?: RunCommand;
}

const ENV_SOURCES = [
  ["HARNESSTAP_GITHUB_TOKEN", "harnesstap_env"],
  ["GH_TOKEN", "gh_token_env"],
  ["GITHUB_TOKEN", "github_token_env"],
] as const satisfies ReadonlyArray<readonly [string, GithubCredentialSource]>;

function firstEnvToken(
  env: NodeJS.Dict<string>,
): GithubCredential | null {
  for (const [key, source] of ENV_SOURCES) {
    const token = env[key]?.trim();
    if (token) {
      return { token, source };
    }
  }
  return null;
}

function readGhCliToken(run: RunCommand): string | null {
  const result = run("gh", ["auth", "token"]);
  if (result.exitCode !== 0) {
    return null;
  }
  const token = result.stdout.trim();
  return token.length > 0 ? token : null;
}

export async function resolveGithubCredential(
  options: ResolveGithubCredentialOptions = {},
): Promise<GithubCredential> {
  const fromEnv = firstEnvToken(options.env ?? process.env);
  if (fromEnv) {
    return fromEnv;
  }

  const stored = (await options.readStoredToken?.())?.trim();
  if (stored) {
    return { token: stored, source: "stored" };
  }

  const ghToken = readGhCliToken(options.runCommand ?? defaultRunCommand);
  if (ghToken) {
    return { token: ghToken, source: "gh_cli" };
  }

  return { token: null, source: "none" };
}

export function githubHttpsExtraHeader(token: string): string {
  return `Authorization: Bearer ${token}`;
}

/**
 * Git `-c` args that attach a bearer token to HTTPS requests.
 * Prefer a GIT_ASKPASS helper in the implementation PR so the token is not
 * visible on the git argv.
 */
export function gitHttpsAuthConfigArgs(token: string): string[] {
  return ["-c", `http.extraHeader=${githubHttpsExtraHeader(token)}`];
}

export function describeGithubCredentialSource(source: GithubCredentialSource): string {
  switch (source) {
    case "harnesstap_env":
      return "HARNESSTAP_GITHUB_TOKEN";
    case "gh_token_env":
      return "GH_TOKEN";
    case "github_token_env":
      return "GITHUB_TOKEN";
    case "stored":
      return "stored HarnessTap GitHub session";
    case "gh_cli":
      return "gh auth token";
    case "none":
      return "none";
    default: {
      const _exhaustive: never = source;
      return _exhaustive;
    }
  }
}
