import { Metadata } from "next";

export const metadata: Metadata = {
  title: "파일 - 아가잼잼 관리자",
};

export default function FilesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
