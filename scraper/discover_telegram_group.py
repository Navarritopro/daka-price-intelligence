from __future__ import annotations

import json
import os
import sys
import urllib.request


def main() -> int:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        print("TELEGRAM_BOT_TOKEN no está configurado", file=sys.stderr)
        return 2
    with urllib.request.urlopen(f"https://api.telegram.org/bot{token}/getUpdates", timeout=20) as response:
        payload = json.load(response)
    groups: set[tuple[str, str, str]] = set()
    for update in payload.get("result", []):
        message = update.get("message") or update.get("channel_post") or {}
        chat = message.get("chat") or {}
        if chat.get("type") in {"group", "supergroup"}:
            groups.add((str(chat.get("id")), str(chat.get("title", "Sin título")), str(chat.get("type"))))
    if not groups:
        print("No se encontró ningún grupo. Envía un comando dirigido al bot dentro del grupo y vuelve a ejecutar este workflow.")
        return 1
    print("Grupos detectados (CHAT_ID | nombre | tipo):")
    for group in sorted(groups):
        print(" | ".join(group))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
