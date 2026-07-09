from datetime import UTC, datetime

import pytest

from mapencroach.domain.case_engine import (
    Case,
    CaseEngineError,
    CaseEvent,
    CaseState,
    InvalidTransition,
    MissingArtifact,
    allowed_transitions,
    transition,
)

T0 = datetime(2026, 1, 1, tzinfo=UTC)

# Forward chain in order, with the artifacts required to enter each state.
FORWARD_CHAIN = [
    (CaseState.TRIAGED, {"triage_note": "note://1"}),
    (CaseState.INSPECTION_ASSIGNED, {"inspector_id": "insp-1"}),
    (CaseState.INSPECTED, {"inspection_report": "report://1"}),
    (
        CaseState.SHOW_CAUSE_ISSUED,
        {"notice_document": "doc://1", "dispatch_proof": "proof://1"},
    ),
    (CaseState.RESPONSE_WINDOW, {}),
    (CaseState.HEARING_SCHEDULED, {"hearing_date": "2026-02-01"}),
    (CaseState.HEARING_HELD, {"hearing_record": "record://1"}),
    (CaseState.ORDER_ISSUED, {"reasoned_order": "order://1"}),
    (CaseState.ACTION_TAKEN, {"action_report": "action://1"}),
    (CaseState.CLOSED, {"closure_note": "closed://1"}),
]


def make_case(case_id: str = "case-1") -> Case:
    return Case(case_id=case_id, state=CaseState.NEW, events=[])


class TestHappyPath:
    def test_full_walk_new_to_closed(self):
        case = make_case()
        for state, artifacts in FORWARD_CHAIN:
            event = transition(case, state, "officer-1", T0, artifacts=artifacts)
            assert case.state == state
            assert event.to_state == state

        assert case.state == CaseState.CLOSED
        assert [e.to_state for e in case.events] == [s for s, _ in FORWARD_CHAIN]

    def test_events_recorded_in_order_with_actor_and_artifacts(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-a", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-b",
            T0,
            artifacts={"inspector_id": "insp-9"},
        )

        assert len(case.events) == 2
        assert case.events[0].from_state == CaseState.NEW
        assert case.events[0].to_state == CaseState.TRIAGED
        assert case.events[0].actor == "officer-a"
        assert case.events[0].artifacts == {"triage_note": "n://1"}

        assert case.events[1].from_state == CaseState.TRIAGED
        assert case.events[1].to_state == CaseState.INSPECTION_ASSIGNED
        assert case.events[1].actor == "officer-b"
        assert case.events[1].artifacts == {"inspector_id": "insp-9"}

    def test_transition_returns_the_event(self):
        case = make_case()
        event = transition(
            case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"}
        )
        assert isinstance(event, CaseEvent)
        assert event is case.events[-1]

    def test_note_is_recorded(self):
        case = make_case()
        event = transition(
            case,
            CaseState.TRIAGED,
            "officer-1",
            T0,
            artifacts={"triage_note": "n://1"},
            note="urgent case",
        )
        assert event.note == "urgent case"


