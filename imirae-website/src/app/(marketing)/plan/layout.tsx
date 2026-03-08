import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "서비스 비용 | 인천 아이미래로",
  description: "스탠다드, 프리미엄, VIP 3가지 산후관리 요금제를 비교해 보세요. 정부지원 바우처 사용 가능. 무료 상담으로 맞춤 비용을 확인하세요.",
};

export default function PlanLayout({ children }: { children: React.ReactNode }) {
  return children;
}
