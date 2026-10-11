import { setTelemetryProduct, trackDesktopStartup } from "../telemetry/index.js";
import { PACKAGE_VERSION } from "../version.js";
import { emitAgentFatalFromError } from "./fatal.js";
import { installAgentParentWatch } from "./parent-watch.js";
import { startAgentServer } from "./serve.js";

// Bun-only entry. isMainModule() realpaths argv[1], which fails for the compiled
// sidecar (/$bunfs/root/ht-agent), so it would exit 0 without starting the server.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--version") || args.includes("-V")) {
    console.log(PACKAGE_VERSION);
    process.exit(0);
  }

  if (process.env.HARNESSTAP_AGENT_SIMULATE_CRASH === "1") {
    console.error("HarnessTap agent simulated startup crash (HARNESSTAP_AGENT_SIMULATE_CRASH=1)");
    process.exit(1);
  }

  setTelemetryProduct("desktop");
  trackDesktopStartup();
  try {
    const server = await startAgentServer();
    console.error(
      `HarnessTap agent listening on ${server.url} (token: ${server.tokenPath})`,
    );

    const shutdown = () => {
      server.stop();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    installAgentParentWatch({
      parentPid: process.ppid,
      onOrphan: shutdown,
      stdin: process.stdin,
    });
  } catch (error) {
    emitAgentFatalFromError(error);
    process.exit(1);
  }
}
