import { Metadata } from "next";

export const metadata: Metadata = {
  title: "아가잼잼 관리자 - 메시지",
  description: "아가잼잼 관리자 - 메시지",
};

export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
