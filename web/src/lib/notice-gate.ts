// Pure authorization gate for the notice-drafting workspace.
//
// The generated draft is always watermarked "DRAFT — NOT FOR SERVICE", but
// the watermark alone is not sufficient: the workspace must not be *offered*
// at all to read-only personas, or for cases that are outside the active
// due-process chain (paused, terminal, or otherwise resolved). This helper
// is the single source of truth for that decision so the check can be unit
// tested independently of cookies, React, or Next.js server context.

import { CASE_STATE_CHAIN } from "./types";
import type { AnyCaseState } from "./types";

export interface CanDraftNoticeInput {
  /**
   * The active persona's role (e.g. "case_officer", "viewer",
   * "survey_officer", "data_admin", "state_viewer"). `undefined` means no
   * persona cookie is set, which in this demo is the default case-officer
   * session — treated the same as an explicit "case_officer".
   */
  role?: string;
  state: AnyCaseState;
}

const IN_CHAIN_STATES: ReadonlySet<string> = new Set(CASE_STATE_CHAIN);

/**
 * True only when both hold:
 *  - the persona is a case officer (or the cookie-less default session), and
 *  - the case is in an active in-chain due-process stage — a member of
 *    CASE_STATE_CHAIN other than the terminal "CLOSED" state.
 *
 * Every special/paused/terminal state (STAYED_BY_COURT, SURVEY_REQUESTED,
 * DISMISSED_FALSE_POSITIVE, LEGACY_REFERRED) and every non-officer role
 * (viewer, state_viewer, survey_officer, data_admin, ...) resolve to false.
 */
export function canDraftNotice({ role, state }: CanDraftNoticeInput): boolean {
  const isCaseOfficer = role === undefined || role === "case_officer";
  if (!isCaseOfficer) return false;

  return IN_CHAIN_STATES.has(state) && state !== "CLOSED";
}
