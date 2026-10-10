export const MIN_SUPPORTED_NODE_MAJOR = 22;
export const MIN_SUPPORTED_NODE_MINOR = 12;

export function parseNodeVersion(raw: string): { major: number; minor: number } {
  const [majorPart, minorPart] = raw.split(".");
  return {
    major: Number.parseInt(majorPart ?? "0", 10) || 0,
    minor: Number.parseInt(minorPart ?? "0", 10) || 0,
  };
}

export function isSupportedNodeVersion(raw: string): boolean {
  const { major, minor } = parseNodeVersion(raw);
  if (major > MIN_SUPPORTED_NODE_MAJOR) {
    return true;
  }
  if (major === MIN_SUPPORTED_NODE_MAJOR && minor >= MIN_SUPPORTED_NODE_MINOR) {
    return true;
  }
  return false;
}

export function nodeVersionRefusalMessage(raw: string): string {
  return (
    `HarnessTap needs Node.js ${MIN_SUPPORTED_NODE_MAJOR}.${MIN_SUPPORTED_NODE_MINOR} or newer. ` +
    `You have v${raw}. Install Node 22 or 24 from https://nodejs.org`
  );
}

export function isBunRuntime(
  versions: NodeJS.ProcessVersions = process.versions,
): boolean {
  return typeof versions.bun === "string" && versions.bun.length > 0;
}

export function assertSupportedRuntime(
  versions: NodeJS.ProcessVersions = process.versions,
): void {
  if (isBunRuntime(versions)) {
    return;
  }
  if (isSupportedNodeVersion(versions.node)) {
    return;
  }
  console.error(nodeVersionRefusalMessage(versions.node));
  process.exit(1);
}
