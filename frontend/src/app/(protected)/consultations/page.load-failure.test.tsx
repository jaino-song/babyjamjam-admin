import { fireEvent, render, screen, within } from "@testing-library/react";

import { useAllConsultationInquiries, useConsultationInquiries } from "@/hooks/useConsultationInquiries";
import type { ConsultationInquiry, ConsultationInquiryListResponse } from "@/services/api";
import ConsultationsPage from "./page";

jest.mock("@/hooks/useConsultationInquiries", () => ({
  useConsultationInquiries: jest.fn(),
  useAllConsultationInquiries: jest.fn(),
  useMarkConsultationInquiryRead: () => ({ mutate: jest.fn() }),
}));

const inquiry: ConsultationInquiry = {
  id: "1", branchId: "test", publicBranchSlug: "test", motherName: "캐시 상담",
  phone: "01000000000", address: "서울", dueDate: "2026-10-01", birthExperience: "초산",
  voucherType: null, preferredCaregiverName: null, referralSource: "", privacyAcceptedAt: "2026-10-01",
  selectedServices: null, additionalNotes: null, source: "website", status: "contacted", readAt: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

function response(rows: ConsultationInquiry[]): ConsultationInquiryListResponse {
  return { data: rows, total: rows.length, page: 1, limit: 50, totalPages: 1 };
}

const listRefetch = jest.fn();
const searchRefetch = jest.fn();
const statsRefetch = jest.fn();
type QueryState = { data: ConsultationInquiryListResponse | undefined; isError: boolean; isLoading: boolean; isFetching: boolean; refetch: typeof listRefetch };
let list: QueryState;
let search: QueryState;
let stats: QueryState;

function statValues(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]'), (node) => node.textContent);
}

function enterSearch() {
  fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
  fireEvent.change(screen.getByRole("textbox", { name: "검색어" }), { target: { value: "캐시" } });
}

beforeEach(() => {
  jest.clearAllMocks();
  list = { data: undefined, isError: true, isLoading: false, isFetching: false, refetch: listRefetch };
  search = { ...list, refetch: searchRefetch };
  stats = { ...list, refetch: statsRefetch };
  // Query boundaries are mocked, not the page's real list, stats or failure components.
  jest.mocked(useConsultationInquiries).mockImplementation((params) =>
    (params.readState === "all" ? stats : list) as unknown as ReturnType<typeof useConsultationInquiries>);
  jest.mocked(useAllConsultationInquiries).mockImplementation(() => search as unknown as ReturnType<typeof useAllConsultationInquiries>);
});

describe("ConsultationsPage load failure", () => {
  it.each([false, true])("shows an actionable panel, not empty or zero, for failed search=%s", (searching) => {
    const { container } = render(<ConsultationsPage />);
    if (searching) enterSearch();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-size", "panel");
    expect(alert).toHaveTextContent("불러오지 못했습니다");
    expect(alert).toHaveClass("pointer-events-auto");
    expect(screen.queryByText("상담 문의가 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("검색 결과가 없습니다")).not.toBeInTheDocument();
    expect(statValues(container)).toEqual(["—", "—", "—", "—"]);
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(searching ? searchRefetch : listRefetch).toHaveBeenCalledTimes(1);
    expect(searching ? listRefetch : searchRefetch).not.toHaveBeenCalled();
  });

  it.each([false, true])("shows successful empty search=%s with real zeroes and no alert", (searching) => {
    list = { ...list, data: response([]), isError: false };
    search = { ...search, data: response([]), isError: false };
    stats = { ...stats, data: response([]), isError: false };
    const { container } = render(<ConsultationsPage />);
    if (searching) enterSearch();
    expect(screen.getByText(searching ? "검색 결과가 없습니다" : "상담 문의가 없습니다")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(statValues(container)).toEqual(["0", "0", "0", "0"]);
  });

  it.each([false, true])("keeps cached search=%s rows and stats with one notice and in-flight retry disabled", (searching) => {
    list = { ...list, data: response([inquiry]), isError: false };
    search = { ...search, data: response([inquiry]), isError: false };
    stats = { ...stats, data: response([inquiry]), isError: false };
    const { container, rerender } = render(<ConsultationsPage />);
    if (searching) enterSearch();
    list = { ...list, isError: true };
    search = { ...search, isError: true };
    stats = { ...stats, isError: true };
    rerender(<ConsultationsPage />);
    const alert = screen.getByRole("alert");
    const row = screen.getByText("캐시 상담");
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(alert.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row).toBeVisible();
    expect(statValues(container)).toEqual(["1", "1", "1", "0"]);
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(searching ? searchRefetch : listRefetch).toHaveBeenCalledTimes(1);
    list = { ...list, isFetching: true };
    search = { ...search, isFetching: true };
    rerender(<ConsultationsPage />);
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(screen.getByText("캐시 상담")).toBeVisible();
  });

  it("preserves a cached empty response on failed refetch with an inline notice", () => {
    list = { ...list, data: response([]) };
    stats = { ...stats, data: response([]) };
    const { container } = render(<ConsultationsPage />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    expect(screen.getByText("상담 문의가 없습니다")).toBeVisible();
    expect(statValues(container)).toEqual(["0", "0", "0", "0"]);
  });

  it("keeps stats unknown independently when the list succeeded", () => {
    list = { ...list, data: response([]), isError: false };
    const { container } = render(<ConsultationsPage />);
    expect(screen.getByText("상담 문의가 없습니다")).toBeVisible();
    expect(statValues(container)).toEqual(["—", "—", "—", "—"]);
  });

  it("keeps a selected row when a later query has no response and fails", () => {
    list = { ...list, data: response([inquiry]), isError: false };
    stats = { ...stats, data: response([inquiry]), isError: false };
    const { rerender } = render(<ConsultationsPage />);
    fireEvent.click(screen.getByRole("button", { name: /캐시 상담/ }));
    list = { ...list, data: undefined, isError: true };
    rerender(<ConsultationsPage />);
    expect(screen.getByRole("alert")).toHaveAttribute("data-size", "inline");
    expect(screen.getByRole("button", { name: /캐시 상담/ })).toBeVisible();
    expect(screen.queryByText("상담 문의가 없습니다")).not.toBeInTheDocument();
  });

  it("keeps existing loading skeletons during a no-data retry", () => {
    list = { ...list, isError: false, isLoading: true, isFetching: true };
    const { container } = render(<ConsultationsPage />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("상담 문의가 없습니다")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });
});
