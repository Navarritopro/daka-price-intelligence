from __future__ import annotations

import os
import sys
from datetime import datetime
from decimal import Decimal
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import psycopg
from psycopg.rows import dict_row

from notifications import send_telegram


VENEZUELA_TZ = ZoneInfo("America/Caracas")
SOURCES = ("daka", "damasco", "multimax", "ivoo", "venelectronics", "soytechno")
DEFAULT_APP_BASE_URL = "https://daka-price-intelligence.vercel.app"


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


def get_latest_jobs(connection, source_slug: str) -> list[dict]:
    return connection.execute(
        """
        SELECT j.id, s.name, COALESCE(j.finished_at, j.started_at) AS captured_at,
               (COALESCE(j.finished_at, j.started_at)
                 AT TIME ZONE 'America/Caracas')::date AS capture_date
        FROM scraping_jobs j
        JOIN sources s ON s.id = j.source_id
        WHERE s.slug = %s
          AND j.status = 'success'
        ORDER BY COALESCE(j.finished_at, j.started_at) DESC
        LIMIT 2
        """,
        (source_slug,),
    ).fetchall()


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


def build_report_url(app_base_url: str, source: str, current_job: str, previous_job: str) -> str:
    query = urlencode({
        "source": source,
        "currentJob": str(current_job),
        "previousJob": str(previous_job),
    })
    return f"{app_base_url.rstrip('/')}?{query}"


def build_source_report(display_name: str, current_job: dict, previous_job: dict, result: dict) -> str:
    current_at = current_job["captured_at"].astimezone(VENEZUELA_TZ)
    previous_at = previous_job["captured_at"].astimezone(VENEZUELA_TZ)
    lines = [
        f"🏪 {display_name} · Variaciones de precio",
        f"Capturas: {previous_at:%d/%m/%Y %H:%M} → {current_at:%d/%m/%Y %H:%M} VET",
        "",
        f"📈 Subieron: {result['increases']} · 📉 Bajaron: {result['decreases']}",
        f"➖ Sin cambio: {result['unchanged']} · Total variaciones: {len(result['changes'])}",
        f"🆕 Nuevos: {result['new_products']} · 👻 No reportados: {result['missing_products']}",
        "",
    ]
    if result["changes"]:
        lines.append("Top 5 mayores variaciones:")
        for index, item in enumerate(result["changes"][:5], start=1):
            direction = "🔺" if item["change_pct"] > 0 else "🔻"
            action = "subió" if item["change_pct"] > 0 else "bajó"
            name = " ".join(item["name"].split())[:68]
            lines.append(
                f"{index}. {direction} {item['external_id']} · {name}\n"
                f"   {action} {abs(item['change_pct']):.2f}% · "
                f"${item['old_price']:.2f} → ${item['new_price']:.2f}"
            )
    else:
        lines.append("✅ Sin variaciones de precio entre ambas capturas.")
    return "\n".join(lines)


def build_reports(connection, report_date, app_base_url: str) -> tuple[str, list[dict], bool]:
    source_reports = []
    summary_lines = [
        f"📊 DAKA Price Lab · Resumen diario {report_date:%d/%m/%Y}",
        "Última ejecución exitosa vs. ejecución exitosa anterior",
        "",
    ]
    complete = True

    for slug in SOURCES:
        jobs = get_latest_jobs(connection, slug)
        display_name = jobs[0]["name"] if jobs else slug.capitalize()
        if len(jobs) < 2:
            summary_lines.append(f"⚠️ {display_name}: no hay dos capturas exitosas para comparar")
            source_reports.append({
                "source": slug,
                "name": display_name,
                "message": f"🏪 {display_name}\n⚠️ No hay dos capturas exitosas para comparar.",
                "url": None,
            })
            complete = False
            continue

        current_job, previous_job = jobs
        if current_job["capture_date"] != report_date:
            complete = False
        result = calculate_changes(
            get_prices(connection, current_job["id"]),
            get_prices(connection, previous_job["id"]),
        )
        stale = " ⚠️ captura desactualizada" if current_job["capture_date"] != report_date else ""
        summary_lines.append(
            f"• {display_name}: 📈 {result['increases']} · 📉 {result['decreases']}"
            f" · {len(result['changes'])} variaciones{stale}"
        )
        source_reports.append({
            "source": slug,
            "name": display_name,
            "message": build_source_report(display_name, current_job, previous_job, result),
            "url": build_report_url(app_base_url, slug, current_job["id"], previous_job["id"]),
        })

    summary_lines.extend(["", "Recibirás un mensaje separado por cada fuente con su Top 5 y acceso al detalle completo."])
    return "\n".join(summary_lines), source_reports, complete


def main() -> int:
    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print("DATABASE_URL no está configurada", file=sys.stderr)
        return 2
    app_base_url = os.getenv("APP_BASE_URL", DEFAULT_APP_BASE_URL).strip() or DEFAULT_APP_BASE_URL
    report_date = datetime.now(VENEZUELA_TZ).date()
    try:
        with psycopg.connect(database_url, row_factory=dict_row) as connection:
            summary, reports, complete = build_reports(connection, report_date, app_base_url)

        if not send_telegram(summary):
            print("Telegram no está configurado", file=sys.stderr)
            return 2
        print(summary)

        for report in reports:
            buttons = None
            if report["url"]:
                buttons = [{"text": f"Ver todas las variaciones de {report['name']}", "url": report["url"]}]
            send_telegram(report["message"], buttons=buttons)
            print(f"\n{report['message']}")

        if not complete:
            print("El reporte se envió, pero una o más fuentes no tienen una captura exitosa de hoy", file=sys.stderr)
            return 1
        return 0
    except Exception as error:
        print(f"No se pudo generar el reporte: {type(error).__name__}: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
