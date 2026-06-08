import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "상담 조회 - 아가잼잼 관리자",
  description: "상담 조회 - 아가잼잼 관리자",
};

export default function ConsultationsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
