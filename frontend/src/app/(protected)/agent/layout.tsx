import { Metadata } from "next";

export const metadata: Metadata = {
  title: "에이전트 - 아가잼잼 관리자",
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
