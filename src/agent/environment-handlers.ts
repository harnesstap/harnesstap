import { listEnvironments } from "../models/environment.js";
import { requireAgentBearerAuth } from "./auth.js";
import { jsonResponse } from "./http.js";

export function handleEnvironmentsList(
  request: Request,
  token: string,
): Response {
  const authError = requireAgentBearerAuth(request, token);
  if (authError) return authError;

  return jsonResponse({
    environments: listEnvironments().map((environment) => ({
      id: environment.id,
      name: environment.name,
      description: environment.description || null,
    })),
  });
}
