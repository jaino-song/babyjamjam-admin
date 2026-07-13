import { getMobileClientBadges } from "../badges";

import type { Client } from "../types";

const BASE_CLIENT: Client = {
  id: 1,
  name: "테스트 고객",
  createdAt: null,
  updatedAt: null,
  birthday: null,
  dueDate: null,
  address: null,
  phone: null,
  primaryEmployee: { id: 1, name: "김정인" },
  secondaryEmployee: null,
  type: "A통합1형",
  duration: 10,
  fullPrice: null,
  grant: null,
  actualPrice: null,
  startDate: "2026-07-01",
  endDate: "2026-07-10",
  careCenter: false,
  voucherClient: false,
  breastPump: true,
  serviceStatus: "active",
  eDocId: null,
  hasSigned: false,
  documentStatus: null,
};

describe("getMobileClientBadges", () => {
  it("uses frontend client badge priority and labels for mobile surfaces", () => {
    expect(getMobileClientBadges(BASE_CLIENT).map((badge) => badge.label)).toEqual([
      "계약서 필요",
      "진행중",
      "유축기 대여",
    ]);
  });

  it("does not synthesize dashboard-only action labels", () => {
    expect(getMobileClientBadges(BASE_CLIENT).map((badge) => badge.label)).not.toContain("발송 대기");
  });
});
