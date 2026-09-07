import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from matching import attribute_signature, canonical_model, infer_brand, model_tokens, normalize, product_type, similarity


class CompetitorMatchingTests(unittest.TestCase):
    def test_normalize_accents_and_symbols(self):
        self.assertEqual(normalize("TV DA+CO 55”"), "tv da co 55")

    def test_daco_brand_alias(self):
        self.assertEqual(infer_brand("Aire DA+CO DMTL-MS12-W1"), "damasco")

    def test_model_token_excludes_voltage(self):
        tokens = model_tokens("AC Samsung AR12BVHQ 220V 12K BTU")
        self.assertIn("AR12BVHQ", tokens)
        self.assertNotIn("220V", tokens)

    def test_exact_model_and_brand_is_automatic(self):
        score, method, evidence = similarity(
            {"name": "Nevera Samsung RT29K500JS8 300 litros", "brand": None, "model": None},
            {"name": "REFRIGERADOR SAMSUNG 300L RT29K500JS8", "brand": "Samsung", "model": "RT29K500JS8"},
        )
        self.assertGreaterEqual(score, 0.90)
        self.assertEqual(method, "model_brand")
        self.assertIn("RT29K500JS8", evidence["sharedModels"])

    def test_different_brands_do_not_match(self):
        score, method, _ = similarity(
            {"name": "Nevera Samsung ABC1234", "brand": "Samsung", "model": "ABC1234"},
            {"name": "Nevera LG ABC1234", "brand": "LG", "model": "ABC1234"},
        )
        self.assertEqual(score, 0)
        self.assertEqual(method, "brand_conflict")

    def test_brand_from_name_overrides_incorrect_catalog_brand(self):
        self.assertEqual(infer_brand("INFINIX HOT 70 PRO", "Samsung"), "infinix")

    def test_product_type_synonyms(self):
        self.assertEqual(product_type("Refrigerador Samsung 300 litros"), "nevera")

    def test_decimal_capacity_is_preserved(self):
        self.assertIn("1.5:l", attribute_signature("Licuadora de 1,5 litros"))

    def test_attributes_create_review_not_automatic_match(self):
        score, method, evidence = similarity(
            {"name": "Lavadora carga superior de 21 kg Samsung", "brand": None, "model": None},
            {"name": "Lavadora Samsung 21Kg WA21B3543GW", "brand": "Samsung", "model": None},
        )
        self.assertGreaterEqual(score, 0.72)
        self.assertLess(score, 0.90)
        self.assertEqual(method, "brand_type_attributes")
        self.assertIn("21:kg", evidence["sharedAttributes"])

    def test_model_separators_are_normalized(self):
        self.assertEqual(canonical_model("RT29K500-JS8"), "RT29K500JS8")
        score, _, evidence = similarity(
            {"name": "Nevera Samsung RT29K500-JS8 300 litros"},
            {"name": "Refrigerador Samsung RT29K500JS8 300L"},
        )
        self.assertGreaterEqual(score, 0.93)
        self.assertIn("RT29K500JS8", evidence["sharedModels"])

    def test_different_sizes_are_rejected(self):
        score, method, evidence = similarity(
            {"name": "Televisor Samsung Smart TV 55 pulgadas"},
            {"name": "Televisor Samsung Smart TV 65 pulgadas"},
        )
        self.assertEqual(score, 0)
        self.assertEqual(method, "attribute_conflict")
        self.assertTrue(evidence["conflicts"])

    def test_type_and_attribute_without_brand_can_be_reviewed(self):
        score, method, evidence = similarity(
            {"name": "Aire acondicionado inverter 12000 BTU blanco"},
            {"name": "Split 12.000 BTU Inverter con control remoto"},
        )
        self.assertGreaterEqual(score, 0.66)
        self.assertEqual(method, "type_attributes")
        self.assertTrue(evidence["warnings"])


if __name__ == "__main__":
    unittest.main()
