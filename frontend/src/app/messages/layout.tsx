import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Incheon Imirae Back Office - Messages",
  description: "Incheon Imirae Back Office - Messages",
};

export default function MessagesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
