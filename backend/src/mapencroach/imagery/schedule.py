"""ISO-8601 week scheduling for the weekly-snapshot watch.

A watch is defined by a start date and "weekly" cadence, so the whole
pipeline hinges on ISO week arithmetic being exactly right: which week a
date falls in, what the calendar week boundaries are, and which weeks are
still owed a capture attempt. ISO weeks don't line up with calendar
years -- the ISO year of a date near a year boundary can differ from
`date.year` (2021-01-01 belongs to ISO week 2020-W53, and 2026-12-28
opens 2026-W53) and some years have 53 ISO weeks instead of 52. Getting this
wrong silently mislabels evidence with the wrong week, so everything here
is built on `date.isocalendar()` rather than hand-rolled week math.
"""

from collections.abc import Collection
from dataclasses import dataclass
from datetime import date, timedelta


@dataclass(frozen=True)
class WeekRef:
    """One ISO-8601 week, identified by its ISO year and week number.

    `year` is the *ISO* year, which can differ from the calendar year of
    any date inside the week near a year boundary -- that's the whole
    point of using ISO weeks for a legal evidence timeline instead of
    ambiguous calendar-month buckets.
    """

    year: int
    week: int

    def __post_init__(self) -> None:
        if self.week < 1 or self.week > 53:
            raise ValueError(f"week must be 1-53, got {self.week!r}")
        # Validate the (year, week) pair actually exists -- e.g. week 53
        # doesn't exist in every year (`date.fromisocalendar` raises for
        # those, which we re-raise with a message naming the bad pair).
        try:
            date.fromisocalendar(self.year, self.week, 1)
        except ValueError as exc:
            raise ValueError(f"no such ISO week: {self.year}-W{self.week:02d}") from exc

    @property
    def key(self) -> str:
        """Canonical zero-padded identifier, e.g. "2026-W31"."""
        return f"{self.year:04d}-W{self.week:02d}"

    @property
    def start(self) -> date:
        """The Monday that begins this ISO week."""
        return date.fromisocalendar(self.year, self.week, 1)

    @property
    def end(self) -> date:
        """The Sunday that ends this ISO week."""
        return date.fromisocalendar(self.year, self.week, 7)

    @classmethod
    def parse(cls, key: str) -> "WeekRef":
        """Parse a `key`-format string ("2026-W31") back into a WeekRef.

        Raises ValueError on malformed input or a week that doesn't exist,
        the same as constructing a WeekRef directly.
        """
        parts = key.split("-W")
        if len(parts) != 2:
            raise ValueError(f"malformed week key: {key!r}")
        year_part, week_part = parts
        if not (year_part.isdigit() and week_part.isdigit()):
            raise ValueError(f"malformed week key: {key!r}")
        return cls(year=int(year_part), week=int(week_part))


def week_of(day: date) -> WeekRef:
    """The ISO week that `day` falls in."""
    iso_year, iso_week, _iso_weekday = day.isocalendar()
    return WeekRef(year=iso_year, week=iso_week)


def weeks_from(started_on: date, today: date) -> list[WeekRef]:
    """Every ISO week from `started_on`'s week through `today`'s week, ascending.

    Inclusive of both endpoints' weeks. If `today` precedes `started_on`
    (e.g. clock skew, or a watch registered for a future start date), no
    week has begun yet and an empty list is returned rather than raising --
    there's nothing due, not an error.
    """
    if today < started_on:
        return []

    first_week = week_of(started_on)
    last_week = week_of(today)

    weeks: list[WeekRef] = []
    cursor = first_week.start
    while cursor <= last_week.start:
        weeks.append(week_of(cursor))
        cursor += timedelta(days=7)
    return weeks


def due_weeks(started_on: date, today: date, attempted: Collection[str]) -> list[WeekRef]:
    """Weeks in `weeks_from(started_on, today)` not yet in `attempted`.

    `attempted` holds `WeekRef.key` strings (typically the weeks already
    present as a CaptureAttempt). Order matches `weeks_from`: ascending.
    """
    attempted_keys = set(attempted)
    return [week for week in weeks_from(started_on, today) if week.key not in attempted_keys]
