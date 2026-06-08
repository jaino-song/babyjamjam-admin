import { Metadata } from "next";

export const metadata: Metadata = {
  title: "발송 자동화 - 아가잼잼 관리자",
  description: "발송 자동화 - 아가잼잼 관리자",
};

export default function AlimtalkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
