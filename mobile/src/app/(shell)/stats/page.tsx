import { redirect } from "next/navigation";

import { StatsPage } from "@/components/app/mobile-redesign/StatsPage";
import { getCurrentUser } from "@/lib/auth/cookies";

export default async function StatsOverviewRoute() {
  const user = await getCurrentUser();
  if (user?.role !== "owner") redirect("/stats/inquiries");
  return <StatsPage />;
}
