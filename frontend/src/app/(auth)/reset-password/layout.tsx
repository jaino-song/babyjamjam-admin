import { Metadata } from "next";

export const metadata: Metadata = {
  title: "비밀번호 재설정 - 아가잼잼 관리자",
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
