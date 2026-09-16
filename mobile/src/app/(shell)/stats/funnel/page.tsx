import { redirect } from "next/navigation";

import { StatsPage } from "@/components/app/mobile-redesign/StatsPage";
import { getCurrentUser } from "@/lib/auth/cookies";

export default async function StatsFunnelRoute() {
  if ((await getCurrentUser())?.role !== "owner") redirect("/stats/inquiries");
  return <StatsPage view="funnel" />;
}
