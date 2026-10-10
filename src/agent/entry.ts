import { setTelemetryProduct, trackDesktopStartup } from "../telemetry/index.js";
import { isMainModule } from "../utils/is-main-module.js";
import { startAgentServer } from "./serve.js";

if (isMainModule(import.meta.url)) {
  setTelemetryProduct("desktop");
  trackDesktopStartup();
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
}
