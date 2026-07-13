import { Metadata } from "next";

export const metadata: Metadata = {
  title: "설정 - 아가잼잼 관리자",
};

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
