"""Cost report exports (CSV + executive PDF).

Builds per-consumer consumption reports from `audit_records` with optional
consumer and date-range filters. CSV is the raw detail; PDF is a small
executive summary (title, date range, per-consumer totals and a detail table).
"""

from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone

from fpdf import FPDF
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import errors
from ..models import AuditRecord
from . import timeutil

CSV_COLUMNS = [
    "date",
    "consumer",
    "provider",
    "model",
    "category",
    "original_category",
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cost_usd",
    "action",
    "status",
]

PDF_DETAIL_MAX_ROWS = 45


def parse_date_range(
    start_date: str | None, end_date: str | None, *, default_days: int = 30
) -> tuple[datetime, datetime]:
    """Parse optional ISO dates (YYYY-MM-DD or full ISO-8601) into UTC bounds."""

    def _parse(raw: str, param: str, *, end_of_day: bool) -> datetime:
        try:
            value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            raise errors.validation_error(
                f"Invalid {param}; use YYYY-MM-DD or ISO-8601.", param
            ) from None
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        # A bare date for the end bound should include the whole day.
        if end_of_day and len(raw) == 10:
            value = value + timedelta(days=1) - timedelta(microseconds=1)
        return value

    end = _parse(end_date, "end_date", end_of_day=True) if end_date else timeutil.now_utc()
    start = (
        _parse(start_date, "start_date", end_of_day=False)
        if start_date
        else end - timedelta(days=default_days)
    )
    if start > end:
        raise errors.validation_error("start_date must be before end_date.", "start_date")
    return start, end


def action_for(record: AuditRecord) -> str:
    """Applied action for reporting: allow/degraded/blocked/warn_only/cached..."""
    if record.status == "semantic_cache_hit":
        return "cached"
    if record.error_code in ("blocked_category", "rate_limited"):
        return record.error_code
    return record.budget_action or record.status or "unknown"


async def fetch_rows(
    session: AsyncSession,
    consumers: list[str],
    start: datetime,
    end: datetime,
) -> list[AuditRecord]:
    stmt = (
        select(AuditRecord)
        .where(
            AuditRecord.consumer.in_(consumers),
            AuditRecord.timestamp_started >= start,
            AuditRecord.timestamp_started <= end,
        )
        .order_by(AuditRecord.timestamp_started.asc())
    )
    return list((await session.execute(stmt)).scalars().all())


def _tokens(record: AuditRecord) -> tuple[int, int, int]:
    prompt = record.actual_prompt_tokens or record.estimated_prompt_tokens or 0
    output = record.actual_output_tokens or 0
    return prompt, output, prompt + output


def _cost(record: AuditRecord) -> float:
    return float(record.budget_charge or 0)


def build_csv(rows: list[AuditRecord]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for record in rows:
        prompt, output, total = _tokens(record)
        writer.writerow(
            [
                timeutil.format_utc_iso(record.timestamp_started),
                record.consumer,
                record.selected_provider or "",
                record.selected_model or "",
                record.category or "",
                record.original_category or "",
                prompt,
                output,
                total,
                f"{_cost(record):.6f}",
                action_for(record),
                record.status or "",
            ]
        )
    return buffer.getvalue()


def _consumer_totals(rows: list[AuditRecord]) -> list[dict]:
    totals: dict[str, dict] = {}
    for record in rows:
        entry = totals.setdefault(
            record.consumer,
            {"consumer": record.consumer, "requests": 0, "tokens": 0, "cost": 0.0},
        )
        entry["requests"] += 1
        entry["tokens"] += _tokens(record)[2]
        entry["cost"] += _cost(record)
    return sorted(totals.values(), key=lambda item: -item["cost"])


def _latin1(text: str) -> str:
    """FPDF core fonts are latin-1 only; degrade anything else gracefully."""
    return text.encode("latin-1", errors="replace").decode("latin-1")


def build_pdf(rows: list[AuditRecord], *, start: datetime, end: datetime) -> bytes:
    pdf = FPDF(orientation="L", unit="mm", format="A4")
    pdf.set_auto_page_break(auto=True, margin=12)
    pdf.add_page()

    pdf.set_font("Helvetica", "B", 16)
    pdf.cell(0, 10, "AI FinOps Proxy - Informe de costes", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "", 10)
    pdf.cell(
        0,
        6,
        _latin1(f"Periodo: {timeutil.format_utc_iso(start)} - {timeutil.format_utc_iso(end)}"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.cell(
        0,
        6,
        _latin1(f"Generado: {timeutil.format_utc_iso(timeutil.now_utc())} | Moneda: USD"),
        new_x="LMARGIN",
        new_y="NEXT",
    )
    pdf.ln(4)

    # --- Totals per consumer ---
    totals = _consumer_totals(rows)
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Totales por consumidor", new_x="LMARGIN", new_y="NEXT")
    pdf.set_font("Helvetica", "B", 9)
    widths = [70, 30, 40, 40]
    for width, header in zip(widths, ["Consumidor", "Requests", "Tokens", "Coste (USD)"]):
        pdf.cell(width, 7, header, border=1)
    pdf.ln()
    pdf.set_font("Helvetica", "", 9)
    grand_cost = 0.0
    grand_tokens = 0
    for entry in totals:
        grand_cost += entry["cost"]
        grand_tokens += entry["tokens"]
        pdf.cell(widths[0], 6, _latin1(entry["consumer"]), border=1)
        pdf.cell(widths[1], 6, str(entry["requests"]), border=1)
        pdf.cell(widths[2], 6, f"{entry['tokens']:,}", border=1)
        pdf.cell(widths[3], 6, f"{entry['cost']:.4f}", border=1)
        pdf.ln()
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(widths[0], 6, "TOTAL", border=1)
    pdf.cell(widths[1], 6, str(len(rows)), border=1)
    pdf.cell(widths[2], 6, f"{grand_tokens:,}", border=1)
    pdf.cell(widths[3], 6, f"{grand_cost:.4f}", border=1)
    pdf.ln(10)

    # --- Detail table (most recent first, capped) ---
    pdf.set_font("Helvetica", "B", 12)
    pdf.cell(0, 8, "Detalle de peticiones", new_x="LMARGIN", new_y="NEXT")
    detail = list(reversed(rows))[:PDF_DETAIL_MAX_ROWS]
    headers = [
        "Fecha",
        "Consumidor",
        "Proveedor",
        "Modelo",
        "Categoria",
        "Tokens",
        "Coste",
        "Accion",
    ]
    detail_widths = [36, 40, 24, 62, 30, 20, 24, 30]
    pdf.set_font("Helvetica", "B", 8)
    for width, header in zip(detail_widths, headers):
        pdf.cell(width, 6, header, border=1)
    pdf.ln()
    pdf.set_font("Helvetica", "", 7)
    for record in detail:
        _prompt, _output, total = _tokens(record)
        cells = [
            timeutil.format_utc_iso(record.timestamp_started)[:16].replace("T", " "),
            record.consumer,
            record.selected_provider or "",
            (record.selected_model or "")[:44],
            record.category or "",
            str(total),
            f"{_cost(record):.5f}",
            action_for(record),
        ]
        for width, value in zip(detail_widths, cells):
            pdf.cell(width, 5, _latin1(value), border=1)
        pdf.ln()
    if len(rows) > PDF_DETAIL_MAX_ROWS:
        pdf.set_font("Helvetica", "I", 8)
        pdf.cell(
            0,
            6,
            _latin1(f"... {len(rows) - PDF_DETAIL_MAX_ROWS} filas mas en el CSV completo."),
            new_x="LMARGIN",
            new_y="NEXT",
        )

    return bytes(pdf.output())