class TestMissingArtifacts:
    @pytest.mark.parametrize(
        ("state", "required_artifacts", "prior_states"),
        [
            (CaseState.TRIAGED, ["triage_note"], []),
            (
                CaseState.INSPECTION_ASSIGNED,
                ["inspector_id"],
                [(CaseState.TRIAGED, {"triage_note": "n://1"})],
            ),
            (
                CaseState.INSPECTED,
                ["inspection_report"],
                [
                    (CaseState.TRIAGED, {"triage_note": "n://1"}),
                    (CaseState.INSPECTION_ASSIGNED, {"inspector_id": "insp-1"}),
                ],
            ),
            (
                CaseState.SHOW_CAUSE_ISSUED,
                ["notice_document", "dispatch_proof"],
                [
                    (CaseState.TRIAGED, {"triage_note": "n://1"}),
                    (CaseState.INSPECTION_ASSIGNED, {"inspector_id": "insp-1"}),
                    (CaseState.INSPECTED, {"inspection_report": "r://1"}),
                ],
            ),
            (
                CaseState.HEARING_SCHEDULED,
                ["hearing_date"],
                [
                    (CaseState.TRIAGED, {"triage_note": "n://1"}),
                    (CaseState.INSPECTION_ASSIGNED, {"inspector_id": "insp-1"}),
                    (CaseState.INSPECTED, {"inspection_report": "r://1"}),
                    (
                        CaseState.SHOW_CAUSE_ISSUED,
                        {"notice_document": "d://1", "dispatch_proof": "p://1"},
                    ),
                    (CaseState.RESPONSE_WINDOW, {}),
                ],
            ),
            (
                CaseState.HEARING_HELD,
                ["hearing_record"],
                [
                    (CaseState.TRIAGED, {"triage_note": "n://1"}),
                    (CaseState.INSPECTION_ASSIGNED, {"inspector_id": "insp-1"}),
                    (CaseState.INSPECTED, {"inspection_report": "r://1"}),
                    (
                        CaseState.SHOW_CAUSE_ISSUED,
                        {"notice_document": "d://1", "dispatch_proof": "p://1"},
                    ),
                    (CaseState.RESPONSE_WINDOW, {}),
                    (CaseState.HEARING_SCHEDULED, {"hearing_date": "2026-02-01"}),
                ],
            ),
            (
                CaseState.ORDER_ISSUED,
                ["reasoned_order"],
                [
                    (CaseState.TRIAGED, {"triage_note": "n://1"}),
                    (CaseState.INSPECTION_ASSIGNED, {"inspector_id": "insp-1"}),
                    (CaseState.INSPECTED, {"inspection_report": "r://1"}),
                    (
                        CaseState.SHOW_CAUSE_ISSUED,
                        {"notice_document": "d://1", "dispatch_proof": "p://1"},
                    ),
                    (CaseState.RESPONSE_WINDOW, {}),
                    (CaseState.HEARING_SCHEDULED, {"hearing_date": "2026-02-01"}),
                    (CaseState.HEARING_HELD, {"hearing_record": "rec://1"}),
                ],
            ),
            (
                CaseState.ACTION_TAKEN,
                ["action_report"],
                [
                    (CaseState.TRIAGED, {"triage_note": "n://1"}),
                    (CaseState.INSPECTION_ASSIGNED, {"inspector_id": "insp-1"}),
                    (CaseState.INSPECTED, {"inspection_report": "r://1"}),
                    (
                        CaseState.SHOW_CAUSE_ISSUED,
                        {"notice_document": "d://1", "dispatch_proof": "p://1"},
                    ),
                    (CaseState.RESPONSE_WINDOW, {}),
                    (CaseState.HEARING_SCHEDULED, {"hearing_date": "2026-02-01"}),
                    (CaseState.HEARING_HELD, {"hearing_record": "rec://1"}),
                    (CaseState.ORDER_ISSUED, {"reasoned_order": "order://1"}),
                ],
            ),
            (
                CaseState.CLOSED,
                ["closure_note"],
                [
                    (CaseState.TRIAGED, {"triage_note": "n://1"}),
                    (CaseState.INSPECTION_ASSIGNED, {"inspector_id": "insp-1"}),
                    (CaseState.INSPECTED, {"inspection_report": "r://1"}),
                    (
                        CaseState.SHOW_CAUSE_ISSUED,
                        {"notice_document": "d://1", "dispatch_proof": "p://1"},
                    ),
                    (CaseState.RESPONSE_WINDOW, {}),
                    (CaseState.HEARING_SCHEDULED, {"hearing_date": "2026-02-01"}),
                    (CaseState.HEARING_HELD, {"hearing_record": "rec://1"}),
                    (CaseState.ORDER_ISSUED, {"reasoned_order": "order://1"}),
                    (CaseState.ACTION_TAKEN, {"action_report": "action://1"}),
                ],
            ),
        ],
    )
    def test_missing_artifact_raises_naming_it(self, state, required_artifacts, prior_states):
        case = make_case()
        for prior_state, artifacts in prior_states:
            transition(case, prior_state, "officer-1", T0, artifacts=artifacts)

        with pytest.raises(MissingArtifact) as exc_info:
            transition(case, state, "officer-1", T0, artifacts={})

        for artifact_name in required_artifacts:
            assert artifact_name in str(exc_info.value)

    def test_missing_artifact_is_subclass_of_case_engine_error(self):
        case = make_case()
        with pytest.raises(CaseEngineError):
            transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={})

    def test_partial_artifacts_for_multi_artifact_transition_names_only_missing(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-1",
            T0,
            artifacts={"inspector_id": "insp-1"},
        )
        transition(
            case, CaseState.INSPECTED, "officer-1", T0, artifacts={"inspection_report": "r://1"}
        )

        with pytest.raises(MissingArtifact) as exc_info:
            transition(
                case,
                CaseState.SHOW_CAUSE_ISSUED,
                "officer-1",
                T0,
                artifacts={"notice_document": "d://1"},
            )
        assert "dispatch_proof" in str(exc_info.value)
        assert "notice_document" not in str(exc_info.value)

    def test_response_window_requires_no_artifacts(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-1",
            T0,
            artifacts={"inspector_id": "insp-1"},
        )
        transition(
            case, CaseState.INSPECTED, "officer-1", T0, artifacts={"inspection_report": "r://1"}
        )
        transition(
            case,
            CaseState.SHOW_CAUSE_ISSUED,
            "officer-1",
            T0,
            artifacts={"notice_document": "d://1", "dispatch_proof": "p://1"},
        )
        # Should not raise even with no artifacts.
        event = transition(case, CaseState.RESPONSE_WINDOW, "officer-1", T0)
        assert event.to_state == CaseState.RESPONSE_WINDOW


