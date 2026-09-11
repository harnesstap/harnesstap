const DEFAULT_MAX = 42;

function inferredHomePrefix(path: string): string | null {
  const unixHome = path.match(/^\/home\/[^/]+/);
  if (unixHome) {
    return unixHome[0];
  }
  const macHome = path.match(/^\/Users\/[^/]+/);
  if (macHome) {
    return macHome[0];
  }
  const winHome = path.match(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+/);
  if (winHome) {
    return winHome[0];
  }
  return null;
}

/** Collapse `$HOME` to `~` and ellipsize the middle when the path is still long. */
export function compactHomePath(
  path: string,
  maxLength: number = DEFAULT_MAX,
): string {
  const home = inferredHomePrefix(path);
  let next = path;
  if (home && (next === home || next.startsWith(`${home}/`) || next.startsWith(`${home}\\`))) {
    next = `~${next.slice(home.length)}`;
  }
  if (next.length <= maxLength) {
    return next;
  }
  const keep = Math.max(8, Math.floor((maxLength - 1) / 2));
  return `${next.slice(0, keep)}…${next.slice(-keep)}`;
}
