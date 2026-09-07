from __future__ import annotations

import json
import os
import platform
import socket
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


BASE_URL = "https://tiendasdaka.com/ve/store"
REPORT_PATH = Path("daka-connectivity-report.json")
SCREENSHOT_PATH = Path("daka-connectivity-failure.png")


def resolve_host(hostname: str) -> list[str]:
    return sorted({item[4][0] for item in socket.getaddrinfo(hostname, 443)})


def append_summary(report: dict) -> None:
    summary_path = os.getenv("GITHUB_STEP_SUMMARY")
    if not summary_path:
        return
    lines = [
        "# Diagnóstico de conectividad DAKA",
        "",
        f"- Resultado: **{'EXITOSO' if report['success'] else 'FALLIDO'}**",
        f"- Páginas solicitadas: **{report['requested_pages']}**",
        f"- Páginas con productos: **{report['successful_pages']}**",
        f"- Productos visibles acumulados: **{report['visible_products']}**",
        f"- Duración: **{report['elapsed_seconds']} s**",
        "",
        "| Página | HTTP | Productos | Resultado | URL final |",
        "|---:|---:|---:|---|---|",
    ]
    for page in report["pages"]:
        lines.append(
            f"| {page['page']} | {page.get('http_status') or '-'} | "
            f"{page.get('product_count', 0)} | {page['status']} | "
            f"{page.get('final_url') or '-'} |"
        )
    if report.get("error"):
        lines.extend(["", f"**Error:** `{report['error']}`"])
    with open(summary_path, "a", encoding="utf-8") as summary:
        summary.write("\n".join(lines) + "\n")


def main() -> int:
    requested_pages = max(1, min(int(os.getenv("DAKA_TEST_PAGES", "3")), 5))
    timeout_ms = int(os.getenv("DAKA_TEST_TIMEOUT_MS", "60000"))
    hostname = urlparse(BASE_URL).hostname or "tiendasdaka.com"
    started = time.monotonic()
    report: dict = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "runner": {
            "python": sys.version.split()[0],
            "platform": platform.platform(),
        },
        "target": BASE_URL,
        "requested_pages": requested_pages,
        "dns_addresses": [],
        "pages": [],
        "successful_pages": 0,
        "visible_products": 0,
        "success": False,
        "error": None,
    }

    try:
        report["dns_addresses"] = resolve_host(hostname)
        print(f"DNS {hostname}: {', '.join(report['dns_addresses'])}", flush=True)

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                args=["--disable-dev-shm-usage"],
            )
            context = browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
                ),
                locale="es-VE",
                timezone_id="America/Caracas",
            )

            def block_heavy_resources(route) -> None:
                if route.request.resource_type in {"image", "media", "font"}:
                    route.abort()
                else:
                    route.continue_()

            context.route("**/*", block_heavy_resources)
            page = context.new_page()

            for page_number in range(1, requested_pages + 1):
                target_url = BASE_URL if page_number == 1 else f"{BASE_URL}?page={page_number}"
                page_result = {
                    "page": page_number,
                    "requested_url": target_url,
                    "final_url": None,
                    "http_status": None,
                    "title": None,
                    "product_count": 0,
                    "status": "failed",
                    "body_excerpt": None,
                    "error": None,
                }
                page_started = time.monotonic()
                try:
                    response = page.goto(target_url, wait_until="commit", timeout=timeout_ms)
                    page_result["http_status"] = response.status if response else None
                    page.wait_for_selector(
                        '[data-testid="products-list"] [data-testid="product-wrapper"]',
                        state="attached",
                        timeout=timeout_ms,
                    )
                    page.wait_for_timeout(1_500)
                    diagnostic = page.evaluate(
                        """() => ({
                          title: document.title,
                          productCount: document.querySelectorAll('[data-testid="product-wrapper"]').length,
                          bodyExcerpt: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 240)
                        })"""
                    )
                    page_result.update(
                        {
                            "final_url": page.url,
                            "title": diagnostic["title"],
                            "product_count": diagnostic["productCount"],
                            "body_excerpt": diagnostic["bodyExcerpt"],
                            "status": "success" if diagnostic["productCount"] > 0 else "no_products",
                        }
                    )
                except PlaywrightTimeoutError as exc:
                    page_result["final_url"] = page.url
                    page_result["error"] = f"{type(exc).__name__}: {exc}"[:1000]
                    try:
                        page.screenshot(path=str(SCREENSHOT_PATH), full_page=False)
                    except Exception:
                        pass
                except Exception as exc:
                    page_result["final_url"] = page.url
                    page_result["error"] = f"{type(exc).__name__}: {exc}"[:1000]
                finally:
                    page_result["elapsed_seconds"] = round(time.monotonic() - page_started, 2)
                    report["pages"].append(page_result)
                    print(
                        f"Página {page_number}: {page_result['status']} · "
                        f"HTTP {page_result['http_status']} · "
                        f"{page_result['product_count']} productos · "
                        f"{page_result['elapsed_seconds']} s",
                        flush=True,
                    )

            context.close()
            browser.close()

        report["successful_pages"] = sum(
            1 for item in report["pages"] if item["status"] == "success"
        )
        report["visible_products"] = sum(item["product_count"] for item in report["pages"])
        report["success"] = report["successful_pages"] == requested_pages
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"[:2000]
        print(f"Diagnóstico fallido: {report['error']}", file=sys.stderr, flush=True)
    finally:
        report["finished_at"] = datetime.now(timezone.utc).isoformat()
        report["elapsed_seconds"] = round(time.monotonic() - started, 2)
        REPORT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        append_summary(report)

    if report["success"]:
        print("Conectividad validada: GitHub Actions puede leer el catálogo de DAKA.", flush=True)
        return 0
    print(
        "Conectividad no validada. Revise el resumen y descargue el artefacto de diagnóstico.",
        file=sys.stderr,
        flush=True,
    )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