class TestSkipBackwardSelfTransitions:
    def test_skipping_forward_states_raises(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-1",
            T0,
            artifacts={"inspector_id": "insp-1"},
        )
        transition(
            case, CaseState.INSPECTED, "officer-1", T0, artifacts={"inspection_report": "r://1"}
        )
        with pytest.raises(InvalidTransition) as exc_info:
            transition(
                case, CaseState.ORDER_ISSUED, "officer-1", T0, artifacts={"reasoned_order": "o"}
            )
        msg = str(exc_info.value)
        assert "INSPECTED" in msg
        assert "ORDER_ISSUED" in msg

    def test_skip_from_new_directly_to_inspected_raises(self):
        case = make_case()
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.INSPECTED,
                "officer-1",
                T0,
                artifacts={"inspection_report": "r://1"},
            )

    def test_backward_transition_raises(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-1",
            T0,
            artifacts={"inspector_id": "insp-1"},
        )
        with pytest.raises(InvalidTransition):
            transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n"})

    def test_self_transition_raises(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        with pytest.raises(InvalidTransition):
            transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n2"})

    def test_self_transition_from_new_raises(self):
        case = make_case()
        with pytest.raises(InvalidTransition):
            transition(case, CaseState.NEW, "officer-1", T0)

    def test_invalid_transition_is_subclass_of_case_engine_error(self):
        case = make_case()
        with pytest.raises(CaseEngineError):
            transition(
                case,
                CaseState.INSPECTED,
                "officer-1",
                T0,
                artifacts={"inspection_report": "r://1"},
            )

    def test_failed_transition_does_not_append_event_or_change_state(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        events_before = list(case.events)
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.INSPECTED,
                "officer-1",
                T0,
                artifacts={"inspection_report": "r://1"},
            )
        assert case.state == CaseState.TRIAGED
        assert case.events == events_before


class TestSideExits:
    def test_dismissed_false_positive_from_new(self):
        case = make_case()
        event = transition(
            case,
            CaseState.DISMISSED_FALSE_POSITIVE,
            "officer-1",
            T0,
            artifacts={"dismissal_reason": "no encroachment visible"},
        )
        assert case.state == CaseState.DISMISSED_FALSE_POSITIVE
        assert event.to_state == CaseState.DISMISSED_FALSE_POSITIVE

    def test_dismissed_false_positive_from_mid_chain(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-1",
            T0,
            artifacts={"inspector_id": "insp-1"},
        )
        transition(
            case, CaseState.INSPECTED, "officer-1", T0, artifacts={"inspection_report": "r://1"}
        )
        transition(
            case,
            CaseState.DISMISSED_FALSE_POSITIVE,
            "officer-1",
            T0,
            artifacts={"dismissal_reason": "resolved amicably"},
        )
        assert case.state == CaseState.DISMISSED_FALSE_POSITIVE

    def test_dismissed_false_positive_missing_artifact_raises(self):
        case = make_case()
        with pytest.raises(MissingArtifact) as exc_info:
            transition(case, CaseState.DISMISSED_FALSE_POSITIVE, "officer-1", T0, artifacts={})
        assert "dismissal_reason" in str(exc_info.value)

    def test_legacy_referred_from_mid_chain(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        event = transition(
            case,
            CaseState.LEGACY_REFERRED,
            "officer-1",
            T0,
            artifacts={"legacy_rationale": "pre-2010 encroachment, refer to legacy cell"},
        )
        assert case.state == CaseState.LEGACY_REFERRED
        assert event.to_state == CaseState.LEGACY_REFERRED

    def test_legacy_referred_missing_artifact_raises(self):
        case = make_case()
        with pytest.raises(MissingArtifact) as exc_info:
            transition(case, CaseState.LEGACY_REFERRED, "officer-1", T0, artifacts={})
        assert "legacy_rationale" in str(exc_info.value)

    def test_dismissed_and_legacy_referred_are_terminal(self):
        case_a = make_case("case-a")
        transition(
            case_a,
            CaseState.DISMISSED_FALSE_POSITIVE,
            "officer-1",
            T0,
            artifacts={"dismissal_reason": "false alarm"},
        )
        assert allowed_transitions(case_a) == set()

        case_b = make_case("case-b")
        transition(
            case_b,
            CaseState.LEGACY_REFERRED,
            "officer-1",
            T0,
            artifacts={"legacy_rationale": "legacy"},
        )
        assert allowed_transitions(case_b) == set()

    def test_side_exit_not_allowed_from_closed(self):
        case = make_case()
        for state, artifacts in FORWARD_CHAIN:
            transition(case, state, "officer-1", T0, artifacts=artifacts)
        assert case.state == CaseState.CLOSED
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.DISMISSED_FALSE_POSITIVE,
                "officer-1",
                T0,
                artifacts={"dismissal_reason": "x"},
            )


class TestSurveyDetour:
    def test_survey_requested_from_triaged_returns_to_triaged(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})

        transition(
            case,
            CaseState.SURVEY_REQUESTED,
            "officer-1",
            T0,
            artifacts={"survey_request_ref": "survey://1"},
        )
        assert case.state == CaseState.SURVEY_REQUESTED
        assert case.paused_state == CaseState.TRIAGED

        event = transition(
            case,
            CaseState.TRIAGED,
            "officer-1",
            T0,
            artifacts={"survey_result": "survey-result://1"},
        )
        assert case.state == CaseState.TRIAGED
        assert event.to_state == CaseState.TRIAGED
        assert case.paused_state is None

    def test_survey_requested_from_hearing_held_returns_to_hearing_held(self):
        case = make_case()
        for state, artifacts in FORWARD_CHAIN:
            transition(case, state, "officer-1", T0, artifacts=artifacts)
            if state == CaseState.HEARING_HELD:
                break

        transition(
            case,
            CaseState.SURVEY_REQUESTED,
            "officer-1",
            T0,
            artifacts={"survey_request_ref": "survey://2"},
        )
        assert case.paused_state == CaseState.HEARING_HELD

        transition(
            case,
            CaseState.HEARING_HELD,
            "officer-1",
            T0,
            artifacts={"survey_result": "result://2"},
        )
        assert case.state == CaseState.HEARING_HELD

    def test_survey_requested_preserves_event_history(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.SURVEY_REQUESTED,
            "officer-1",
            T0,
            artifacts={"survey_request_ref": "survey://1"},
        )
        transition(
            case, CaseState.TRIAGED, "officer-1", T0, artifacts={"survey_result": "result://1"}
        )

        assert [e.to_state for e in case.events] == [
            CaseState.TRIAGED,
            CaseState.SURVEY_REQUESTED,
            CaseState.TRIAGED,
        ]

    def test_survey_requested_not_allowed_before_triaged(self):
        case = make_case()
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.SURVEY_REQUESTED,
                "officer-1",
                T0,
                artifacts={"survey_request_ref": "survey://1"},
            )

    def test_survey_requested_not_allowed_after_hearing_held(self):
        case = make_case()
        for state, artifacts in FORWARD_CHAIN:
            transition(case, state, "officer-1", T0, artifacts=artifacts)
            if state == CaseState.ORDER_ISSUED:
                break
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.SURVEY_REQUESTED,
                "officer-1",
                T0,
                artifacts={"survey_request_ref": "survey://1"},
            )

    def test_survey_requested_missing_artifact_raises(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        with pytest.raises(MissingArtifact) as exc_info:
            transition(case, CaseState.SURVEY_REQUESTED, "officer-1", T0, artifacts={})
        assert "survey_request_ref" in str(exc_info.value)

    def test_survey_result_missing_artifact_raises(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.SURVEY_REQUESTED,
            "officer-1",
            T0,
            artifacts={"survey_request_ref": "survey://1"},
        )
        with pytest.raises(MissingArtifact) as exc_info:
            transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={})
        assert "survey_result" in str(exc_info.value)

    def test_only_origin_state_is_reachable_from_survey_requested(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.SURVEY_REQUESTED,
            "officer-1",
            T0,
            artifacts={"survey_request_ref": "survey://1"},
        )
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.INSPECTION_ASSIGNED,
                "officer-1",
                T0,
                artifacts={"inspector_id": "insp-1"},
            )


