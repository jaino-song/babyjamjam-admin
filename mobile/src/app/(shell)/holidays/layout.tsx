import { Metadata } from "next";

export const metadata: Metadata = {
  title: "공휴일 - 아가잼잼 관리자",
};

export default function HolidaysLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
