from __future__ import annotations

import html
import os
import re
import smtplib
import sys
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

import requests


def build_messages(alerts: list[dict]) -> tuple[str, str]:
    text_lines = [f"🔔 DAKA · {len(alerts)} cambios de precio detectados", ""]
    html_rows = []
    for item in alerts:
        direction = "📉" if item["change_pct"] < 0 else "📈"
        text_lines.append(
            f"{direction} {item['external_id']} · {item['name']}\n"
            f"${item['old_price_usd']:.2f} → ${item['new_price_usd']:.2f} "
            f"({item['change_pct']:+.2f}%)\n{item['url']}"
        )
        html_rows.append(
            "<tr>"
            f"<td>{html.escape(item['external_id'])}</td>"
            f"<td><a href=\"{html.escape(item['url'])}\">{html.escape(item['name'])}</a></td>"
            f"<td>${item['old_price_usd']:.2f}</td>"
            f"<td>${item['new_price_usd']:.2f}</td>"
            f"<td>{item['change_pct']:+.2f}%</td>"
            "</tr>"
        )
    html_message = (
        "<h2>Alertas de precios Daka</h2>"
        f"<p>Se detectaron <strong>{len(alerts)}</strong> variaciones sobre el umbral configurado.</p>"
        "<table cellpadding='8' cellspacing='0' border='1' style='border-collapse:collapse'>"
        "<thead><tr><th>SAP</th><th>Producto</th><th>Anterior</th><th>Actual</th><th>Variación</th></tr></thead>"
        f"<tbody>{''.join(html_rows)}</tbody></table>"
    )
    return "\n\n".join(text_lines), html_message


def send_telegram(text: str) -> bool:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not token or not chat_id:
        return False
    chunks = [text[index:index + 3900] for index in range(0, len(text), 3900)]
    for chunk in chunks:
        response = requests.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat_id, "text": chunk, "disable_web_page_preview": True},
            timeout=20,
        )
        response.raise_for_status()
    return True


def send_email(html_message: str, alert_count: int, *, subject: str | None = None) -> bool:
    host = os.getenv("SMTP_HOST")
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("ALERT_EMAIL_FROM") or user
    recipients = [email.strip() for email in os.getenv("ALERT_EMAIL_TO", "").split(",") if email.strip()]
    if not all([host, user, password, sender]) or not recipients:
        return False
    port = int(os.getenv("SMTP_PORT", "465"))
    message = MIMEMultipart("alternative")
    message["Subject"] = subject or f"DAKA Price Lab · {alert_count} cambios de precio"
    message["From"] = sender
    message["To"] = ", ".join(recipients)
    message.attach(MIMEText(html_message, "html", "utf-8"))
    with smtplib.SMTP_SSL(host, port, timeout=25) as server:
        server.login(user, password)
        server.sendmail(sender, recipients, message.as_string())
    return True


def _safe_error(error: Exception) -> str:
    """Remove credentials from errors before they leave the runtime."""
    message = f"{type(error).__name__}: {error}"
    message = re.sub(
        r"(postgres(?:ql)?://)([^@\s]+)@",
        r"\1***@",
        message,
        flags=re.IGNORECASE,
    )
    return message[:700]


def notify_failure(source: str, error: Exception, trigger_type: str) -> dict[str, bool]:
    """Send a best-effort failure alert without masking the original failure."""
    safe_error = _safe_error(error)
    source_label = source.strip() or "Scraper"
    text_message = (
        f"🚨 DAKA Price Lab · fallo en {source_label}\n\n"
        f"Origen: {trigger_type}\n"
        f"Detalle: {safe_error}\n\n"
        "Revise el monitoreo técnico y los logs de la ejecución."
    )
    html_message = (
        f"<h2>Fallo en {html.escape(source_label)}</h2>"
        f"<p><strong>Origen:</strong> {html.escape(trigger_type)}</p>"
        f"<p><strong>Detalle:</strong> {html.escape(safe_error)}</p>"
        "<p>Revise el monitoreo técnico y los logs de la ejecución.</p>"
    )
    result = {"telegram": False, "email": False}
    try:
        result["telegram"] = send_telegram(text_message)
    except Exception as notification_error:
        print(f"No se pudo enviar la alerta por Telegram: {notification_error}", file=sys.stderr)
    try:
        result["email"] = send_email(
            html_message,
            0,
            subject=f"DAKA Price Lab · fallo en {source_label}",
        )
    except Exception as notification_error:
        print(f"No se pudo enviar la alerta por correo: {notification_error}", file=sys.stderr)
    return result
