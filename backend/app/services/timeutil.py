"""Time helpers for budget periods, forecast windows and time_range parsing."""
from __future__ import annotations

import calendar
from datetime import datetime, timedelta, timezone


def now_utc() -> datetime:
    return datetime.now(tz=timezone.utc)


def format_utc_iso(dt: datetime) -> str:
    """Serialize public API timestamps as ISO-8601 UTC with a Z suffix."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def month_start(dt: datetime | None = None) -> datetime:
    dt = dt or now_utc()
    return dt.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def month_end(dt: datetime | None = None) -> datetime:
    dt = dt or now_utc()
    last_day = calendar.monthrange(dt.year, dt.month)[1]
    return dt.replace(
        day=last_day, hour=23, minute=59, second=59, microsecond=0
    )


def remaining_hours_in_month(dt: datetime | None = None) -> float:
    dt = dt or now_utc()
    end = month_end(dt) + timedelta(seconds=1)
    delta = end - dt
    return max(delta.total_seconds() / 3600.0, 0.0)


def parse_time_range(time_range: str | None, default_hours: int = 24) -> timedelta:
    """Parse '24h', '7d', '60m' into a timedelta."""
    if not time_range:
        return timedelta(hours=default_hours)
    tr = time_range.strip().lower()
    try:
        if tr.endswith("h"):
            return timedelta(hours=float(tr[:-1]))
        if tr.endswith("d"):
            return timedelta(days=float(tr[:-1]))
        if tr.endswith("m"):
            return timedelta(minutes=float(tr[:-1]))
        return timedelta(hours=float(tr))
    except ValueError:
        return timedelta(hours=default_hours)