class TestStayByCourt:
    def test_stay_from_normal_state_and_vacate(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-1",
            T0,
            artifacts={"inspector_id": "insp-1"},
        )

        transition(
            case,
            CaseState.STAYED_BY_COURT,
            "officer-1",
            T0,
            artifacts={"stay_order_ref": "stay://1"},
        )
        assert case.state == CaseState.STAYED_BY_COURT
        assert case.paused_state == CaseState.INSPECTION_ASSIGNED

        event = transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-1",
            T0,
            artifacts={"stay_vacation_ref": "vacate://1"},
        )
        assert case.state == CaseState.INSPECTION_ASSIGNED
        assert event.to_state == CaseState.INSPECTION_ASSIGNED
        assert case.paused_state is None

    def test_stay_from_survey_requested(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.SURVEY_REQUESTED,
            "officer-1",
            T0,
            artifacts={"survey_request_ref": "survey://1"},
        )
        transition(
            case,
            CaseState.STAYED_BY_COURT,
            "officer-1",
            T0,
            artifacts={"stay_order_ref": "stay://1"},
        )
        assert case.state == CaseState.STAYED_BY_COURT
        # paused_state still records original origin (TRIAGED), not SURVEY_REQUESTED
        assert case.paused_state == CaseState.TRIAGED

        transition(
            case,
            CaseState.TRIAGED,
            "officer-1",
            T0,
            artifacts={"stay_vacation_ref": "vacate://1"},
        )
        assert case.state == CaseState.TRIAGED

    def test_stay_missing_artifact_raises(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        with pytest.raises(MissingArtifact) as exc_info:
            transition(case, CaseState.STAYED_BY_COURT, "officer-1", T0, artifacts={})
        assert "stay_order_ref" in str(exc_info.value)

    def test_stay_vacation_missing_artifact_raises(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.STAYED_BY_COURT,
            "officer-1",
            T0,
            artifacts={"stay_order_ref": "stay://1"},
        )
        with pytest.raises(MissingArtifact) as exc_info:
            transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={})
        assert "stay_vacation_ref" in str(exc_info.value)

    def test_nothing_else_legal_while_stayed(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.STAYED_BY_COURT,
            "officer-1",
            T0,
            artifacts={"stay_order_ref": "stay://1"},
        )

        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.INSPECTION_ASSIGNED,
                "officer-1",
                T0,
                artifacts={"inspector_id": "insp-1"},
            )
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.DISMISSED_FALSE_POSITIVE,
                "officer-1",
                T0,
                artifacts={"dismissal_reason": "x"},
            )
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.LEGACY_REFERRED,
                "officer-1",
                T0,
                artifacts={"legacy_rationale": "x"},
            )
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.SURVEY_REQUESTED,
                "officer-1",
                T0,
                artifacts={"survey_request_ref": "x"},
            )
        assert case.state == CaseState.STAYED_BY_COURT

    def test_stay_allowed_from_any_nonterminal_state_including_new(self):
        case = make_case()
        transition(
            case,
            CaseState.STAYED_BY_COURT,
            "officer-1",
            T0,
            artifacts={"stay_order_ref": "stay://1"},
        )
        assert case.state == CaseState.STAYED_BY_COURT
        assert case.paused_state == CaseState.NEW

        transition(
            case,
            CaseState.NEW,
            "officer-1",
            T0,
            artifacts={"stay_vacation_ref": "vacate://1"},
        )
        assert case.state == CaseState.NEW

    def test_stay_not_allowed_from_terminal_state(self):
        case = make_case()
        transition(
            case,
            CaseState.DISMISSED_FALSE_POSITIVE,
            "officer-1",
            T0,
            artifacts={"dismissal_reason": "x"},
        )
        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.STAYED_BY_COURT,
                "officer-1",
                T0,
                artifacts={"stay_order_ref": "stay://1"},
            )


