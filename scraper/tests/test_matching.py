import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from matching import REVIEW_THRESHOLD, attribute_signature, canonical_model, color_tokens, homologation_eligible, infer_brand, model_tokens, normalize, processor_tokens, product_type, similarity


class CompetitorMatchingTests(unittest.TestCase):
    def test_explicitly_ambiguous_product_is_not_homologated(self):
        self.assertFalse(homologation_eligible({"homologationEligible": False}))
        self.assertFalse(homologation_eligible('{"homologationEligible": false}'))
        self.assertTrue(homologation_eligible({}))
        self.assertTrue(homologation_eligible(None))

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

    def test_short_phone_family_is_a_model_token(self):
        self.assertIn("A06", model_tokens("Celular Samsung Galaxy A06 64 GB"))
        self.assertIn("S26", model_tokens("Samsung Galaxy S26 Ultra 512 GB"))
        self.assertNotIn("64GB", model_tokens("Celular Samsung Galaxy A06 64 GB"))

    def test_color_is_informative_not_a_conflict(self):
        score, method, evidence = similarity(
            {"name": "Celular Samsung Galaxy A06 4 GB 64 GB Verde"},
            {"name": "Celular Samsung A06 4 GB 64 GB Azul"},
        )
        self.assertGreaterEqual(score, 0.93)
        self.assertEqual(method, "model_brand")
        self.assertFalse(evidence["conflicts"])
        self.assertTrue(evidence["variantNotes"])
        self.assertEqual(color_tokens("Equipo negro y azul"), {"negro", "azul"})

    def test_connectivity_technologies_are_not_models(self):
        tokens = model_tokens("Módem Router ADSL2+ WiFi 6 USB3 AC1200 300 Mbps")
        self.assertNotIn("ADSL2", tokens)
        self.assertNotIn("WIFI6", tokens)
        self.assertNotIn("USB3", tokens)
        self.assertNotIn("300MBPS", tokens)
        self.assertNotIn("AC1200", tokens)

    def test_phone_family_conflict_is_rejected(self):
        score, method, evidence = similarity(
            {"name": "Celular Galaxy A27 6GB RAM 128GB Samsung"},
            {"name": "Celular Samsung Galaxy A26 128GB 6GB RAM"},
        )
        self.assertEqual(score, 0)
        self.assertEqual(method, "model_conflict")
        self.assertTrue(evidence["conflicts"])

    def test_laptop_processor_family_conflict_is_rejected(self):
        score, method, evidence = similarity(
            {"name": "Laptop HP 15.6 Intel Core i5 8GB RAM 512GB SSD"},
            {"name": "Laptop HP 15.6 Intel Core 3 8GB RAM 512GB SSD"},
        )
        self.assertEqual(score, 0)
        self.assertEqual(method, "processor_conflict")
        self.assertEqual(processor_tokens("Intel Core i5"), {"intel-core-i5"})
        self.assertTrue(evidence["conflicts"])

    def test_product_url_disambiguates_network_model(self):
        daka = {
            "name": "Router Inalámbrico Gigabit Doble Banda AC1200 TP-Link",
            "url": "https://tiendasdaka.com/ve/products/router-ac1200-ec220g5-tp-link",
        }
        wrong = {
            "name": "Router Inalámbrico TP-Link Archer C64 AC1200",
            "url": "https://venelectronics.com/producto/router-tp-link-archer-c64-ac1200/",
        }
        exact = {
            "name": "Router Inalámbrico TP-Link Archer 5G AC1200",
            "url": "https://venelectronics.com/producto/router-tp-link-ec220g5-ac1200/",
        }
        wrong_score, wrong_method, _ = similarity(daka, wrong)
        exact_score, exact_method, exact_evidence = similarity(daka, exact)
        self.assertEqual(wrong_score, 0)
        self.assertEqual(wrong_method, "model_conflict")
        self.assertGreaterEqual(exact_score, 0.93)
        self.assertEqual(exact_method, "model_brand")
        self.assertIn("EC220G5", exact_evidence["sharedModels"])

    def test_network_attributes_are_extracted(self):
        attributes = attribute_signature("Router inalámbrico N 1 Gbps 5 GHz con cuatro antenas y 4 puertos")
        self.assertIn("1000:mbps", attributes)
        self.assertIn("5:ghz", attributes)
        self.assertIn("4:antenas", attributes)
        self.assertIn("4:puertos", attributes)
        self.assertIn("tech:wireless n", attributes)

    def test_generic_adsl_does_not_create_false_model_match(self):
        daka = {"name": "Modem Router 300 Mbps N ADSL2 Dos Antenas Blanco TP-Link"}
        wrong = {"name": "Módem Explore ADSL2+", "brand": "TP-LINK", "model": "HGA1101"}
        better = {"name": "Módem Router Inalámbrico ADSL2+ N 300Mbps", "brand": "TP-LINK", "model": "TDW8961N"}
        wrong_score, wrong_method, wrong_evidence = similarity(daka, wrong)
        better_score, better_method, better_evidence = similarity(daka, better)
        self.assertNotIn("ADSL2", wrong_evidence.get("sharedModels", []))
        self.assertLess(wrong_score, REVIEW_THRESHOLD)
        self.assertGreaterEqual(better_score, REVIEW_THRESHOLD)
        self.assertEqual(better_method, "brand_type_attributes")
        self.assertIn("300:mbps", better_evidence["sharedAttributes"])


if __name__ == "__main__":
    unittest.main()
