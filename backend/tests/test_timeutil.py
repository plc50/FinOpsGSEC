"""UTC timestamp serialization required by API_CONTRACT §1."""
from datetime import datetime, timezone

from app.services import timeutil


def test_format_utc_iso_uses_z_suffix():
    dt = datetime(2026, 7, 1, 10, 0, 0, tzinfo=timezone.utc)

    assert timeutil.format_utc_iso(dt) == "2026-07-01T10:00:00Z"


def test_format_utc_iso_converts_to_utc():
    dt = datetime.fromisoformat("2026-07-01T12:00:00+02:00")

    assert timeutil.format_utc_iso(dt) == "2026-07-01T10:00:00Z"
