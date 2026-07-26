interface BunServeOptions {
  hostname?: string;
  port?: number;
  fetch: (request: Request) => Response | Promise<Response>;
}

export interface BunServerHandle {
  port: number;
  hostname: string;
  stop(closeActiveConnections?: boolean): void;
  url: URL;
}

interface BunGlobal {
  serve(options: BunServeOptions): BunServerHandle;
}

export function assertBunRuntime(): void {
  if (!("Bun" in globalThis)) {
    throw new Error("HarnessTap agent server requires the Bun runtime");
  }
}

export function bunServe(options: BunServeOptions): BunServerHandle {
  assertBunRuntime();
  return (globalThis as typeof globalThis & { Bun: BunGlobal }).Bun.serve(
    options,
  );
}
