import {
  getDisplayedConsultationInquiries,
  getLatestUniqueConsultationInquiries,
} from "./list-state";

import type { ConsultationInquiry } from "@/services/api";

function createInquiry(
  overrides: Partial<ConsultationInquiry> = {},
): ConsultationInquiry {
  return {
    id: "inquiry-1",
    branchId: "branch-1",
    publicBranchSlug: "incheon",
    motherName: "강감찬",
    phone: "010-1111-2222",
    address: "인천",
    dueDate: "2026-05-01T00:00:00.000Z",
    birthExperience: "초산",
    voucherType: null,
    preferredCaregiverName: null,
    referralSource: "홈페이지",
    privacyAcceptedAt: "2026-04-23T00:00:00.000Z",
    selectedServices: null,
    additionalNotes: null,
    source: "website",
    status: "new",
    readAt: null,
    createdAt: "2026-04-23T00:00:00.000Z",
    updatedAt: "2026-04-23T00:00:00.000Z",
    branchName: "인천점",
    ...overrides,
  };
}

describe("consultation list state", () => {
  it("keeps the selected inquiry visible in the unread tab even after refetch removes it", () => {
    const selectedInquiry = createInquiry({
      id: "selected",
      readAt: "2026-04-23T10:03:42.725Z",
    });
    const remainingInquiry = createInquiry({
      id: "remaining",
      motherName: "이순신",
      phone: "010-3333-4444",
    });

    const result = getDisplayedConsultationInquiries({
      inquiries: [remainingInquiry],
      selectedInquiry,
      activeReadState: "unread",
    });

    expect(result.map((inquiry) => inquiry.id)).toEqual(["selected", "remaining"]);
  });

  it("does not duplicate the selected inquiry when it is still in the list", () => {
    const selectedInquiry = createInquiry({ id: "selected" });

    const result = getDisplayedConsultationInquiries({
      inquiries: [selectedInquiry],
      selectedInquiry,
      activeReadState: "unread",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("selected");
  });

  it("does not pin the selected inquiry outside the unread tab", () => {
    const selectedInquiry = createInquiry({ id: "selected" });
    const remainingInquiry = createInquiry({
      id: "remaining",
      motherName: "이순신",
      phone: "010-3333-4444",
    });

    const result = getDisplayedConsultationInquiries({
      inquiries: [remainingInquiry],
      selectedInquiry,
      activeReadState: "read",
    });

    expect(result.map((inquiry) => inquiry.id)).toEqual(["remaining"]);
  });

  it("keeps only the latest inquiry for the same person", () => {
    const olderInquiry = createInquiry({
      id: "older",
      createdAt: "2026-04-22T00:00:00.000Z",
    });
    const newerInquiry = createInquiry({
      id: "newer",
      createdAt: "2026-04-23T00:00:00.000Z",
    });

    const result = getLatestUniqueConsultationInquiries([olderInquiry, newerInquiry]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("newer");
  });

  it("filters inquiries by the same initial-consonant search used by customer autocomplete", () => {
    const songJinho = createInquiry({
      id: "song-jinho",
      motherName: "송진호",
      phone: "010-6621-1878",
      address: "인천광역시 연수구",
    });
    const leeSoonshin = createInquiry({
      id: "lee-soonshin",
      motherName: "이순신",
      phone: "010-3333-4444",
      address: "서울특별시 중구",
    });

    const result = getDisplayedConsultationInquiries({
      inquiries: [songJinho, leeSoonshin],
      selectedInquiry: null,
      activeReadState: "read",
      search: "ㅅㅈㅎ",
    });

    expect(result.map((inquiry) => inquiry.id)).toEqual(["song-jinho"]);
  });

  it("does not pin a selected inquiry that does not match the active search", () => {
    const selectedInquiry = createInquiry({
      id: "selected",
      motherName: "강감찬",
    });
    const matchingInquiry = createInquiry({
      id: "matching",
      motherName: "송진호",
      phone: "010-6621-1878",
    });

    const result = getDisplayedConsultationInquiries({
      inquiries: [matchingInquiry],
      selectedInquiry,
      activeReadState: "unread",
      search: "ㅅㅈㅎ",
    });

    expect(result.map((inquiry) => inquiry.id)).toEqual(["matching"]);
  });
});
