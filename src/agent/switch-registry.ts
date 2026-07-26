import { randomUUID } from "node:crypto";
import type { ProfileSwitchStepEvent } from "../services/profile-switch.js";

export type AgentSwitchStep = ProfileSwitchStepEvent["step"];

export interface AgentSwitchSession {
  id: string;
  cancelRequested: boolean;
  currentStep: AgentSwitchStep | null;
  stepInProgress: boolean;
  events: ProfileSwitchStepEvent[];
  finalResult: unknown;
  finalError: string | null;
  done: boolean;
  subscribers: Set<(event: ProfileSwitchStepEvent | AgentSwitchFinalEvent) => void>;
}

export interface AgentSwitchFinalEvent {
  type: "result";
  ok: boolean;
  cancelled?: boolean;
  result?: unknown;
  error?: string;
}

const sessions = new Map<string, AgentSwitchSession>();
let activeSwitchId: string | null = null;

export function isAgentSwitchInProgress(): boolean {
  return activeSwitchId !== null;
}

export function getActiveAgentSwitchId(): string | null {
  return activeSwitchId;
}

export function createAgentSwitchSession(): AgentSwitchSession {
  const session: AgentSwitchSession = {
    id: randomUUID(),
    cancelRequested: false,
    currentStep: null,
    stepInProgress: false,
    events: [],
    finalResult: null,
    finalError: null,
    done: false,
    subscribers: new Set(),
  };
  sessions.set(session.id, session);
  activeSwitchId = session.id;
  return session;
}

export function getAgentSwitchSession(id: string): AgentSwitchSession | undefined {
  return sessions.get(id);
}

export function clearActiveAgentSwitch(id: string): void {
  if (activeSwitchId === id) {
    activeSwitchId = null;
  }
}

export function emitAgentSwitchStep(
  session: AgentSwitchSession,
  event: ProfileSwitchStepEvent,
): void {
  session.events.push(event);
  session.currentStep = event.step;
  session.stepInProgress = event.status === "started";
  for (const subscriber of session.subscribers) {
    subscriber(event);
  }
}

export function emitAgentSwitchFinal(
  session: AgentSwitchSession,
  payload: AgentSwitchFinalEvent,
): void {
  session.done = true;
  session.stepInProgress = false;
  session.finalResult = payload.result ?? null;
  session.finalError = payload.error ?? null;
  for (const subscriber of session.subscribers) {
    subscriber(payload);
  }
  clearActiveAgentSwitch(session.id);
}

export function requestAgentSwitchCancel(session: AgentSwitchSession): {
  accepted: boolean;
  reason?: "apply_in_progress" | "already_done";
} {
  if (session.done) {
    return { accepted: false, reason: "already_done" };
  }
  if (session.stepInProgress) {
    return { accepted: false, reason: "apply_in_progress" };
  }
  session.cancelRequested = true;
  return { accepted: true };
}

export function isAgentSwitchCancelled(session: AgentSwitchSession): boolean {
  return session.cancelRequested;
}

export function subscribeAgentSwitchEvents(
  session: AgentSwitchSession,
  listener: (event: ProfileSwitchStepEvent | AgentSwitchFinalEvent) => void,
): () => void {
  for (const event of session.events) {
    listener(event);
  }
  if (session.done) {
    listener({
      type: "result",
      ok: session.finalError === null && session.finalResult !== null,
      ...(session.finalResult !== null ? { result: session.finalResult } : {}),
      ...(session.finalError ? { error: session.finalError, ok: false } : {}),
    });
    return () => {};
  }

  session.subscribers.add(listener);
  return () => {
    session.subscribers.delete(listener);
  };
}

export function resetAgentSwitchRegistryForTests(): void {
  sessions.clear();
  activeSwitchId = null;
}
