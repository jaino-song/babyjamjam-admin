import { Metadata } from "next";

export const metadata: Metadata = {
  title: "메시지 - 아가잼잼 관리자",
  description: "메시지 - 아가잼잼 관리자",
};

export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
