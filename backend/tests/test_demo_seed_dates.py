"""Regression tests pinning demo-seed timestamps to "now".

The MAPENCROACH_DEMO=1 seed used to carry fixed absolute dates (mid-January
2026 for every alert, case-1, etc). As soon as the calendar moved past that
window the demo read as stale/abandoned -- every alert showed "185d ago",
every case showed "184 days in stage". These tests pin the seed so it
always looks freshly generated relative to whenever the process boots,
regardless of what today's date happens to be.
"""

from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient

from mapencroach.api.app import create_app
from mapencroach.api.auth import Role, create_token
from mapencroach.api.store import Store

SECRET = "dev-secret-do-not-deploy"  # noqa: S105 - test fixture default, matches auth.py default


def _auth_headers(store: Store) -> dict[str, str]:
    token = create_token(
        sub="state-user",
        role=Role.DATA_ADMIN,
        jurisdiction_id=store.root_jurisdiction_id,
        secret=SECRET,
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    return {"Authorization": f"Bearer {token}"}


def test_alert_detected_at_within_last_30_days_and_not_future():
    store = Store.seed_demo()
    now = datetime.now(UTC)
    for alert_id, alert in store.alerts.items():
        detected_at = datetime.fromisoformat(alert["detected_at"])
        assert detected_at <= now, f"{alert_id} detected_at is in the future: {detected_at}"
        assert detected_at >= now - timedelta(days=30), (
            f"{alert_id} detected_at is older than 30 days: {detected_at}"
        )


def test_alerts_have_varied_ages_with_red_tier_freshest():
    store = Store.seed_demo()
    now = datetime.now(UTC)
    ages_by_tier: dict[str, list[float]] = {}
    for alert in store.alerts.values():
        detected_at = datetime.fromisoformat(alert["detected_at"])
        age_days = (now - detected_at).total_seconds() / 86400
        ages_by_tier.setdefault(alert["tier"], []).append(age_days)

    all_ages = [age for ages in ages_by_tier.values() for age in ages]
    # Variety: not every alert stamped at the same moment.
    assert max(all_ages) - min(all_ages) > 5

    # The urgent RED alert (alert-1 / parcel-1) should be among the freshest.
    assert min(ages_by_tier["RED"]) <= 5


def test_case_event_timestamps_strictly_increase():
    store = Store.seed_demo()
    for case_id, record in store.cases.items():
        events = record.case.events
        assert events, f"{case_id} has no events"
        for prev, nxt in zip(events, events[1:], strict=False):
            assert prev.occurred_at < nxt.occurred_at, (
                f"{case_id} events did not strictly increase: "
                f"{prev.to_state} @ {prev.occurred_at.isoformat()} -> "
                f"{nxt.to_state} @ {nxt.occurred_at.isoformat()}"
            )


def test_state_since_matches_last_event_via_api():
    store = Store.seed_demo()
    app = create_app(store)
    client = TestClient(app)
    headers = _auth_headers(store)

    cases = client.get("/cases", headers=headers).json()
    assert len(cases) == 5
    for summary in cases:
        detail = client.get(f"/cases/{summary['id']}", headers=headers).json()
        last_event = record_last_event(store, summary["id"])
        assert summary["state_since"] == last_event.occurred_at.isoformat()
        assert summary["state_since"] == detail["events"][-1]["occurred_at"]


def record_last_event(store: Store, case_id: str):
    return store.cases[case_id].case.events[-1]


def test_closed_case_concluded_one_to_two_months_ago():
    store = Store.seed_demo()
    now = datetime.now(UTC)
    closed = [r for r in store.cases.values() if r.case.state.value == "CLOSED"]
    assert len(closed) == 1
    final_event = closed[0].case.events[-1]
    age_days = (now - final_event.occurred_at).total_seconds() / 86400
    assert 20 <= age_days <= 70, f"closed case final event age out of range: {age_days} days"


def test_open_cases_last_transition_feels_recent():
    store = Store.seed_demo()
    now = datetime.now(UTC)
    for case_id, record in store.cases.items():
        if record.case.state.value == "CLOSED":
            continue
        last_event = record.case.events[-1]
        age_days = (now - last_event.occurred_at).total_seconds() / 86400
        assert 0 <= age_days <= 21, (
            f"{case_id} most recent transition should feel current, got {age_days:.1f} days ago"
        )
