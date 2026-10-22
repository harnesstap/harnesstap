const COMMAND_TIMED_OUT = /^Command timed out after (\d+)ms/;

/** True for the stderr `spawnCommand` reports when it stopped a command at its timeout. */
export function isCommandTimeoutStderr(stderr: string): boolean {
  return COMMAND_TIMED_OUT.test(stderr);
}

export function mapGitStderr(stderr: string, url?: string): string {
  const timedOut = stderr.match(COMMAND_TIMED_OUT);
  if (timedOut) {
    const seconds = Math.max(1, Math.round(Number(timedOut[1]) / 1000));
    return `Timed out after ${seconds}s reaching ${url ?? "that git repository"}.`;
  }
  if (stderr.startsWith("Couldn't reach")) {
    return stderr.endsWith(".") ? stderr : `${stderr}.`;
  }
  if (url) {
    return `Couldn't reach ${url}.`;
  }
  return "Couldn't reach that git repository.";
}

export function gitFailureHint(): string {
  return "Check the URL, or sign in with ht github login if it's private.";
}
