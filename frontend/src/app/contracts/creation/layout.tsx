import { Metadata } from "next";

export const metadata: Metadata = {
  title: "새 계약 생성 - 아가잼잼 관리자",
};

export default function ContractCreationLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
