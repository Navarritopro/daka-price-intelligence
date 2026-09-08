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

    def test_uses_public_price_instead_of_internal_savings_price(self):
        raw = {
            "id": "remote-1", "sku": "Q50S939GUS2", "name": "Televisor TCL 50 pulgadas 4K",
            "slug": "televisor-tcl-50", "price": 450, "salePrice": 399.99, "onSale": True,
            "stockStatus": "instock", "stock": None, "brand": {"name": "TCL"},
            "categories": [{"name": "Audio y TV"}, {"name": "Televisores"}],
            "image": {"url": "https://example.test/tv.jpg"},
        }
        product = MultimaxScraper().parse_product(raw, datetime.now(timezone.utc))
        self.assertIsNotNone(product)
        self.assertEqual(str(product.price_usd), "450.00")
        self.assertIsNone(product.list_price_usd)
        self.assertEqual(product.metadata["alternateSalePrice"], 399.99)
        self.assertEqual(product.metadata["pricingRule"], "public_product_detail")
        self.assertEqual(product.brand, "TCL")
        self.assertEqual(product.category, "Televisores")
        self.assertEqual(product.model, "Q50S939GUS2")
        self.assertTrue(product.in_stock)

    def test_preserves_a_real_regular_price_when_it_is_above_public_price(self):
        raw = {
            "id": "remote-2", "sku": "CUHF5TD", "name": "Aire Split Fan-Coil 5 Tn Frigilux",
            "slug": "aire-split-frigilux-fan-coil-5-tn-ducteria-horizontal",
            "price": 2884, "regularPrice": 3000, "salePrice": 2307.99, "onSale": True,
            "stockStatus": "instock", "brand": {"name": "FRIGILUX"},
        }
        product = MultimaxScraper().parse_product(raw, datetime.now(timezone.utc))
        self.assertEqual(str(product.price_usd), "2884.00")
        self.assertEqual(str(product.list_price_usd), "3000.00")
        self.assertEqual(product.metadata["precioAhorroUsd"], None)


if __name__ == "__main__":
    unittest.main()
