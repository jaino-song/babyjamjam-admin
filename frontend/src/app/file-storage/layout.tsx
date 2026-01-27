import { Metadata } from "next";

export const metadata: Metadata = {
  title: "문서 관리",
  description: "문서 업로드 및 관리",
};

export default function FileStorageLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
