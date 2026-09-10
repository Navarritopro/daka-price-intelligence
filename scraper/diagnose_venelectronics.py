from venelectronics import VenelectronicsScraper


def main() -> int:
    products = VenelectronicsScraper().run(sample_pages=2)
    priced = [product for product in products if product.price_usd is not None]
    if not priced:
        raise RuntimeError("La página respondió, pero no presentó precios públicos")
    print(f"[OK] {len(products)} productos recibidos; {len(priced)} con precio público USD.")
    for product in priced[:5]:
        print(f"[MUESTRA] {product.external_id} | USD {product.price_usd} | {product.name}")
    print("[OK] Diagnóstico de solo lectura: no se escribió información en Neon.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
