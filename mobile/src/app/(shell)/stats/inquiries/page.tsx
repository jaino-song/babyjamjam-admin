import { redirect } from "next/navigation";

import { StatsPage } from "@/components/app/mobile-redesign/StatsPage";
import { getCurrentUser } from "@/lib/auth/cookies";

export default async function StatsInquiriesRoute() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "owner" && !(user as { branchSlug?: string | null }).branchSlug) redirect("/dashboard");
  return <StatsPage view="inquiries" />;
}
