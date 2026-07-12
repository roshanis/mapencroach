"""Encroachment case lifecycle state machine.

Encodes due process: a case cannot skip show-cause notice, hearing, or a
reasoned order on its way to enforcement, and every state-changing action
must carry the evidentiary artifact the law requires (inspection report,
dispatch proof, hearing record, etc). Courts and repeat inspections can
pause the forward chain (STAYED_BY_COURT, SURVEY_REQUESTED) but the only
way out of a pause is back to where it was entered — the chain itself
never loses its place. Time is caller-supplied so the engine has no
wall-clock dependency and stays deterministic under test.
"""

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from types import MappingProxyType


class CaseState(StrEnum):
    NEW = "NEW"
    TRIAGED = "TRIAGED"
    INSPECTION_ASSIGNED = "INSPECTION_ASSIGNED"
    INSPECTED = "INSPECTED"
    SHOW_CAUSE_ISSUED = "SHOW_CAUSE_ISSUED"
    RESPONSE_WINDOW = "RESPONSE_WINDOW"
    HEARING_SCHEDULED = "HEARING_SCHEDULED"
    HEARING_HELD = "HEARING_HELD"
    ORDER_ISSUED = "ORDER_ISSUED"
    ACTION_TAKEN = "ACTION_TAKEN"
    CLOSED = "CLOSED"
    DISMISSED_FALSE_POSITIVE = "DISMISSED_FALSE_POSITIVE"
    LEGACY_REFERRED = "LEGACY_REFERRED"
    SURVEY_REQUESTED = "SURVEY_REQUESTED"
    STAYED_BY_COURT = "STAYED_BY_COURT"


class CaseEngineError(Exception):
    """Base class for case engine violations."""


class InvalidTransition(CaseEngineError):
    def __init__(self, from_state: CaseState, to_state: CaseState) -> None:
        self.from_state = from_state
        self.to_state = to_state
        super().__init__(f"cannot transition from {from_state.value} to {to_state.value}")


class MissingArtifact(CaseEngineError):
    def __init__(self, to_state: CaseState, missing: list[str]) -> None:
        self.to_state = to_state
        self.missing = missing
        joined = ", ".join(missing)
        super().__init__(f"transition to {to_state.value} missing required artifact(s): {joined}")


# The forward chain, in order. Each state is only reachable from its
# immediate predecessor.
FORWARD_CHAIN: list[CaseState] = [
    CaseState.NEW,
    CaseState.TRIAGED,
    CaseState.INSPECTION_ASSIGNED,
    CaseState.INSPECTED,
    CaseState.SHOW_CAUSE_ISSUED,
    CaseState.RESPONSE_WINDOW,
    CaseState.HEARING_SCHEDULED,
    CaseState.HEARING_HELD,
    CaseState.ORDER_ISSUED,
    CaseState.ACTION_TAKEN,
    CaseState.CLOSED,
]

_FORWARD_INDEX: dict[CaseState, int] = {state: i for i, state in enumerate(FORWARD_CHAIN)}

TERMINAL_STATES: frozenset[CaseState] = frozenset(
    {CaseState.CLOSED, CaseState.DISMISSED_FALSE_POSITIVE, CaseState.LEGACY_REFERRED}
)

# States from which SURVEY_REQUESTED may be entered (TRIAGED..HEARING_HELD inclusive).
_SURVEY_ELIGIBLE_STATES: frozenset[CaseState] = frozenset(
    FORWARD_CHAIN[_FORWARD_INDEX[CaseState.TRIAGED] : _FORWARD_INDEX[CaseState.HEARING_HELD] + 1]
)

REQUIRED_ARTIFACTS: dict[CaseState, tuple[str, ...]] = {
    CaseState.TRIAGED: ("triage_note",),
    CaseState.INSPECTION_ASSIGNED: ("inspector_id",),
    CaseState.INSPECTED: ("inspection_report",),
    CaseState.SHOW_CAUSE_ISSUED: ("notice_document", "dispatch_proof"),
    CaseState.RESPONSE_WINDOW: (),
    CaseState.HEARING_SCHEDULED: ("hearing_date",),
    CaseState.HEARING_HELD: ("hearing_record",),
    CaseState.ORDER_ISSUED: ("reasoned_order",),
    CaseState.ACTION_TAKEN: ("action_report",),
    CaseState.CLOSED: ("closure_note",),
    CaseState.DISMISSED_FALSE_POSITIVE: ("dismissal_reason",),
    CaseState.LEGACY_REFERRED: ("legacy_rationale",),
    CaseState.SURVEY_REQUESTED: ("survey_request_ref",),
    CaseState.STAYED_BY_COURT: ("stay_order_ref",),
}

_SURVEY_RETURN_ARTIFACT = "survey_result"
_STAY_VACATION_ARTIFACT = "stay_vacation_ref"


@dataclass(frozen=True)
class CaseEvent:
    from_state: CaseState
    to_state: CaseState
    actor: str
    artifacts: MappingProxyType[str, str]
    note: str
    occurred_at: datetime


@dataclass
class Case:
    case_id: str
    state: CaseState
    events: list[CaseEvent] = field(default_factory=list)
    paused_state: CaseState | None = None


