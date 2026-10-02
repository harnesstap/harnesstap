export const DEFAULT_GITHUB_APP_CLIENT_ID = "Iv23liiaeCAUoGKe2uUx";
export const GITHUB_APP_CLIENT_ID_ENV = "HARNESSTAP_GITHUB_APP_CLIENT_ID";
export const GITHUB_APP_CLIENT_SECRET_ENV = "HARNESSTAP_GITHUB_APP_CLIENT_SECRET";

export const GITHUB_DEVICE_CODE_URL = "https://github.com/login/device/code";
export const GITHUB_OAUTH_ACCESS_TOKEN_URL =
  "https://github.com/login/oauth/access_token";
export const GITHUB_API_URL = "https://api.github.com";
export const GITHUB_DEVICE_VERIFICATION_URL = "https://github.com/login/device";

export function resolveGithubAppClientId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const override = env[GITHUB_APP_CLIENT_ID_ENV]?.trim();
  return override && override.length > 0
    ? override
    : DEFAULT_GITHUB_APP_CLIENT_ID;
}

export function resolveGithubAppClientSecret(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const secret = env[GITHUB_APP_CLIENT_SECRET_ENV]?.trim();
  return secret && secret.length > 0 ? secret : undefined;
}
