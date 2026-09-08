from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from multimax import MultimaxScraper, decode_devalue


class MultimaxTests(unittest.TestCase):
    def test_decodes_astro_devalue_response(self):
        payload = [{"products": 1, "meta": 2}, [3], {"total": 4, "totalPages": 5}, {"sku": 6, "name": 7}, 2963, 60, "Q50S939GUS2", "Televisor TCL 50 pulgadas"]
        decoded = decode_devalue(payload)
        self.assertEqual(decoded["meta"]["total"], 2963)
        self.assertEqual(decoded["products"][0]["sku"], "Q50S939GUS2")

    def test_parses_sale_brand_category_and_model(self):
        raw = {
            "id": "remote-1", "sku": "Q50S939GUS2", "name": "Televisor TCL 50 pulgadas 4K",
            "slug": "televisor-tcl-50", "price": 450, "salePrice": 399.99, "onSale": True,
            "stockStatus": "instock", "stock": None, "brand": {"name": "TCL"},
            "categories": [{"name": "Audio y TV"}, {"name": "Televisores"}],
            "image": {"url": "https://example.test/tv.jpg"},
        }
        product = MultimaxScraper().parse_product(raw, datetime.now(timezone.utc))
        self.assertIsNotNone(product)
        self.assertEqual(str(product.price_usd), "399.99")
        self.assertEqual(str(product.list_price_usd), "450.00")
        self.assertEqual(product.brand, "TCL")
        self.assertEqual(product.category, "Televisores")
        self.assertEqual(product.model, "Q50S939GUS2")
        self.assertTrue(product.in_stock)


if __name__ == "__main__":
    unittest.main()
