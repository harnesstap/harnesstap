import type { Command } from "commander";
import {
  addApplyCommandOptions,
  type ApplyCommandOpts,
} from "../../services/apply-command-options.js";
import {
  fetchMcpRegistryServer,
  listMcpRegistryServers,
  searchMcpRegistryServers,
} from "../../services/mcp-registry.js";
import { mcpMetadataFromRegistryServer } from "../../services/mcp-registry-resolve.js";
import { parseOutputFormat, printJson } from "../../utils/output-format.js";
import { ui } from "../../ui/index.js";
import { configureCommandGroup } from "../help.js";
import {
  handleInstallCommand,
  type InstallCommandActionOpts,
} from "./apply.js";

interface McpListOpts {
  format?: string;
  limit?: string;
  cursor?: string;
}

interface McpShowOpts {
  format?: string;
}

function printRegistryError(error: unknown): void {
  process.exitCode = 1;
  ui.danger(error instanceof Error ? error.message : String(error));
}

export async function handleMcpSearchCommand(
  query: string | undefined,
  opts: McpListOpts,
): Promise<void> {
  const trimmed = query?.trim();
  if (!trimmed) {
    process.exitCode = 1;
    ui.danger("Provide a search query.");
    return;
  }
  try {
    const result = await searchMcpRegistryServers(trimmed, {
      limit: opts.limit ? Number(opts.limit) : 20,
    });
    printServerList(result, opts.format);
  } catch (error) {
    printRegistryError(error);
  }
}

export async function handleMcpListCommand(opts: McpListOpts): Promise<void> {
  try {
    const result = await listMcpRegistryServers({
      limit: opts.limit ? Number(opts.limit) : 20,
      ...(opts.cursor ? { cursor: opts.cursor } : {}),
    });
    printServerList(result, opts.format);
  } catch (error) {
    printRegistryError(error);
  }
}

export async function handleMcpShowCommand(
  identity: string | undefined,
  opts: McpShowOpts,
): Promise<void> {
  const trimmed = identity?.trim();
  if (!trimmed) {
    process.exitCode = 1;
    ui.danger("Provide an MCP Registry identity (for example io.github.github/github-mcp-server).");
    return;
  }
  try {
    const server = await fetchMcpRegistryServer(trimmed);
    const metadata = mcpMetadataFromRegistryServer(server);
    const format = parseOutputFormat(opts.format);
    if (format === "json") {
      printJson({ server, metadata });
      return;
    }
    ui.kvBlock([
      { key: "Name", value: server.name },
      { key: "Version", value: server.version ?? "latest" },
      ...(server.title ? [{ key: "Title", value: server.title }] : []),
      ...(server.description ? [{ key: "Description", value: server.description }] : []),
      { key: "Transport", value: metadata.transport },
      ...(metadata.command ? [{ key: "Command", value: metadata.command }] : []),
      ...(metadata.args && metadata.args.length > 0
        ? [{ key: "Args", value: metadata.args.join(" ") }]
        : []),
      ...(metadata.url ? [{ key: "URL", value: metadata.url }] : []),
    ]);
  } catch (error) {
    printRegistryError(error);
  }
}

export async function handleMcpInstallCommand(
  identity: string | undefined,
  opts: ApplyCommandOpts,
): Promise<void> {
  const trimmed = identity?.trim();
  if (!trimmed) {
    process.exitCode = 1;
    ui.danger("Provide an MCP Registry identity (for example io.github.github/github-mcp-server).");
    return;
  }
  const installOpts: InstallCommandActionOpts = {
    ...opts,
    mcp: trimmed,
  };
  await handleInstallCommand([], installOpts);
}

function printServerList(
  result: Awaited<ReturnType<typeof listMcpRegistryServers>>,
  format: string | undefined,
): void {
  const parsed = parseOutputFormat(format);
  if (parsed === "json") {
    printJson(result);
    return;
  }
  console.log(
    ui.renderTable({
      columns: [
        { key: "name", header: "NAME", width: 40 },
        { key: "version", header: "VERSION", width: 10 },
        { key: "description", header: "DESCRIPTION", width: 48 },
      ],
      rows: result.servers.map((hit) => ({
        name: hit.server.name,
        version: hit.server.version ?? "",
        description: hit.server.description ?? "",
      })),
      empty: "No MCP registry servers matched.",
    }),
  );
  if (result.nextCursor) {
    ui.dim(`Next page: ht mcp list --cursor ${result.nextCursor}`);
  }
}

export function registerMcpCommands(root: Command): void {
  const mcp = configureCommandGroup(
    root.command("mcp").description("Discover and install MCP Registry servers"),
  );

  mcp
    .command("search")
    .argument("<query>", "Substring search against official MCP Registry names")
    .option("--limit <n>", "Page size", "20")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Search the official MCP Registry")
    .action(async (query: string, opts: McpListOpts) => {
      await handleMcpSearchCommand(query, opts);
    });

  mcp
    .command("list")
    .option("--limit <n>", "Page size", "20")
    .option("--cursor <token>", "Registry pagination cursor")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("List servers from the official MCP Registry")
    .action(async (opts: McpListOpts) => {
      await handleMcpListCommand(opts);
    });

  mcp
    .command("show")
    .argument("<id>", "MCP Registry identity (io.github…)")
    .option("--format <mode>", "Output format: human or json", "human")
    .description("Show one MCP Registry server and the native config HT would emit")
    .action(async (id: string, opts: McpShowOpts) => {
      await handleMcpShowCommand(id, opts);
    });

  const install = mcp
    .command("install")
    .argument("<id>", "MCP Registry identity to append to apm.yml, then install")
    .description("Append an MCP Registry identity to apm.yml and run ht install");
  addApplyCommandOptions(install);
  install.action(async (id: string, opts: ApplyCommandOpts) => {
    await handleMcpInstallCommand(id, opts);
  });
}
