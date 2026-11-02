"use client";

import { VoucherPriceTable } from "@/components/app/settings/VoucherPriceTable";
import { StatsBar } from "@/components/app/v3/StatsBar";

export default function PricesPage() {
  return (
    <section data-component="desktop_prices_page" className="flex h-full min-h-0 flex-col gap-6">
      <StatsBar items={[]} showDocumentJobs="whenActive" name="desktop_prices_page" />
      <VoucherPriceTable />
    </section>
  );
}
