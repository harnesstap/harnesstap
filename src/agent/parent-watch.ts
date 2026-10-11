import { fstatSync } from "node:fs";

export function parentProcessAlive(
  pid: number,
  killFn: (pid: number, signal: 0) => boolean | void = process.kill,
): boolean {
  if (pid <= 1) {
    return true;
  }
  try {
    killFn(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface AgentParentWatch {
  parentPid: number;
  onOrphan: () => void;
  intervalMs?: number;
  stdin?: NodeJS.ReadableStream | null;
  isAlive?: (pid: number) => boolean;
}

/**
 * Desktop holds a stdin pipe and closing it means the parent died.
 * `/dev/null`, a TTY, or an already-closed fd is not that pipe: watching it
 * would exit the compiled sidecar as soon as it starts (`stdio: ignore`).
 */
function readableFd(stdin: NodeJS.ReadableStream): number | undefined {
  if (!("fd" in stdin)) {
    return undefined;
  }
  const fd = stdin.fd;
  return typeof fd === "number" ? fd : undefined;
}

export function stdinIsParentPipe(stdin: NodeJS.ReadableStream | null | undefined): boolean {
  if (!stdin) {
    return false;
  }
  const fd = readableFd(stdin);
  if (fd === undefined) {
    return true;
  }
  try {
    return fstatSync(fd).isFIFO();
  } catch {
    return false;
  }
}

/**
 * Exit when the desktop parent dies. The Tauri host holds a stdin pipe, so
 * EOF or a dead parent pid both mean quit. A background `demo-home.sh` (CI
 * visual) has no such pipe: its launching step exits while shots still need
 * the agent, so do not treat that ppid as an orphan.
 */
export function installAgentParentWatch(options: AgentParentWatch): () => void {
  let stopped = false;
  const once = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    options.onOrphan();
  };
  const piped = stdinIsParentPipe(options.stdin);
  const stdin = piped ? options.stdin : null;
  let timer: ReturnType<typeof setInterval> | undefined;
  if (piped) {
    const isAlive = options.isAlive ?? ((pid: number) => parentProcessAlive(pid));
    const intervalMs = options.intervalMs ?? 1000;
    timer = setInterval(() => {
      if (!isAlive(options.parentPid)) {
        once();
      }
    }, intervalMs);
    timer.unref?.();
  }
  const onStdinGone = (): void => {
    once();
  };
  if (stdin) {
    if (typeof (stdin as NodeJS.ReadStream).resume === "function") {
      (stdin as NodeJS.ReadStream).resume();
    }
    stdin.on("end", onStdinGone);
    stdin.on("close", onStdinGone);
  }
  return () => {
    stopped = true;
    if (timer) {
      clearInterval(timer);
    }
    stdin?.off("end", onStdinGone);
    stdin?.off("close", onStdinGone);
  };
}
