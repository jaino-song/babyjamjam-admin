import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "문의하기 | 인천 아이미래로",
  description: "인천 아이미래로에 문의하세요. 전화 (032) 442-5992, 이메일, 방문 상담 모두 가능합니다. 월-금 09:00-18:00, 토 09:00-13:00.",
};

export default function ContactLayout({ children }: { children: React.ReactNode }) {
  return children;
}
