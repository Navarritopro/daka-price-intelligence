from __future__ import annotations

import os
import sys
from datetime import datetime, timezone

import psycopg
from psycopg.rows import dict_row

from notifications import notify_failure


DEFAULT_SOURCES = "daka,damasco,multimax,ivoo,venelectronics"


def evaluate_sources(rows: list[dict], expected: list[str], max_age_hours: float) -> list[dict]:
    by_slug = {row["slug"]: row for row in rows}
    now = datetime.now(timezone.utc)
    results = []
    for slug in expected:
        row = by_slug.get(slug)
        last_success = row.get("last_success") if row else None
        age_hours = None
        status = "SIN ÉXITO"
        if last_success:
            if last_success.tzinfo is None:
                last_success = last_success.replace(tzinfo=timezone.utc)
            age_hours = (now - last_success.astimezone(timezone.utc)).total_seconds() / 3600
            status = "OK" if age_hours <= max_age_hours else "ATRASADO"
        results.append({
            "slug": slug,
            "name": row.get("name", slug) if row else slug,
            "last_success": last_success,
            "age_hours": age_hours,
            "status": status,
        })
    return results


def write_summary(results: list[dict]) -> None:
    lines = [
        "## Control operativo diario",
        "| Fuente | Último éxito (UTC) | Antigüedad | Estado |",
        "|---|---|---:|---|",
    ]
    for item in results:
        last_success = item["last_success"].isoformat() if item["last_success"] else "—"
        age = f"{item['age_hours']:.1f} h" if item["age_hours"] is not None else "—"
        lines.append(f"| {item['name']} | {last_success} | {age} | {item['status']} |")
    summary = "\n".join(lines) + "\n"
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if summary_path:
        with open(summary_path, "a", encoding="utf-8") as stream:
            stream.write(summary)
    else:
        print(summary)


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    expected = [
        item.strip().lower()
        for item in os.getenv("MONITORED_SOURCES", DEFAULT_SOURCES).split(",")
        if item.strip()
    ]
    max_age_hours = float(os.getenv("MAX_SUCCESS_AGE_HOURS", "36"))
    try:
        with psycopg.connect(database_url, row_factory=dict_row) as connection:
            rows = connection.execute(
                """
                SELECT s.slug, s.name,
                       MAX(COALESCE(j.finished_at, j.started_at))
                         FILTER (WHERE j.status = 'success') AS last_success
                FROM sources s
                LEFT JOIN scraping_jobs j ON j.source_id = s.id
                GROUP BY s.slug, s.name
                ORDER BY s.slug
                """
            ).fetchall()
        results = evaluate_sources(rows, expected, max_age_hours)
        write_summary(results)
        unhealthy = [item for item in results if item["status"] != "OK"]
        if unhealthy:
            details = ", ".join(f"{item['name']}: {item['status']}" for item in unhealthy)
            error = RuntimeError(f"Fuentes sin captura reciente: {details}")
            notify_failure("control operativo", error, "scheduled")
            print(error, file=sys.stderr)
            return 1
        return 0
    except Exception as error:
        notify_failure("control operativo", error, "scheduled")
        print(f"Control operativo fallido: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
