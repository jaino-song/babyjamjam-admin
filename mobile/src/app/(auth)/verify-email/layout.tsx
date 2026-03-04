import { Metadata } from "next";

export const metadata: Metadata = {
  title: "이메일 인증 - 아가잼잼 관리자",
};

export default function VerifyEmailLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
