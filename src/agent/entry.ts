import { startAgentServer } from "./serve.js";

if (import.meta.main) {
  const server = startAgentServer();
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
