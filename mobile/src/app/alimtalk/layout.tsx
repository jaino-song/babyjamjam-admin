import { Metadata } from "next";

export const metadata: Metadata = {
  title: "알림톡 - 아가잼잼 관리자",
  description: "알림톡 - 아가잼잼 관리자",
};

export default function AlimtalkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
