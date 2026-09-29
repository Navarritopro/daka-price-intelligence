from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from notifications import send_telegram


VENEZUELA_TZ = ZoneInfo("America/Caracas")
SOURCES = ("daka", "damasco", "multimax", "ivoo", "venelectronics")


def calculate_changes(current_rows: list[dict], previous_rows: list[dict]) -> dict:
    current = {row["product_id"]: row for row in current_rows}
    previous = {row["product_id"]: row for row in previous_rows}
    changes = []
    for product_id in current.keys() & previous.keys():
        current_price = current[product_id]["price_usd"]
        previous_price = previous[product_id]["price_usd"]
        if current_price is None or previous_price is None or previous_price == 0:
            continue
        current_price = Decimal(current_price)
        previous_price = Decimal(previous_price)
        if current_price == previous_price:
            continue
        change_pct = ((current_price - previous_price) / previous_price * Decimal("100")).quantize(
            Decimal("0.01")
        )
        product = current[product_id]
        changes.append({
            "product_id": product_id,
            "external_id": product["external_id"],
            "name": product["name"],
            "old_price": previous_price,
            "new_price": current_price,
            "change_pct": change_pct,
        })
    changes.sort(key=lambda item: abs(item["change_pct"]), reverse=True)
    return {
        "increases": sum(1 for item in changes if item["change_pct"] > 0),
        "decreases": sum(1 for item in changes if item["change_pct"] < 0),
        "unchanged": sum(
            1
            for product_id in current.keys() & previous.keys()
            if current[product_id]["price_usd"] is not None
            and current[product_id]["price_usd"] == previous[product_id]["price_usd"]
        ),
        "new_products": len(current.keys() - previous.keys()),
        "missing_products": len(previous.keys() - current.keys()),
        "changes": changes,
    }


def get_job(connection, source_slug: str, capture_date) -> dict | None:
    return connection.execute(
        """
        SELECT j.id, s.name,
               (COALESCE(j.finished_at, j.started_at)
                 AT TIME ZONE 'America/Caracas')::date AS capture_date
        FROM scraping_jobs j
        JOIN sources s ON s.id = j.source_id
        WHERE s.slug = %s
          AND j.status = 'success'
          AND (COALESCE(j.finished_at, j.started_at)
               AT TIME ZONE 'America/Caracas')::date = %s
        ORDER BY COALESCE(j.finished_at, j.started_at) DESC
        LIMIT 1
        """,
        (source_slug, capture_date),
    ).fetchone()


def get_prices(connection, job_id: str) -> list[dict]:
    return connection.execute(
        """
        SELECT ph.product_id, ph.price_usd, p.external_id, p.name
        FROM price_history ph
        JOIN products p ON p.id = ph.product_id
        WHERE ph.job_id = %s
        """,
        (job_id,),
    ).fetchall()


def build_report(connection, report_date) -> tuple[str, bool]:
    previous_date = report_date - timedelta(days=1)
    lines = [
        f"📊 DAKA Price Lab · Resumen diario {report_date:%d/%m/%Y}",
        f"Comparación contra {previous_date:%d/%m/%Y}",
        "",
    ]
    complete = True
    for slug in SOURCES:
        current_job = get_job(connection, slug, report_date)
        previous_job = get_job(connection, slug, previous_date)
        display_name = current_job["name"] if current_job else slug.capitalize()
        lines.append(f"🏪 {display_name}")
        if not current_job:
            lines.extend(["⚠️ Sin captura exitosa de hoy.", ""])
            complete = False
            continue
        if not previous_job:
            lines.extend(["ℹ️ Sin captura exitosa del día anterior para comparar.", ""])
            continue
        result = calculate_changes(
            get_prices(connection, current_job["id"]),
            get_prices(connection, previous_job["id"]),
        )
        lines.append(
            f"📈 Subieron: {result['increases']} · 📉 Bajaron: {result['decreases']} · "
            f"➖ Sin cambio: {result['unchanged']}"
        )
        lines.append(
            f"🆕 Nuevos: {result['new_products']} · 👻 No reportados hoy: {result['missing_products']}"
        )
        if result["changes"]:
            lines.append("Top 10 variaciones:")
            for item in result["changes"][:10]:
                direction = "📈" if item["change_pct"] > 0 else "📉"
                name = " ".join(item["name"].split())[:75]
                lines.append(
                    f"{direction} {item['external_id']} · {name}\n"
                    f"${item['old_price']:.2f} → ${item['new_price']:.2f} "
                    f"({item['change_pct']:+.2f}%)"
                )
        else:
            lines.append("✅ Sin variaciones de precio.")
        lines.append("")
    return "\n".join(lines).strip(), complete


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    report_date = datetime.now(VENEZUELA_TZ).date()
    try:
        with psycopg.connect(database_url, row_factory=dict_row) as connection:
            report, complete = build_report(connection, report_date)
        if not send_telegram(report):
            print("Telegram no está configurado", file=sys.stderr)
            return 2
        print(report)
        if not complete:
            print("El reporte se envió incompleto porque falta una captura de hoy", file=sys.stderr)
            return 1
        return 0
    except Exception as error:
        print(f"No se pudo generar el reporte: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