class TestTerminalStatesRejectEverything:
    @pytest.mark.parametrize(
        "terminal_state",
        [CaseState.CLOSED, CaseState.DISMISSED_FALSE_POSITIVE, CaseState.LEGACY_REFERRED],
    )
    def test_terminal_state_rejects_any_transition(self, terminal_state):
        case = make_case()
        if terminal_state == CaseState.CLOSED:
            for state, artifacts in FORWARD_CHAIN:
                transition(case, state, "officer-1", T0, artifacts=artifacts)
        elif terminal_state == CaseState.DISMISSED_FALSE_POSITIVE:
            transition(
                case,
                CaseState.DISMISSED_FALSE_POSITIVE,
                "officer-1",
                T0,
                artifacts={"dismissal_reason": "x"},
            )
        else:
            transition(
                case,
                CaseState.LEGACY_REFERRED,
                "officer-1",
                T0,
                artifacts={"legacy_rationale": "x"},
            )

        assert case.state == terminal_state
        assert allowed_transitions(case) == set()

        with pytest.raises(InvalidTransition):
            transition(
                case,
                CaseState.STAYED_BY_COURT,
                "officer-1",
                T0,
                artifacts={"stay_order_ref": "x"},
            )


class TestAllowedTransitions:
    def test_allowed_transitions_at_new(self):
        case = make_case()
        allowed = allowed_transitions(case)
        assert CaseState.TRIAGED in allowed
        assert CaseState.DISMISSED_FALSE_POSITIVE in allowed
        assert CaseState.LEGACY_REFERRED in allowed
        assert CaseState.STAYED_BY_COURT in allowed
        assert CaseState.SURVEY_REQUESTED not in allowed
        assert CaseState.INSPECTION_ASSIGNED not in allowed
        assert CaseState.NEW not in allowed

    def test_allowed_transitions_mid_chain(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.INSPECTION_ASSIGNED,
            "officer-1",
            T0,
            artifacts={"inspector_id": "insp-1"},
        )
        allowed = allowed_transitions(case)
        assert allowed == {
            CaseState.INSPECTED,
            CaseState.DISMISSED_FALSE_POSITIVE,
            CaseState.LEGACY_REFERRED,
            CaseState.SURVEY_REQUESTED,
            CaseState.STAYED_BY_COURT,
        }

    def test_allowed_transitions_at_survey_requested(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.SURVEY_REQUESTED,
            "officer-1",
            T0,
            artifacts={"survey_request_ref": "survey://1"},
        )
        allowed = allowed_transitions(case)
        assert allowed == {CaseState.TRIAGED, CaseState.STAYED_BY_COURT}

    def test_allowed_transitions_at_stayed_by_court(self):
        case = make_case()
        transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"})
        transition(
            case,
            CaseState.STAYED_BY_COURT,
            "officer-1",
            T0,
            artifacts={"stay_order_ref": "stay://1"},
        )
        allowed = allowed_transitions(case)
        assert allowed == {CaseState.TRIAGED}

    def test_allowed_transitions_at_closed(self):
        case = make_case()
        for state, artifacts in FORWARD_CHAIN:
            transition(case, state, "officer-1", T0, artifacts=artifacts)
        assert allowed_transitions(case) == set()

    def test_allowed_transitions_near_end_of_forward_chain_excludes_survey(self):
        case = make_case()
        for state, artifacts in FORWARD_CHAIN:
            transition(case, state, "officer-1", T0, artifacts=artifacts)
            if state == CaseState.ORDER_ISSUED:
                break
        allowed = allowed_transitions(case)
        assert CaseState.SURVEY_REQUESTED not in allowed
        assert CaseState.ACTION_TAKEN in allowed
        assert CaseState.STAYED_BY_COURT in allowed


