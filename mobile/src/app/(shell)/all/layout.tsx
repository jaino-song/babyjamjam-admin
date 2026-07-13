import { Metadata } from "next";

export const metadata: Metadata = {
  title: "전체 - 아가잼잼 관리자",
};

export default function AllLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
