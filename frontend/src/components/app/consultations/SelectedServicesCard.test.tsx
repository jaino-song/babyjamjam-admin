import * as React from "react";
import { render, screen } from "@testing-library/react";

import { SelectedServicesCard } from "./SelectedServicesCard";

const baseInquiry = {
  id: "inquiry-1",
  branchId: "branch-1",
  publicBranchSlug: "incheon-namdong",
  motherName: "강감찬",
  phone: "010-9641-1878",
  address: "남동구 논현동",
  dueDate: "2026-04-23T00:00:00.000Z",
  birthExperience: "초산",
  voucherType: "B통합-1형",
  preferredCaregiverName: "서경자",
  referralSource: "시군구청",
  privacyAcceptedAt: "2026-04-23T08:42:36.733Z",
  additionalNotes: "밤 시간 상담을 원합니다.",
  source: "website",
  status: "new",
  readAt: "2026-04-23T08:50:00.000Z",
  createdAt: "2026-04-23T08:42:36.733Z",
  updatedAt: "2026-04-23T08:42:36.733Z",
  branchName: "인천점",
};

describe("SelectedServicesCard", () => {
  it("renders 산후도우미서비스 플랜 and 추가 서비스 rows", () => {
    render(
      <SelectedServicesCard
        inquiry={{
          ...baseInquiry,
          selectedServices: {
            plan: {
              id: "plan-1",
              name: "프리미엄",
              priceLabel: "2,400,000원",
              durationDays: 15,
            },
            addons: [
              {
                id: "addon-1",
                name: "첫만남 이용권",
                priceLabel: "200,000원",
                quantity: 2,
                group: "혜택",
              },
              {
                id: "addon-2",
                name: "가사 연장",
                priceLabel: "150,000원",
                quantity: 1,
                group: "연장",
              },
            ],
          },
        }}
      />,
    );

    expect(screen.getByText("서비스 정보")).toBeInTheDocument();
    expect(screen.getByText("서비스 플랜")).toBeInTheDocument();
    expect(screen.getByText("프리미엄 · 2,400,000원")).toBeInTheDocument();
    expect(screen.getByText("서비스 기간")).toBeInTheDocument();
    expect(screen.getByText("15일")).toBeInTheDocument();
    expect(screen.getByText("추가 서비스")).toBeInTheDocument();
    expect(screen.getByText("첫만남 이용권 × 2 · 200,000원")).toBeInTheDocument();
    expect(screen.getByText("가사 연장 · 150,000원")).toBeInTheDocument();
  });

  it("renders an empty fallback when selected services are missing", () => {
    render(
      <SelectedServicesCard
        inquiry={{
          ...baseInquiry,
          selectedServices: null,
        }}
      />,
    );

    expect(screen.getByText("서비스 정보")).toBeInTheDocument();
    expect(screen.getByText("선택 서비스 없음")).toBeInTheDocument();
  });
});
