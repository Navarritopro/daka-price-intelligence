from __future__ import annotations

import os
import sys

import psycopg
from psycopg.rows import dict_row

import scrape


def claim_request(database_url: str) -> int | None:
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        row = conn.execute(
            """
            UPDATE scrape_requests
            SET status = 'running', claimed_at = NOW(), error_message = NULL
            WHERE id = (
              SELECT id
              FROM scrape_requests
              WHERE status = 'queued'
              ORDER BY requested_at
              FOR UPDATE SKIP LOCKED
              LIMIT 1
            )
            RETURNING id
            """
        ).fetchone()
        return int(row["id"]) if row else None


def finish_request(database_url: str, request_id: int, exit_code: int) -> None:
    status = "success" if exit_code == 0 else "failed"
    message = None if exit_code == 0 else f"El scraper finalizó con código {exit_code}"
    with psycopg.connect(database_url) as conn:
        conn.execute(
            """
            UPDATE scrape_requests
            SET status = %s, finished_at = NOW(), error_message = %s
            WHERE id = %s
            """,
            (status, message, request_id),
        )


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    request_id = claim_request(database_url)
    if request_id is None:
        return 0
    print(f"Solicitud manual {request_id} recibida", flush=True)
    os.environ["TRIGGER_TYPE"] = "manual"
    exit_code = scrape.main()
    finish_request(database_url, request_id, exit_code)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
