import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/cookies";

export const metadata: Metadata = {
  title: "오너 관리자",
};

interface SystemAdminLayoutProps {
  children: ReactNode;
}

export default async function SystemAdminLayout({ children }: SystemAdminLayoutProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "owner") {
    redirect("/dashboard");
  }

  return children;
}
