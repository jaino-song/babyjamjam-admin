import { Metadata } from "next";

export const metadata: Metadata = {
  title: "로그아웃 - 아가잼잼 관리자",
};

export default function LogoutLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
