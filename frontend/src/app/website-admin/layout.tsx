import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/cookies";

export const metadata: Metadata = {
  title: "홈페이지 관리",
};

interface WebsiteAdminLayoutProps {
  children: ReactNode;
}

export default async function WebsiteAdminLayout({ children }: WebsiteAdminLayoutProps) {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  if (user.role !== "owner") {
    redirect("/dashboard");
  }

  return children;
}
