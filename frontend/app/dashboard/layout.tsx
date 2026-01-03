import { ReactNode } from "react";
import { getCurrentUser } from "@/app/lib/auth/cookies";
import { redirect } from "next/navigation";

interface DashboardLayoutProps {
  children: ReactNode;
}

// 대시보드 레이아웃 - 인증된 사용자만 접근 가능
// NOTE: UserProvider는 root layout에 있음 (ConditionalHeader에서 사용)
// NOTE: getCurrentUser()는 React cache()로 감싸져 있어 중복 호출되지 않음
export default async function DashboardLayout({ children }: DashboardLayoutProps) {
  const user = await getCurrentUser();

  // 인증되지 않은 사용자는 로그인 페이지로 리다이렉트
  if (!user) {
    redirect("/login");
  }

  return <>{children}</>;
}
