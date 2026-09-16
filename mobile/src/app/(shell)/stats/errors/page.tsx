import { redirect } from "next/navigation";

import { StatsPage } from "@/components/app/mobile-redesign/StatsPage";
import { getCurrentUser } from "@/lib/auth/cookies";

export default async function StatsErrorsRoute() {
  if ((await getCurrentUser())?.role !== "owner") redirect("/stats/inquiries");
  return <StatsPage view="errors" />;
}
