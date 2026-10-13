let displayHome: string | undefined;

/** Remember the home directory reported by the agent so path copy can use `~`. */
export function setDisplayHome(home: string | null | undefined): void {
  const trimmed = home?.trim();
  displayHome = trimmed ? trimmed : undefined;
}

export function getDisplayHome(): string | undefined {
  return displayHome;
}
