from soytechno import SoyTechnoScraper


def main() -> int:
    products = SoyTechnoScraper().run(sample_pages=2)
    priced = [product for product in products if product.price_usd is not None]
    variants = [product for product in products if product.metadata.get("isVariation")]
    ambiguous = [product for product in products if not product.metadata.get("homologationEligible", True)]
    if not priced:
        raise RuntimeError("La API respondió, pero no presentó precios públicos USD")
    print(f"[OK] {len(products)} productos válidos; {len(variants)} variantes con SKU; {len(ambiguous)} variables para revisión.")
    for product in priced[:5]:
        print(f"[MUESTRA] {product.external_id} | USD {product.price_usd} | {product.name}")
    print("[OK] Diagnóstico de solo lectura: no se escribió información en PostgreSQL.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
