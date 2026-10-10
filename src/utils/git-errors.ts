export function mapGitStderr(stderr: string, url?: string): string {
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