class TestArtifactImmutability:
    def test_event_artifacts_cannot_be_mutated_via_original_dict(self):
        case = make_case()
        artifacts = {"triage_note": "n://1"}
        event = transition(case, CaseState.TRIAGED, "officer-1", T0, artifacts=artifacts)
        artifacts["triage_note"] = "tampered"
        assert event.artifacts["triage_note"] == "n://1"

    def test_event_artifacts_mapping_is_immutable(self):
        case = make_case()
        event = transition(
            case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"}
        )
        with pytest.raises((TypeError, AttributeError)):
            event.artifacts["triage_note"] = "hacked"

    def test_event_is_frozen(self):
        case = make_case()
        event = transition(
            case, CaseState.TRIAGED, "officer-1", T0, artifacts={"triage_note": "n://1"}
        )
        with pytest.raises(Exception):  # noqa: B017 - dataclasses.FrozenInstanceError
            event.actor = "someone-else"


class TestCaseStateOrdering:
    def test_case_state_values_match_spec_order(self):
        expected_forward = [
            "NEW",
            "TRIAGED",
            "INSPECTION_ASSIGNED",
            "INSPECTED",
            "SHOW_CAUSE_ISSUED",
            "RESPONSE_WINDOW",
            "HEARING_SCHEDULED",
            "HEARING_HELD",
            "ORDER_ISSUED",
            "ACTION_TAKEN",
            "CLOSED",
        ]
        for name in expected_forward:
            assert hasattr(CaseState, name)

        side_states = [
            "DISMISSED_FALSE_POSITIVE",
            "LEGACY_REFERRED",
            "SURVEY_REQUESTED",
            "STAYED_BY_COURT",
        ]
        for name in side_states:
            assert hasattr(CaseState, name)
