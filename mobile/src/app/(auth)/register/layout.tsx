import { Metadata } from "next";

export const metadata: Metadata = {
  title: "회원가입 - 아가잼잼 관리자",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
