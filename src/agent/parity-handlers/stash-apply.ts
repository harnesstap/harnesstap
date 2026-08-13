export async function tryHandle(
  _request: Request,
  _token: string,
  _deps: { isAgentSwitchInProgress: () => boolean },
): Promise<Response | null> {
  return null;
}
