import { consultationInquiriesApi, type ConsultationInquiry } from "@/services/api";

import { fetchAllConsultationInquiries } from "../useConsultationInquiries";

jest.mock("@/services/api", () => ({
  consultationInquiriesApi: {
    list: jest.fn(),
    markRead: jest.fn(),
  },
}));

const mockList = jest.mocked(consultationInquiriesApi.list);

function inquiry(id: string): ConsultationInquiry {
  return { id } as ConsultationInquiry;
}

describe("fetchAllConsultationInquiries", () => {
  beforeEach(() => {
    mockList.mockReset();
  });

  it("loads every API page so client-side initial-consonant search is complete", async () => {
    mockList
      .mockResolvedValueOnce({
        data: [inquiry("first")],
        total: 2,
        page: 1,
        limit: 100,
        totalPages: 2,
      })
      .mockResolvedValueOnce({
        data: [inquiry("second")],
        total: 2,
        page: 2,
        limit: 100,
        totalPages: 2,
      });

    const result = await fetchAllConsultationInquiries({ readState: "read" });

    expect(mockList).toHaveBeenNthCalledWith(1, {
      readState: "read",
      page: 1,
      limit: 100,
    });
    expect(mockList).toHaveBeenNthCalledWith(2, {
      readState: "read",
      page: 2,
      limit: 100,
    });
    expect(result.data.map((item) => item.id)).toEqual(["first", "second"]);
  });
});
