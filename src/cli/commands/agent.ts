import type { Command } from "commander";
import { startAgentServer } from "../../agent/serve.js";
import { configureCommandGroup } from "../help.js";

function parsePort(value: string): number {
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`invalid port: ${value}`);
  }
  return port;
}

export async function runAgentServeCommand(options: {
  port?: number;
}): Promise<void> {
  const server = startAgentServer({ port: options.port });
  console.error(
    `HarnessTap agent listening on ${server.url} (token: ${server.tokenPath})`,
  );

  await new Promise<void>((resolve) => {
    const shutdown = () => {
      server.stop();
      resolve();
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  });
}

export function registerAgentCommands(root: Command): void {
  const agentCmd = configureCommandGroup(
    root.command("agent").description("HarnessTap loopback agent (engineering debug)"),
  );

  agentCmd
    .command("serve")
    .description("Start the loopback agent HTTP server")
    .option("--port <port>", "Listen port (default 7474, or next free)", parsePort)
    .action(async (opts: { port?: number }) => {
      await runAgentServeCommand({ port: opts.port });
    });
}

export function registerUiDebugCommand(root: Command): void {
  root
    .command("ui")
    .description("HarnessTap desktop UI entry (engineering debug)")
    .option("--serve", "Start the loopback agent HTTP server")
    .option("--port <port>", "Listen port (default 7474, or next free)", parsePort)
    .action(async (opts: { serve?: boolean; port?: number }) => {
      if (!opts.serve) {
        throw new Error("ui requires --serve until the desktop shell ships");
      }
      await runAgentServeCommand({ port: opts.port });
    });
}
