import type { ReactNode } from "react";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth/cookies";

export default async function StatsLayout({ children }: { children: ReactNode }) {
  if (!(await getCurrentUser())) redirect("/login");
  return children;
}
