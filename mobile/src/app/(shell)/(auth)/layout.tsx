import { Metadata } from "next";
import { AuthPageLayout } from "@/components/auth/auth-page-layout";
import "@/components/app/mobile-redesign/redesign.css";

export const metadata: Metadata = {
  title: "로그인 - 아가잼잼 관리자",
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <AuthPageLayout data-component="mobile_auth_layout">{children}</AuthPageLayout>;
}
