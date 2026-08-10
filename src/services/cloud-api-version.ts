import { fetchWithTimeout } from "../utils/fetch-with-timeout.js";
import { PACKAGE_VERSION } from "../version.js";

export const CLI_VERSION_HEADER = "X-HarnessTap-CLI-Version";
export const API_VERSION_HEADER = "X-HarnessTap-API-Version";
export const MINIMUM_CLI_VERSION_HEADER = "x-harnesstap-minimum-cli-version";

/** Wire contract this CLI speaks. Bumped in lockstep with the cloud. */
export const CLIENT_API_VERSION = 1 as const;

export const AP_PACKAGE_MEDIA_TYPE = "application/vnd.harnesstap.ap-package+json";

export class CliTooOldError extends Error {
  readonly minimumVersion: string;

  constructor(minimumVersion: string, fix: string) {
    super(
      `Your HarnessTap CLI (${PACKAGE_VERSION}) is too old for this cloud API, ` +
        `which requires ${minimumVersion} or newer.\n  fix: ${fix}`,
    );
    this.name = "CliTooOldError";
    this.minimumVersion = minimumVersion;
  }
}

export function cloudRequestHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    ...extra,
    [CLI_VERSION_HEADER]: PACKAGE_VERSION,
    [API_VERSION_HEADER]: String(CLIENT_API_VERSION),
  };
}

export async function throwIfCliTooOld(response: Response): Promise<void> {
  if (response.status !== 426) return;
  let minimumVersion = "a newer version";
  let fix = "npm install -g harnesstap@latest";
  try {
    // clone() so the caller can still read the body on other statuses.
    const body = (await response.clone().json()) as { minimumVersion?: string; fix?: string };
    if (body.minimumVersion) minimumVersion = body.minimumVersion;
    if (body.fix) fix = body.fix;
  } catch {
    // A 426 from a proxy may carry no JSON; the defaults still name a fix.
  }
  throw new CliTooOldError(minimumVersion, fix);
}

/** Every cloud request goes through here so the headers and gate are uniform. */
export async function cloudFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetchWithTimeout(input, {
    ...init,
    headers: cloudRequestHeaders(Object.fromEntries(new Headers(init?.headers).entries())),
  });
  await throwIfCliTooOld(response);
  return response;
}
