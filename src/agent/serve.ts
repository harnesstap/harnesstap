import { existsSync } from "node:fs";
import { getDbPath } from "../db/connection.js";
import { bootstrapLocalLibrary } from "../services/bootstrap-local-library.js";
import { setAgentFirstRun } from "./boot-state.js";
import { type BunServerHandle, bunServe } from "./bun-runtime.js";
import { createAgentFetchHandler } from "./routes.js";
import {
  generateAgentToken,
  getAgentTokenPath,
  writeAgentPortFile,
  writeAgentTokenFile,
} from "./token.js";

export const DEFAULT_AGENT_HOST = "127.0.0.1";
export const DEFAULT_AGENT_PORT = 7474;
const MAX_PORT_ATTEMPTS = 100;

export interface AgentServeOptions {
  host?: string;
  port?: number;
}

function resolvePreferredPort(options: AgentServeOptions): number {
  if (typeof options.port === "number") {
    return options.port;
  }
  const fromEnv = process.env.HARNESSTAP_AGENT_PORT;
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65_535) {
      return parsed;
    }
  }
  return DEFAULT_AGENT_PORT;
}

export interface AgentServer {
  host: string;
  port: number;
  token: string;
  tokenPath: string;
  url: string;
  stop(closeActiveConnections?: boolean): void;
}

function isAddressInUseError(error: unknown): boolean {
  return (
    error instanceof Error
    && ("code" in error
      ? error.code === "EADDRINUSE"
      : /EADDRINUSE|address already in use/i.test(error.message))
  );
}

async function bootAgentDatabase(): Promise<void> {
  const firstRun = !existsSync(getDbPath());
  const result = await bootstrapLocalLibrary();
  setAgentFirstRun(firstRun || result.firstRun);
}

function listenForAgent(
  host: string,
  preferredPort: number,
  fetch: (request: Request) => Response | Promise<Response>,
): { server: BunServerHandle; port: number } {
  for (let offset = 0; offset < MAX_PORT_ATTEMPTS; offset++) {
    const port = preferredPort + offset;
    try {
      const server = bunServe({ hostname: host, port, fetch });
      return { server, port: server.port };
    } catch (error) {
      if (!isAddressInUseError(error) || offset === MAX_PORT_ATTEMPTS - 1) {
        throw error;
      }
    }
  }

  throw new Error(
    `Unable to bind HarnessTap agent on ${host} (ports ${preferredPort}-${preferredPort + MAX_PORT_ATTEMPTS - 1})`,
  );
}

export async function startAgentServer(options: AgentServeOptions = {}): Promise<AgentServer> {
  const host = options.host ?? DEFAULT_AGENT_HOST;
  const preferredPort = resolvePreferredPort(options);
  const token = generateAgentToken();

  await bootAgentDatabase();

  let boundPort = preferredPort;
  const fetch = (request: Request) =>
    createAgentFetchHandler(token, boundPort)(request);
  const { server, port } = listenForAgent(host, preferredPort, fetch);
  boundPort = port;
  const tokenPath = writeAgentTokenFile(token);
  writeAgentPortFile(port);
  const url = `http://${host}:${port}`;

  return {
    host,
    port,
    token,
    tokenPath,
    url,
    stop: (closeActiveConnections) => server.stop(closeActiveConnections),
  };
}

export function getAgentTokenFilePath(): string {
  return getAgentTokenPath();
}

export { createAgentFetchHandler, createAgentRouteHandlers } from "./routes.js";