def _is_forward_step(from_state: CaseState, to_state: CaseState) -> bool:
    """True if to_state is exactly one step ahead of from_state in the forward chain.

    Callers only reach this once from_state and to_state have already been
    established as ordinary forward-chain states (side states are handled
    by earlier branches in `transition`), so both are guaranteed to be
    present in `_FORWARD_INDEX`.
    """
    return _FORWARD_INDEX[to_state] == _FORWARD_INDEX[from_state] + 1


def allowed_transitions(case: Case) -> set[CaseState]:
    """The set of states `case` may legally transition to right now."""
    state = case.state

    if state in TERMINAL_STATES:
        return set()

    if state == CaseState.STAYED_BY_COURT:
        assert case.paused_state is not None  # noqa: S101 - invariant, not a test
        return {case.paused_state}

    if state == CaseState.SURVEY_REQUESTED:
        assert case.paused_state is not None  # noqa: S101 - invariant, not a test
        return {case.paused_state, CaseState.STAYED_BY_COURT}

    allowed: set[CaseState] = set()

    next_index = _FORWARD_INDEX[state] + 1
    if next_index < len(FORWARD_CHAIN):
        allowed.add(FORWARD_CHAIN[next_index])

    allowed.add(CaseState.DISMISSED_FALSE_POSITIVE)
    allowed.add(CaseState.LEGACY_REFERRED)
    allowed.add(CaseState.STAYED_BY_COURT)

    if state in _SURVEY_ELIGIBLE_STATES:
        allowed.add(CaseState.SURVEY_REQUESTED)

    return allowed


def required_artifacts_for(case: Case, to_state: CaseState) -> tuple[str, ...]:
    """Artifacts required to move `case` to `to_state` from where it is now.

    Mirrors the artifact rules in `transition`: returning from a pause
    needs the pause's exit artifact (stay vacation / survey result), not
    the target state's usual entry artifacts. Assumes the move itself is
    legal; pair with `allowed_transitions` when enumerating options.
    """
    if case.state == CaseState.STAYED_BY_COURT and to_state == case.paused_state:
        return (_STAY_VACATION_ARTIFACT,)
    if case.state == CaseState.SURVEY_REQUESTED and to_state == case.paused_state:
        return (_SURVEY_RETURN_ARTIFACT,)
    return _required_artifacts_for(to_state)


def _required_artifacts_for(to_state: CaseState) -> tuple[str, ...]:
    if to_state == CaseState.SURVEY_REQUESTED:
        return REQUIRED_ARTIFACTS[CaseState.SURVEY_REQUESTED]
    if to_state == CaseState.STAYED_BY_COURT:
        return REQUIRED_ARTIFACTS[CaseState.STAYED_BY_COURT]
    return REQUIRED_ARTIFACTS.get(to_state, ())


def _check_artifacts(
    to_state: CaseState, artifacts: dict[str, str], required: tuple[str, ...]
) -> None:
    missing = [name for name in required if name not in artifacts]
    if missing:
        raise MissingArtifact(to_state, missing)


def transition(
    case: Case,
    to_state: CaseState,
    actor: str,
    occurred_at: datetime,
    artifacts: dict[str, str] | None = None,
    note: str = "",
) -> CaseEvent:
    """Attempt to move `case` to `to_state`, recording a CaseEvent.

    Raises InvalidTransition if the move isn't legal from the current
    state, or MissingArtifact if required evidentiary artifacts are
    absent. On failure the case is left completely unchanged.
    """
    artifacts = artifacts or {}
    from_state = case.state

    if from_state in TERMINAL_STATES:
        raise InvalidTransition(from_state, to_state)

    if from_state == CaseState.STAYED_BY_COURT:
        if to_state != case.paused_state:
            raise InvalidTransition(from_state, to_state)
        _check_artifacts(to_state, artifacts, (_STAY_VACATION_ARTIFACT,))
        new_paused_state = None

    elif from_state == CaseState.SURVEY_REQUESTED:
        if to_state == CaseState.STAYED_BY_COURT:
            _check_artifacts(to_state, artifacts, _required_artifacts_for(to_state))
            new_paused_state = case.paused_state
        elif to_state == case.paused_state:
            _check_artifacts(to_state, artifacts, (_SURVEY_RETURN_ARTIFACT,))
            new_paused_state = None
        else:
            raise InvalidTransition(from_state, to_state)

    elif to_state == CaseState.SURVEY_REQUESTED:
        if from_state not in _SURVEY_ELIGIBLE_STATES:
            raise InvalidTransition(from_state, to_state)
        _check_artifacts(to_state, artifacts, _required_artifacts_for(to_state))
        new_paused_state = from_state

    elif to_state == CaseState.STAYED_BY_COURT:
        _check_artifacts(to_state, artifacts, _required_artifacts_for(to_state))
        new_paused_state = from_state

    elif to_state in (CaseState.DISMISSED_FALSE_POSITIVE, CaseState.LEGACY_REFERRED):
        _check_artifacts(to_state, artifacts, _required_artifacts_for(to_state))
        new_paused_state = case.paused_state

    elif _is_forward_step(from_state, to_state):
        _check_artifacts(to_state, artifacts, _required_artifacts_for(to_state))
        new_paused_state = case.paused_state

    else:
        raise InvalidTransition(from_state, to_state)

    event = CaseEvent(
        from_state=from_state,
        to_state=to_state,
        actor=actor,
        artifacts=MappingProxyType(dict(artifacts)),
        note=note,
        occurred_at=occurred_at,
    )
    case.state = to_state
    case.paused_state = new_paused_state
    case.events.append(event)
    return event
