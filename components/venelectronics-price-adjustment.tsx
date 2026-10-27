"use client";

import PriceAdjustmentControl from "@/components/price-adjustment-control";

export default function VenelectronicsPriceAdjustment(props: { canAdmin?: boolean; controls?: boolean }) {
  return <PriceAdjustmentControl source="venelectronics" {...props}/>;
}
