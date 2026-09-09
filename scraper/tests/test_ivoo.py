from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ivoo import IvooScraper


class IvooScraperTests(unittest.TestCase):
    def setUp(self):
        self.scraper = IvooScraper()
        self.captured_at = datetime(2026, 9, 8, tzinfo=timezone.utc)

    def test_parses_public_graphql_price_and_identity(self):
        product = self.scraper.parse_product({
            "id": 100, "sku": "12000012912",
            "name": '43" Google TV FHD Síragon 43DD5020',
            "price": {"regularPrice": {"amount": {"currency": "USD", "value": 289.99}}},
            "small_image": {"url": "https://cdn.example/tv.jpg"},
            "url_key": "43-google-tv-fhd-siragon-43dd5020-12000012912", "url_suffix": ".html",
            "stock_breakdown": [{"region": "Caracas", "qty": 2}, {"region": "Valencia", "qty": 1}],
        }, self.captured_at)
        self.assertIsNotNone(product)
        self.assertEqual(product.external_id, "12000012912")
        self.assertEqual(product.price_usd, Decimal("289.99"))
        self.assertEqual(product.available_quantity, 3)
        self.assertTrue(product.in_stock)
        self.assertEqual(product.brand, "siragon")
        self.assertEqual(product.model, "43DD5020")
        self.assertEqual(product.category, "Televisores")
        self.assertEqual(product.metadata["pricingRule"], "public_regular_price")
        self.assertTrue(product.url.endswith(".html"))

    def test_zero_reported_stock_is_unavailable(self):
        product = self.scraper.parse_product({
            "id": 101, "sku": "ABC101", "name": "Licuadora Oster BLSTKAG",
            "price": {"regularPrice": {"amount": {"currency": "USD", "value": 49}}},
            "url_key": "licuadora-oster", "url_suffix": ".html",
            "stock_breakdown": [{"region": "Caracas", "qty": 0}],
        }, self.captured_at)
        self.assertFalse(product.in_stock)
        self.assertEqual(product.available_quantity, 0)

    def test_rejects_non_usd_catalog_value(self):
        with self.assertRaisesRegex(RuntimeError, "moneda inesperada"):
            self.scraper.parse_product({
                "id": 102, "sku": "ABC102", "name": "Televisor TCL",
                "price": {"regularPrice": {"amount": {"currency": "VES", "value": 100}}},
            }, self.captured_at)


if __name__ == "__main__":
    unittest.main()
