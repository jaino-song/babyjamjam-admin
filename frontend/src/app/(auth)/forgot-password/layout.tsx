import { Metadata } from "next";

export const metadata: Metadata = {
  title: "비밀번호 찾기 - 아가잼잼 관리자",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
