import { getDb } from "../db/connection.js";
import { initializeSchema } from "../db/schema.js";
import { ensureDefaultEnvironment } from "../services/ensure-default-environment.js";
import { ensureDefaultProfilePlugin } from "../services/ensure-default-profile.js";
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

function bootAgentDatabase(): void {
  const db = getDb();
  initializeSchema(db);
  // Fresh desktop installs never run `ht init`; seed a default profile and
  // environment so the rail and environment picker are never empty.
  ensureDefaultProfilePlugin();
  ensureDefaultEnvironment();
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

export function startAgentServer(options: AgentServeOptions = {}): AgentServer {
  const host = options.host ?? DEFAULT_AGENT_HOST;
  const preferredPort = resolvePreferredPort(options);
  const token = generateAgentToken();

  bootAgentDatabase();

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
