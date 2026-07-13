// Human-readable copy explaining what the console's colors, chips, and
// states mean. Wired in as `title` attributes and footnotes so officers can
// hover/read without leaving the page.

import type { AlertStatus, AlertTier, CaseState } from "./types";

export const TIER_DESCRIPTIONS: Record<AlertTier, string> = {
  red: "New encroachment on high-value land with a trustworthy boundary — act now.",
  amber: "Change detected — investigate before acting.",
  green: "Minor or low-confidence change — monitor.",
  legacy:
    "Occupation predating monitoring — routed to a separate regularization track, not enforcement.",
};

export const ALERT_STATUS_DESCRIPTIONS: Record<AlertStatus, string> = {
  open: "Newly detected — not yet reviewed by an officer.",
  under_review: "An officer is assessing this alert before opening a case.",
  escalated: "Confirmed and moved into the case pipeline for due process.",
  closed: "Reviewed and resolved — no further action expected.",
};

export const SEVERITY_EXPLANATION =
  "Severity is computed, not assigned: size of the change (capped at 1 hectare) × land-category weight (waterbody highest) × boundary trust (Grade A = full, C = half), +20% for repeat offenders. Scale 0–100.";

export const STATE_DESCRIPTIONS: Record<CaseState, string> = {
  NEW: "Case auto-opened from a detector alert; awaiting triage.",
  TRIAGED:
    "An officer has reviewed the alert and logged a triage note before assigning inspection.",
  INSPECTION_ASSIGNED:
    "A field inspector has been assigned; the inspector_id must be on file before the visit is recorded.",
  INSPECTED:
    "The field inspector has filed an inspection report confirming the encroachment on the ground.",
  SHOW_CAUSE_ISSUED:
    "A formal notice must be on file (notice document + dispatch proof) before the response window opens.",
  RESPONSE_WINDOW:
    "The statutory window for the occupant to respond to the notice; no evidence required to be in this state.",
  HEARING_SCHEDULED:
    "A hearing date has been fixed and recorded before the hearing can be held.",
  HEARING_HELD:
    "The hearing has taken place and a hearing record has been filed.",
  ORDER_ISSUED:
    "A reasoned order has been issued disposing of the case one way or another.",
  ACTION_TAKEN:
    "The ordered action has been carried out and documented in an action report.",
  CLOSED: "The case is closed; a closure note has been filed.",
};
