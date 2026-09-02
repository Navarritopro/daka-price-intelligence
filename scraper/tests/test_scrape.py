import sys
import unittest
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils import extract_sap, parse_price


class ScraperParserTests(unittest.TestCase):
    def test_parse_us_price(self):
        self.assertEqual(parse_price("$ 1,299.99"), Decimal("1299.99"))

    def test_parse_ve_price(self):
        self.assertEqual(parse_price("USD 1.299,99"), Decimal("1299.99"))

    def test_parse_simple_price(self):
        self.assertEqual(parse_price("$349.00"), Decimal("349.00"))

    def test_parse_missing_price(self):
        self.assertIsNone(parse_price(""))
        self.assertIsNone(parse_price(None))

    def test_extract_sap_from_encoded_image_url(self):
        url = "https://cdn.example.com/productos/LH-104582%20frontal.webp"
        self.assertEqual(extract_sap(url), "LH-104582")

    def test_extract_sap_falls_back_to_product_url(self):
        self.assertEqual(extract_sap(None, "/producto/televisor-LT-338901"), "LT-338901")


if __name__ == "__main__":
    unittest.main()
