const BEARER_PREFIX = "Bearer ";

export function parseBearerToken(
  authorizationHeader: string | null,
): string | undefined {
  if (!authorizationHeader?.startsWith(BEARER_PREFIX)) {
    return undefined;
  }

  const token = authorizationHeader.slice(BEARER_PREFIX.length).trim();
  return token.length > 0 ? token : undefined;
}

export function isAuthorizedAgentRequest(
  request: Request,
  expectedToken: string,
): boolean {
  const token = parseBearerToken(request.headers.get("authorization"));
  return token !== undefined && token === expectedToken;
}

export function unauthorizedAgentResponse(): Response {
  return Response.json(
    { error: "unauthorized", message: "Missing or invalid Bearer token" },
    { status: 401 },
  );
}

export function requireAgentBearerAuth(
  request: Request,
  expectedToken: string,
): Response | undefined {
  if (isAuthorizedAgentRequest(request, expectedToken)) {
    return undefined;
  }
  return unauthorizedAgentResponse();
}
