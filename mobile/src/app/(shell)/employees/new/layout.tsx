import { Metadata } from "next";

export const metadata: Metadata = {
  title: "직원 등록 - 아가잼잼 관리자",
};

export default function EmployeeNewLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
