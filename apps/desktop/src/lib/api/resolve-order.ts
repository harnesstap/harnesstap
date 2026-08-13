import { agentFetch, throwAgentError } from "./http";

export interface OrderMigrationOverride {
  root: string;
  key: string;
  winner: string;
}

export interface OrderMigrationReport {
  projectsWithSnapshot: number;
  projectsWithoutSnapshot: number;
  overridesWritten: OrderMigrationOverride[];
  warnings: string[];
}

export async function postMigrateResolveOrder(
  baseUrl: string,
  token: string | null,
  dryRun: boolean,
): Promise<OrderMigrationReport> {
  const response = await agentFetch(baseUrl, token, "/v1/migrate/resolve-order", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dryRun }),
  });
  if (!response.ok) {
    return throwAgentError(
      response,
      "Could not convert apply-order to overrides.",
    );
  }
  return (await response.json()) as OrderMigrationReport;
}
