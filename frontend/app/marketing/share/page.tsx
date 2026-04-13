import { Suspense } from "react";
import { MarketingSharePage } from "@/components/marketing/MarketingSharePage";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MarketingSharePage />
    </Suspense>
  );
}
