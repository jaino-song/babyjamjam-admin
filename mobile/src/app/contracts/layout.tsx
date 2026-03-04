import { Metadata } from "next";

export const metadata: Metadata = {
  title: "계약 - 아가잼잼 관리자",
};

export default function ContractsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
