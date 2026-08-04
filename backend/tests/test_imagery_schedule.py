from datetime import date

import pytest

from mapencroach.imagery.schedule import WeekRef, due_weeks, week_of, weeks_from


class TestWeekRefConstruction:
    def test_key_is_zero_padded(self):
        assert WeekRef(2026, 5).key == "2026-W05"
        assert WeekRef(2026, 31).key == "2026-W31"

    def test_rejects_week_zero(self):
        with pytest.raises(ValueError, match="1-53"):
            WeekRef(2026, 0)

    def test_rejects_week_above_53(self):
        with pytest.raises(ValueError, match="1-53"):
            WeekRef(2026, 54)

    def test_rejects_week_53_in_a_52_week_year(self):
        # 2027 has only 52 ISO weeks.
        with pytest.raises(ValueError, match="no such ISO week"):
            WeekRef(2027, 53)

    def test_accepts_week_53_in_a_53_week_year(self):
        # 2026 genuinely has 53 ISO weeks.
        week = WeekRef(2026, 53)
        assert week.key == "2026-W53"

    def test_is_frozen(self):
        week = WeekRef(2026, 31)
        with pytest.raises(Exception):  # noqa: B017 - dataclass frozen error type
            week.week = 32


class TestWeekRefStartEnd:
    def test_start_is_monday(self):
        week = WeekRef(2026, 31)
        assert week.start.isoweekday() == 1

    def test_end_is_sunday(self):
        week = WeekRef(2026, 31)
        assert week.end.isoweekday() == 7

    def test_start_and_end_span_seven_days(self):
        week = WeekRef(2026, 31)
        assert (week.end - week.start).days == 6

    def test_known_week_dates(self):
        # 2026-08-03 is a Monday; verified via date.isocalendar().
        week = WeekRef(2026, 32)
        assert week.start == date(2026, 8, 3)
        assert week.end == date(2026, 8, 9)


class TestWeekRefParse:
    def test_round_trips_key(self):
        week = WeekRef(2026, 7)
        assert WeekRef.parse(week.key) == week

    def test_parse_rejects_malformed_key(self):
        with pytest.raises(ValueError, match="malformed"):
            WeekRef.parse("not-a-week")

    def test_parse_rejects_missing_week_marker(self):
        with pytest.raises(ValueError, match="malformed"):
            WeekRef.parse("2026-31")

    def test_parse_rejects_non_numeric_parts(self):
        with pytest.raises(ValueError, match="malformed"):
            WeekRef.parse("20XX-W31")

    def test_parse_rejects_nonexistent_week(self):
        with pytest.raises(ValueError, match="no such ISO week"):
            WeekRef.parse("2027-W53")


class TestWeekOf:
    def test_matches_isocalendar(self):
        day = date(2026, 8, 5)
        week = week_of(day)
        iso_year, iso_week, _ = day.isocalendar()
        assert (week.year, week.week) == (iso_year, iso_week)

    def test_iso_year_can_differ_from_calendar_year_at_boundary(self):
        # 2021-01-01 is a Friday that belongs to ISO week 2020-W53, not
        # "2021-W01" -- this is exactly the kind of mislabeling that
        # naive year-based bucketing would get wrong.
        week = week_of(date(2021, 1, 1))
        assert week.year == 2020
        assert week.week == 53

    def test_end_of_53_week_year_stays_in_that_iso_year(self):
        week = week_of(date(2026, 12, 28))
        assert week.year == 2026
        assert week.week == 53

    def test_first_iso_week_of_following_year(self):
        # The first Monday that actually starts ISO week 1 of 2027.
        week = week_of(date(2027, 1, 4))
        assert week.year == 2027
        assert week.week == 1


class TestWeeksFrom:
    def test_same_week_start_and_today_returns_single_week(self):
        day = date(2026, 8, 5)
        weeks = weeks_from(day, day)
        assert weeks == [week_of(day)]

    def test_today_before_started_on_returns_empty(self):
        assert weeks_from(date(2026, 8, 10), date(2026, 8, 1)) == []

    def test_ascending_order_across_several_weeks(self):
        weeks = weeks_from(date(2026, 7, 1), date(2026, 7, 22))
        keys = [w.key for w in weeks]
        assert keys == sorted(keys)
        assert len(weeks) == 4  # W27, W28, W29, W30

    def test_inclusive_of_both_endpoints(self):
        started_on = date(2026, 8, 3)  # Monday of 2026-W32
        today = date(2026, 8, 9)  # Sunday of the same week
        weeks = weeks_from(started_on, today)
        assert weeks == [WeekRef(2026, 32)]

    def test_spans_53_week_year_boundary_correctly(self):
        # started_on in 2026-W52, today in 2027-W02: must pass through
        # the 53rd week and land on the correct following-year week
        # without skipping or double counting.
        started_on = date(2026, 12, 21)  # 2026-W52
        today = date(2027, 1, 11)  # 2027-W02
        weeks = weeks_from(started_on, today)
        assert [w.key for w in weeks] == [
            "2026-W52",
            "2026-W53",
            "2027-W01",
            "2027-W02",
        ]

    def test_no_duplicate_or_skipped_weeks_over_a_long_range(self):
        weeks = weeks_from(date(2025, 1, 1), date(2026, 12, 31))
        keys = [w.key for w in weeks]
        assert len(keys) == len(set(keys))  # no duplicates
        # consecutive weeks must be exactly one week apart
        for prev, nxt in zip(weeks, weeks[1:], strict=False):
            assert (nxt.start - prev.start).days == 7


class TestDueWeeks:
    def test_empty_attempted_matches_weeks_from(self):
        started_on, today = date(2026, 7, 1), date(2026, 7, 22)
        assert due_weeks(started_on, today, []) == weeks_from(started_on, today)

    def test_fully_attempted_returns_empty(self):
        started_on, today = date(2026, 7, 1), date(2026, 7, 22)
        all_keys = [w.key for w in weeks_from(started_on, today)]
        assert due_weeks(started_on, today, all_keys) == []

    def test_partial_attempted_returns_only_remaining(self):
        started_on, today = date(2026, 7, 1), date(2026, 7, 22)
        weeks = weeks_from(started_on, today)
        attempted = [weeks[0].key, weeks[2].key]
        remaining = due_weeks(started_on, today, attempted)
        assert [w.key for w in remaining] == [weeks[1].key, weeks[3].key]

    def test_unrelated_attempted_keys_are_ignored(self):
        started_on = today = date(2026, 8, 5)
        remaining = due_weeks(started_on, today, ["1999-W01", "2050-W20"])
        assert remaining == [week_of(today)]

    def test_preserves_ascending_order(self):
        started_on, today = date(2026, 12, 1), date(2027, 1, 15)
        weeks = weeks_from(started_on, today)
        attempted = {weeks[1].key, weeks[3].key}
        remaining = due_weeks(started_on, today, attempted)
        keys = [w.key for w in remaining]
        assert keys == sorted(keys)
        assert weeks[1].key not in keys
        assert weeks[3].key not in keys
