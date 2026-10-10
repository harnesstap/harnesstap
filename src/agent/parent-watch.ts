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

/** Exit when the desktop parent dies (stdin closed or parent pid gone). */
export function installAgentParentWatch(options: AgentParentWatch): () => void {
  let stopped = false;
  const once = (): void => {
    if (stopped) {
      return;
    }
    stopped = true;
    options.onOrphan();
  };
  const isAlive = options.isAlive ?? ((pid: number) => parentProcessAlive(pid));
  const intervalMs = options.intervalMs ?? 1000;
  const timer = setInterval(() => {
    if (!isAlive(options.parentPid)) {
      once();
    }
  }, intervalMs);
  timer.unref?.();
  const stdin = options.stdin;
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
    clearInterval(timer);
    stdin?.off("end", onStdinGone);
    stdin?.off("close", onStdinGone);
  };
}
