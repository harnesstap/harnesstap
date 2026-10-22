import { getDisplayHome } from "./display-home";

const DEFAULT_MAX = 42;

function normalized(path: string): string {
  return path.replaceAll("\\", "/");
}

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

/** Collapse `$HOME` to `~` without shortening the rest of the path. */
export function tildeHomePath(path: string): string {
  const configured = getDisplayHome();
  const configuredNorm = configured ? normalized(configured) : null;
  const pathNorm = normalized(path);
  const home = configuredNorm
    && (pathNorm === configuredNorm || pathNorm.startsWith(`${configuredNorm}/`))
    ? configuredNorm
    : inferredHomePrefix(pathNorm);
  if (home && (pathNorm === home || pathNorm.startsWith(`${home}/`))) {
    return `~${pathNorm.slice(home.length)}`;
  }
  return pathNorm;
}

/** Collapse `$HOME` to `~` and ellipsize the middle when the path is still long. */
export function compactHomePath(
  path: string,
  maxLength: number = DEFAULT_MAX,
): string {
  const next = tildeHomePath(path);
  if (next.length <= maxLength) {
    return next;
  }
  const keep = Math.max(1, Math.floor((Math.max(3, maxLength) - 3) / 2));
  return `${next.slice(0, keep)}...${next.slice(-keep)}`;
}
