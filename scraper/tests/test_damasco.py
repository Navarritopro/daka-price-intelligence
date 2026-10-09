from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from damasco import Category, DamascoScraper


class DamascoRetryTests(unittest.TestCase):
    @staticmethod
    def response(status: int, payload):
        response = Mock()
        response.status_code = status
        response.headers = {"resources": "0-49/1221"}
        response.json.return_value = payload
        if status >= 400:
            response.raise_for_status.side_effect = requests.HTTPError(
                f"{status} Server Error", response=response
            )
        return response

    @patch("damasco.time.sleep")
    def test_retries_http_500_and_recovers_without_skipping_block(self, sleep):
        scraper = DamascoScraper()
        scraper.retry_base_seconds = 0.1
        scraper.session.get = Mock(side_effect=[
            self.response(500, None),
            self.response(500, None),
            self.response(200, [{"productId": "1"}]),
        ])

        response, payload = scraper.fetch_block(1000, 1049)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload, [{"productId": "1"}])
        self.assertEqual(scraper.session.get.call_count, 3)
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [0.1, 0.2])
        self.assertTrue(any("HTTP 500" in log["message"] for log in scraper.logs))

    @patch("damasco.time.sleep")
    def test_fails_after_three_attempts_instead_of_returning_partial_data(self, sleep):
        scraper = DamascoScraper()
        scraper.session.get = Mock(side_effect=[
            self.response(500, None), self.response(500, None), self.response(500, None)
        ])

        with self.assertRaisesRegex(RuntimeError, "después de 3 intentos"):
            scraper.fetch_block(1000, 1049)

        self.assertEqual(scraper.session.get.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    @patch("damasco.time.sleep")
    def test_does_not_retry_non_transient_http_400(self, sleep):
        scraper = DamascoScraper()
        scraper.session.get = Mock(return_value=self.response(400, None))

        with self.assertRaisesRegex(RuntimeError, "HTTP 400"):
            scraper.fetch_block(2500, 2549)

        self.assertEqual(scraper.session.get.call_count, 1)
        sleep.assert_not_called()

    def test_category_filter_is_sent_with_the_vtex_path(self):
        scraper = DamascoScraper()
        scraper.session.get = Mock(return_value=self.response(200, []))

        scraper.fetch_block(0, 49, "/10/20/30/")

        self.assertEqual(
            scraper.session.get.call_args.kwargs["params"],
            {"_from": 0, "_to": 49, "fq": "C:/10/20/30/"},
        )


class DamascoPaginationTests(unittest.TestCase):
    @staticmethod
    def raw_product(product_id: int | str) -> dict:
        return {
            "productId": str(product_id),
            "productName": f"Producto {product_id}",
            "items": [{
                "ean": str(product_id),
                "images": [],
                "sellers": [{
                    "sellerDefault": True,
                    "commertialOffer": {
                        "Price": 10,
                        "ListPrice": 12,
                        "AvailableQuantity": 1,
                        "IsAvailable": True,
                    },
                }],
            }],
        }

    def test_builds_only_leaf_category_paths(self):
        tree = [{
            "id": 10,
            "name": "Electrodomésticos",
            "children": [{
                "id": 20,
                "name": "Cocina",
                "children": [
                    {"id": 30, "name": "Licuadoras", "children": []},
                    {"Id": 40, "Name": "Microondas", "Children": []},
                ],
            }],
        }]

        categories = DamascoScraper._leaf_categories(tree)

        self.assertEqual(categories, [
            Category("/10/20/30/", "Electrodomésticos > Cocina > Licuadoras"),
            Category("/10/20/40/", "Electrodomésticos > Cocina > Microondas"),
        ])

    @patch("damasco.time.sleep")
    def test_combines_more_than_2500_products_from_separate_categories(self, sleep):
        scraper = DamascoScraper()
        scraper.log = Mock()
        scraper.fetch_categories = Mock(return_value=[
            Category("/1/", "Categoría A"),
            Category("/2/", "Categoría B"),
        ])
        category_sizes = {"/1/": 1300, "/2/": 1300}
        requested_ranges: list[tuple[str, int, int]] = []

        def fetch_block(start: int, end: int, category_path: str):
            requested_ranges.append((category_path, start, end))
            total = category_sizes[category_path]
            last = min(end, total - 1)
            response = Mock(headers={"resources": f"{start}-{last}/{total}"})
            return response, [
                self.raw_product(f"{category_path}-{index}")
                for index in range(start, last + 1)
            ]

        scraper.fetch_block = Mock(side_effect=fetch_block)

        products = scraper.run()

        self.assertEqual(len(products), 2600)
        self.assertEqual(scraper.pages_scanned, 52)
        self.assertIn(("/1/", 0, 49), requested_ranges)
        self.assertIn(("/2/", 0, 49), requested_ranges)
        self.assertFalse(any(start >= 2500 for _, start, _ in requested_ranges))
        self.assertEqual(sleep.call_count, 50)

    @patch("damasco.time.sleep")
    def test_deduplicates_products_returned_by_multiple_categories(self, sleep):
        scraper = DamascoScraper()
        scraper.log = Mock()
        scraper.fetch_categories = Mock(return_value=[
            Category("/1/", "Categoría A"),
            Category("/2/", "Categoría B"),
        ])
        response = Mock(headers={"resources": "0-1/2"})
        shared = self.raw_product("shared")
        scraper.fetch_block = Mock(side_effect=[
            (response, [self.raw_product("a"), shared]),
            (response, [self.raw_product("b"), shared]),
        ])

        products = scraper.run()

        self.assertEqual({product.external_id for product in products}, {"a", "b", "shared"})
        self.assertEqual(scraper.pages_scanned, 2)
        sleep.assert_not_called()

    @patch("damasco.time.sleep")
    def test_fails_if_one_leaf_category_reaches_vtex_limit(self, sleep):
        scraper = DamascoScraper()
        scraper.log = Mock()
        scraper.fetch_categories = Mock(return_value=[Category("/1/", "Categoría grande")])
        requested_ranges: list[tuple[int, int]] = []

        def fetch_block(start: int, end: int, category_path: str):
            requested_ranges.append((start, end))
            response = Mock(headers={"resources": f"{start}-{end}/2500"})
            return response, [self.raw_product(index) for index in range(start, end + 1)]

        scraper.fetch_block = Mock(side_effect=fetch_block)

        with self.assertRaisesRegex(RuntimeError, "evitar guardar un catálogo parcial"):
            scraper.run()

        self.assertEqual(requested_ranges[-1], (2450, 2499))
        self.assertNotIn((2500, 2549), requested_ranges)


if __name__ == "__main__":
    unittest.main()
