import { Metadata } from "next";

export const metadata: Metadata = {
  title: "지점 선택 - 아가잼잼 관리자",
};

export default function SelectBranchLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
