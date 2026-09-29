import sys
import unittest
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from competitor_price_report import build_report_url, build_source_report, calculate_changes


class CompetitorPriceReportTests(unittest.TestCase):
    def test_calculates_summary_and_orders_largest_changes(self):
        previous = [
            {"product_id": 1, "external_id": "A", "name": "Producto A", "price_usd": Decimal("100")},
            {"product_id": 2, "external_id": "B", "name": "Producto B", "price_usd": Decimal("200")},
            {"product_id": 3, "external_id": "C", "name": "Producto C", "price_usd": Decimal("50")},
            {"product_id": 5, "external_id": "E", "name": "Producto E", "price_usd": Decimal("10")},
        ]
        current = [
            {"product_id": 1, "external_id": "A", "name": "Producto A", "price_usd": Decimal("110")},
            {"product_id": 2, "external_id": "B", "name": "Producto B", "price_usd": Decimal("150")},
            {"product_id": 3, "external_id": "C", "name": "Producto C", "price_usd": Decimal("50")},
            {"product_id": 4, "external_id": "D", "name": "Producto D", "price_usd": Decimal("75")},
        ]
        result = calculate_changes(current, previous)
        self.assertEqual(result["increases"], 1)
        self.assertEqual(result["decreases"], 1)
        self.assertEqual(result["unchanged"], 1)
        self.assertEqual(result["new_products"], 1)
        self.assertEqual(result["missing_products"], 1)
        self.assertEqual(result["changes"][0]["external_id"], "B")
        self.assertEqual(result["changes"][0]["change_pct"], Decimal("-25.00"))

    def test_builds_deep_link_for_exact_jobs(self):
        url = build_report_url("https://example.com/", "multimax", "current-id", "previous-id")
        self.assertEqual(
            url,
            "https://example.com?source=multimax&currentJob=current-id&previousJob=previous-id",
        )

    def test_source_report_limits_ranking_to_top_five(self):
        timezone = ZoneInfo("America/Caracas")
        current_job = {"captured_at": datetime(2026, 9, 29, 9, 0, tzinfo=timezone)}
        previous_job = {"captured_at": datetime(2026, 9, 28, 9, 0, tzinfo=timezone)}
        changes = [
            {
                "external_id": f"P{index}", "name": f"Producto {index}",
                "old_price": Decimal("100"), "new_price": Decimal(str(100 + index)),
                "change_pct": Decimal(str(index)),
            }
            for index in range(1, 7)
        ]
        changes.sort(key=lambda item: abs(item["change_pct"]), reverse=True)
        result = {
            "increases": 6, "decreases": 0, "unchanged": 10,
            "new_products": 0, "missing_products": 0, "changes": changes,
        }
        message = build_source_report("Damasco", current_job, previous_job, result)
        self.assertIn("P6", message)
        self.assertIn("P2", message)
        self.assertNotIn("P1 ·", message)
        self.assertIn("Top 5 mayores variaciones", message)


if __name__ == "__main__":
    unittest.main()
