from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from venelectronics import VenelectronicsScraper


class VenelectronicsScraperTests(unittest.TestCase):
    def setUp(self):
        self.scraper = VenelectronicsScraper()
        self.captured_at = datetime(2026, 9, 9, tzinfo=timezone.utc)

    def test_parses_public_woocommerce_price_stock_and_identity(self):
        product = self.scraper.parse_product({
            "id": 7001, "sku": "SY-BHS12C63RVB4",
            "name": "Aire acondicionado SYON 12000 btu split, blanco, 220.",
            "slug": "aire-acondicionado-syon-12000-btu-split-blanco-220",
            "permalink": "https://venelectronics.com/producto/aire-acondicionado-syon-12000-btu-split-blanco-220/",
            "prices": {"currency_code": "USD", "currency_minor_unit": 2,
                       "price": "22999", "regular_price": "22999", "sale_price": "22999"},
            "images": [{"src": "https://cdn.example/aire.jpg"}],
            "categories": [{"name": "Línea blanca"}, {"name": "Split"}],
            "is_in_stock": True, "low_stock_remaining": 24,
            "attributes": [{"name": "Modelo", "terms": [{"name": "BHS12C63RVB4"}]}],
        }, self.captured_at)
        self.assertIsNotNone(product)
        self.assertEqual(product.external_id, "SY-BHS12C63RVB4")
        self.assertEqual(product.price_usd, Decimal("229.99"))
        self.assertEqual(product.available_quantity, 24)
        self.assertTrue(product.in_stock)
        self.assertEqual(product.category, "Aires acondicionados")
        self.assertEqual(product.model, "BHS12C63RVB4")
        self.assertEqual(product.metadata["pricingRule"], "woocommerce_public_price")

    def test_keeps_higher_regular_price_as_list_price(self):
        product = self.scraper.parse_product({
            "id": 7002, "sku": "TV-43", "name": "Televisor AIWA 43 Google TV",
            "prices": {"currency_code": "USD", "currency_minor_unit": 2,
                       "price": "21999", "regular_price": "23999", "sale_price": "21999"},
            "is_in_stock": True,
        }, self.captured_at)
        self.assertEqual(product.price_usd, Decimal("219.99"))
        self.assertEqual(product.list_price_usd, Decimal("239.99"))

    def test_rejects_non_usd_value(self):
        with self.assertRaisesRegex(RuntimeError, "moneda inesperada"):
            self.scraper.parse_product({
                "id": 7003, "sku": "ABC", "name": "Nevera AIWA",
                "prices": {"currency_code": "VES", "currency_minor_unit": 2, "price": "10000"},
            }, self.captured_at)

    def test_detects_siteground_antibot_challenge(self):
        class Response:
            status_code = 202
            headers = {"content-type": "text/html", "sg-captcha": "challenge"}
            text = '<meta http-equiv="refresh" content="/.well-known/sgcaptcha/">'
        self.assertTrue(self.scraper._challenge(Response()))

    @patch("venelectronics.time.sleep")
    def test_retries_same_page_after_temporary_antibot_challenge(self, sleep):
        class Response:
            def __init__(self, status_code, headers, payload=None, text=""):
                self.status_code = status_code
                self.headers = headers
                self._payload = payload
                self.text = text

            def raise_for_status(self):
                return None

            def json(self):
                return self._payload

        challenge = Response(
            202,
            {"content-type": "text/html", "sg-captcha": "challenge"},
            text='<meta http-equiv="refresh" content="/.well-known/sgcaptcha/">',
        )
        recovered = Response(
            200,
            {"content-type": "application/json", "X-WP-TotalPages": "7"},
            payload=[{"id": 7004, "name": "Producto recuperado"}],
        )
        self.scraper.retry_attempts = 3
        self.scraper.challenge_base_seconds = 20
        self.scraper.session.get = unittest.mock.Mock(side_effect=[challenge, recovered])

        products, total_pages = self.scraper.fetch_page(2)

        self.assertEqual(len(products), 1)
        self.assertEqual(total_pages, 7)
        self.assertEqual(self.scraper.session.get.call_count, 2)
        sleep.assert_called_once_with(20)


if __name__ == "__main__":
    unittest.main()
