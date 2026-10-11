const ROOT_VERSION_FLAGS = new Set(["-V", "--version", "--harnesstap-version"]);
const ROOT_PASSTHROUGH_FLAGS = new Set([
  "-v",
  "--verbose",
  "--no-color",
  "--no-interactive",
]);

function argvTokens(argv: string[]): string[] {
  return argv.slice(2);
}

export function isRootVersionRequest(argv: string[]): boolean {
  const args = argvTokens(argv);
  let sawVersion = false;
  for (const arg of args) {
    if (arg === "--") {
      return false;
    }
    if (ROOT_VERSION_FLAGS.has(arg)) {
      sawVersion = true;
      continue;
    }
    if (ROOT_PASSTHROUGH_FLAGS.has(arg)) {
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return false;
  }
  return sawVersion;
}

export function isRootHelpRequest(argv: string[]): boolean {
  const args = argvTokens(argv);
  if (args.length === 0) {
    return true;
  }
  let sawHelp = false;
  for (const arg of args) {
    if (arg === "--") {
      return false;
    }
    if (arg === "-h" || arg === "--help") {
      sawHelp = true;
      continue;
    }
    if (ROOT_PASSTHROUGH_FLAGS.has(arg)) {
      continue;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    return false;
  }
  return sawHelp;
}

export function positionalArgvTokens(argv: string[]): string[] {
  const tokens: string[] = [];
  const args = argvTokens(argv);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg === "--") {
      tokens.push(...args.slice(i + 1));
      break;
    }
    if (arg.startsWith("-")) {
      continue;
    }
    tokens.push(arg);
  }
  return tokens;
}
