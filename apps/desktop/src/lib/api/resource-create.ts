import { agentFetch, throwAgentError } from "./http";

export interface CreateLibraryResourceInput {
  type: string;
  name: string;
  description?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface CreatedLibraryResource {
  id: string;
  type: string;
  name: string;
  namespace: string | null;
  description: string | null;
}

export async function createLibraryResource(
  baseUrl: string,
  token: string | null,
  input: CreateLibraryResourceInput,
): Promise<CreatedLibraryResource> {
  const response = await agentFetch(baseUrl, token, "/v1/library/resources", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    return throwAgentError(response, "Could not create resource");
  }
  const body = (await response.json()) as { resource: CreatedLibraryResource };
  return body.resource;
}
