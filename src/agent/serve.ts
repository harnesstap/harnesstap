import { getDb } from "../db/connection.js";
import { initializeSchema } from "../db/schema.js";
import { PACKAGE_VERSION } from "../version.js";
import { requireAgentBearerAuth } from "./auth.js";
import { type BunServerHandle, bunServe } from "./bun-runtime.js";
import {
  generateAgentToken,
  getAgentTokenPath,
  writeAgentTokenFile,
} from "./token.js";

export const DEFAULT_AGENT_HOST = "127.0.0.1";
export const DEFAULT_AGENT_PORT = 7474;
const MAX_PORT_ATTEMPTS = 100;

export interface AgentServeOptions {
  host?: string;
  port?: number;
}

export interface AgentServer {
  host: string;
  port: number;
  token: string;
  tokenPath: string;
  url: string;
  stop(closeActiveConnections?: boolean): void;
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}

function isAddressInUseError(error: unknown): boolean {
  return (
    error instanceof Error
    && ("code" in error
      ? error.code === "EADDRINUSE"
      : /EADDRINUSE|address already in use/i.test(error.message))
  );
}

function createAgentFetchHandler(
  token: string,
  port: number,
): (request: Request) => Response | Promise<Response> {
  return (request) => {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "GET" && url.pathname === "/v1/health") {
      return jsonResponse({
        status: "healthy",
        version: PACKAGE_VERSION,
        port,
      });
    }

    if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
      const authError = requireAgentBearerAuth(request, token);
      if (authError) {
        return authError;
      }
    }

    return jsonResponse({ error: "not_found" }, { status: 404 });
  };
}

function bootAgentDatabase(): void {
  const db = getDb();
  initializeSchema(db);
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
  const preferredPort = options.port ?? DEFAULT_AGENT_PORT;
  const token = generateAgentToken();

  bootAgentDatabase();

  let boundPort = preferredPort;
  const fetch = (request: Request) =>
    createAgentFetchHandler(token, boundPort)(request);
  const { server, port } = listenForAgent(host, preferredPort, fetch);
  boundPort = port;
  const tokenPath = writeAgentTokenFile(token);
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
