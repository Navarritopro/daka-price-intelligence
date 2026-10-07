from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from soytechno import API_URL, SoyTechnoScraper


def product_fixture(**overrides):
    value = {
        "id": 9001, "sku": "TV005-00026", "name": "Televisor TCL 75 4K 75V61C",
        "slug": "televisor-tcl-75-4k-75v61c", "permalink": "https://soytechno.com/producto/tv/",
        "prices": {"currency_code": "USD", "currency_minor_unit": 2,
                   "price": "94900", "regular_price": "121000", "sale_price": "94900"},
        "images": [{"src": "https://soytechno.com/tv.jpg"}],
        "categories": [{"name": "Televisores"}, {"name": "Smart TV"}],
        "brands": [{"name": "TCL"}], "is_in_stock": True,
        "attributes": [{"name": "Modelo", "terms": [{"name": "75V61C"}]}],
    }
    value.update(overrides)
    return value


class SoyTechnoScraperTests(unittest.TestCase):
    def setUp(self):
        self.scraper = SoyTechnoScraper()
        self.captured_at = datetime(2026, 10, 7, tzinfo=timezone.utc)

    def test_uses_public_rest_route_instead_of_protected_wp_json_path(self):
        self.assertIn("rest_route=/wc/store/v1/products", API_URL)
        self.assertNotIn("/wp-json/", API_URL)

    def test_parses_public_price_list_price_identity_and_stock(self):
        product = self.scraper.parse_product(product_fixture(), self.captured_at)
        self.assertIsNotNone(product)
        self.assertEqual(product.external_id, "TV005-00026")
        self.assertEqual(product.price_usd, Decimal("949.00"))
        self.assertEqual(product.list_price_usd, Decimal("1210.00"))
        self.assertEqual(product.brand, "TCL")
        self.assertEqual(product.model, "75V61C")
        self.assertEqual(product.category, "Televisores")
        self.assertTrue(product.in_stock)
        self.assertIsNone(product.available_quantity)

    def test_decodes_html_entities_in_product_name(self):
        product = self.scraper.parse_product(product_fixture(name="Laptop HP &#8211; 16GB"), self.captured_at)
        self.assertEqual(product.name, "Laptop HP – 16GB")

    def test_parses_variation_with_own_sku(self):
        product = self.scraper.parse_product(product_fixture(
            id=9010, sku="CEL-256-BLU", name="Teléfono Samsung Galaxy",
            variation="256GB / Blue", parent_id=9009,
        ), self.captured_at, is_variation=True)
        self.assertIsNotNone(product)
        self.assertIn("256GB / Blue", product.name)
        self.assertEqual(product.metadata["parentId"], 9009)
        self.assertTrue(product.metadata["isVariation"])

    def test_rejects_variation_without_own_sku(self):
        product = self.scraper.parse_product(product_fixture(sku="", variation="512GB"), self.captured_at, is_variation=True)
        self.assertIsNone(product)

    def test_excludes_test_and_special_products(self):
        self.assertIsNone(self.scraper.parse_product(product_fixture(name="Producto de prueba"), self.captured_at))
        self.assertIsNone(self.scraper.parse_product(product_fixture(name="Producto especial Soytechno 3"), self.captured_at))

    def test_rejects_zero_price(self):
        raw = product_fixture(prices={"currency_code": "USD", "currency_minor_unit": 2, "price": "0"})
        self.assertIsNone(self.scraper.parse_product(raw, self.captured_at))

    def test_rejects_non_usd_value(self):
        raw = product_fixture(prices={"currency_code": "VES", "currency_minor_unit": 2, "price": "94900"})
        with self.assertRaisesRegex(RuntimeError, "moneda inesperada"):
            self.scraper.parse_product(raw, self.captured_at)

    def test_extracts_parent_from_api_link(self):
        raw = product_fixture(parent_id=None, parent=None, _links={"up": [{"href": "https://soytechno.com/wp-json/wc/store/v1/products/8123"}]})
        self.assertEqual(self.scraper._parent_id(raw), 8123)

    def test_run_prefers_sku_variations_and_marks_ambiguous_parent(self):
        variable_parent = product_fixture(id=9100, sku="PARENT-1", name="Teléfono Samsung Galaxy", has_options=True)
        child = product_fixture(id=9101, sku="CHILD-256", name="Teléfono Samsung Galaxy", parent_id=9100, variation="256GB")
        ambiguous_without_exposed_child = product_fixture(id=9200, sku="PARENT-2", name="Laptop HP ABC1234", has_options=True)
        collections = [([variable_parent, ambiguous_without_exposed_child], 1), ([child], 1)]
        self.scraper._fetch_collection = lambda **kwargs: collections.pop(0)

        products = self.scraper.run()

        by_id = {product.external_id: product for product in products}
        self.assertNotIn("PARENT-1", by_id)
        self.assertIn("CHILD-256", by_id)
        self.assertFalse(by_id["PARENT-2"].metadata["homologationEligible"])


if __name__ == "__main__":
    unittest.main()
