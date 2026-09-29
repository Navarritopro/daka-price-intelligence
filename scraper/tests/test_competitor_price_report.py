import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from competitor_price_report import calculate_changes


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


if __name__ == "__main__":
    unittest.main()
