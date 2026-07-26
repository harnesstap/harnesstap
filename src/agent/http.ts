export function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, init);
}
