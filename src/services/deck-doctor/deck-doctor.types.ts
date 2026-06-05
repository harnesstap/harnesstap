import type { DeckJson } from "../../types.js";

export interface DeckDoctorCheckResult {
  severity: "ok" | "warn" | "error";
  message: string;
  detail?: string;
  fix?: string;
}

export interface DeckDoctorContext {
  repoRoot: string;
  deckJson: DeckJson;
}

export interface DeckDoctorCheck {
  id: string;
  description: string;
  run(context: DeckDoctorContext): DeckDoctorCheckResult[] | Promise<DeckDoctorCheckResult[]>;
}

export interface DeckDoctorResult extends DeckDoctorCheckResult {
  check: string;
}
