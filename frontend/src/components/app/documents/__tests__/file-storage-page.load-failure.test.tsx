import { act, fireEvent, render, screen, within } from "@testing-library/react";

import { FileStoragePage } from "../file-storage-page";
import type { Document } from "@/hooks/use-documents";
import type { DocumentCategory } from "@/hooks/use-document-categories";

jest.mock("next/dynamic", () => ({ __esModule: true, default: () => () => null }));
jest.mock("@/hooks/use-documents", () => ({
  useDocuments: () => mockDocuments,
  useDocumentUploadCapabilities: () => ({ data: undefined, isPending: false, isError: false, refetch: jest.fn() }),
  useUploadDocument: () => ({ isPending: false }),
  useUpdateDocument: () => ({ isPending: false }),
  useDeleteDocument: () => ({ isPending: false }),
}));
jest.mock("@/hooks/use-document-categories", () => ({
  useDocumentCategories: () => mockCategories,
  useCreateDocumentCategory: () => ({ isPending: false }),
}));

function query<T>(data: T | undefined) {
  return {
    data, isLoading: false, isPending: false, isError: false,
    isFetching: false, isPaused: false, error: null as Error | null,
    status: "success", fetchStatus: "idle", refetch: jest.fn(),
  };
}

const failed = { isError: true, status: "error", error: new Error("load failed") };
const paused = {
  isPending: true, isLoading: false, isError: false, isFetching: false,
  isPaused: true, status: "pending", fetchStatus: "paused",
};
const loading = { isPending: true, isLoading: true, isFetching: true, status: "pending", fetchStatus: "fetching" };
const document: Document = {
  id: "doc-1", name: "업무 안내", categoryId: "guide", tags: [],
  mimeType: "application/pdf", fileSize: 100, storagePath: "guide.pdf",
  uploadedBy: "staff", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  visibilityScope: "branch", canManage: false,
};
let mockDocuments = query<Document[]>([]);
let mockCategories = query<DocumentCategory[]>([]);

function statValues(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]'), node => node.textContent);
}

function expectNoEmptyText() {
  expect(screen.queryByText("등록된 문서가 없습니다")).not.toBeInTheDocument();
  expect(screen.queryByText("검색 결과가 없습니다")).not.toBeInTheDocument();
}

async function renderPage() {
  const result = render(<FileStoragePage />);
  // Flush the real edit modal's queued state reset, even while it is closed.
  await act(async () => { await Promise.resolve(); });
  return result;
}

describe("FileStoragePage query load states", () => {
  beforeEach(() => {
    mockDocuments = query<Document[]>([]);
    mockCategories = query<DocumentCategory[]>([]);
  });

  it("keeps chrome and retries the no-data failure inside the clickable list overlay", async () => {
    mockDocuments = { ...query<Document[]>(undefined), ...failed };
    mockCategories = { ...query<DocumentCategory[]>(undefined), ...failed };
    const { container, rerender } = await renderPage();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-size", "panel");
    expect(alert).toHaveClass("pointer-events-auto");
    expect(within(alert).getByText("문서를 불러오지 못했습니다")).toBeInTheDocument();
    expect(screen.getByText("파일 목록")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "업로드" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "검색 열기" })).toBeInTheDocument();
    expectNoEmptyText();
    expect(statValues(container)).toEqual(["—", "—"]);
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(mockDocuments.refetch).toHaveBeenCalledTimes(1);
    expect(mockCategories.refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
    fireEvent.change(screen.getByPlaceholderText("문서명, 설명, 태그 검색..."), { target: { value: "불일치" } });
    expectNoEmptyText();
    mockDocuments = { ...query<Document[]>(undefined), ...loading };
    rerender(<FileStoragePage />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expectNoEmptyText();
    expect(container.querySelector('[data-component="files-detail-skeleton"]')).toBeInTheDocument();
  });

  it.each([ ["loading", loading], ["paused", paused] ])("uses list and detail skeletons with unknown stats while %s", async (_name, state) => {
    mockDocuments = { ...query<Document[]>(undefined), ...state };
    mockCategories = { ...query<DocumentCategory[]>(undefined), ...state };
    const { container } = await renderPage();
    expectNoEmptyText();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(statValues(container)).toEqual(["—", "—"]);
    const list = container.querySelector('[data-slot="animated-slot-list"]');
    expect(list?.children).toHaveLength(4);
    expect(list?.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(8);
    expect(container.querySelector('[data-component="files-detail-skeleton"]')).toBeInTheDocument();
  });

  it("shows the existing empty text and real zeros after successful empty loads", async () => {
    const { container } = await renderPage();
    expect(screen.getByText("등록된 문서가 없습니다")).toBeInTheDocument();
    expect(statValues(container)).toEqual(["0", "0"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the existing search empty text only after a loaded list has no match", async () => {
    mockDocuments = query([document]);
    await renderPage();
    expect(screen.getByText(document.name)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
    fireEvent.change(screen.getByPlaceholderText("문서명, 설명, 태그 검색..."), { target: { value: "불일치" } });
    expect(screen.getByText("검색 결과가 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each([ ["rows", [document]], ["empty list", []] ])("keeps cached %s and one inline notice after a failed refetch", async (_name, data) => {
    mockDocuments = { ...query(data), ...failed };
    const { container, rerender } = await renderPage();
    const alert = screen.getByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(alert).toHaveAttribute("data-size", "inline");
    expect(within(alert).getByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();
    expect(statValues(container)).toEqual([String(data.length), "0"]);
    if (data.length) {
      const row = screen.getByText(document.name);
      expect(alert.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    } else {
      expect(screen.getByText("등록된 문서가 없습니다")).toBeInTheDocument();
    }
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    expect(mockDocuments.refetch).toHaveBeenCalledTimes(1);
    mockDocuments = { ...mockDocuments, isFetching: true, fetchStatus: "fetching" };
    rerender(<FileStoragePage />);
    expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
    expect(statValues(container)[0]).toBe(String(data.length));
  });

  it("does not replace cached rows with skeletons during a paused refetch", async () => {
    mockDocuments = { ...query([document]), isPaused: true, fetchStatus: "paused" };
    const { container } = await renderPage();
    expect(screen.getByText(document.name)).toBeInTheDocument();
    expect(statValues(container)).toEqual(["1", "0"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="files-detail-skeleton"]')).not.toBeInTheDocument();
  });

  it("keeps the existing disabled-query empty presentation, not loading or failure", async () => {
    mockDocuments = { ...query<Document[]>(undefined), isPending: true, status: "pending" };
    const { container } = await renderPage();
    expect(screen.getByText("등록된 문서가 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="files-detail-skeleton"]')).not.toBeInTheDocument();
  });

  it.each([ ["failed", failed], ["paused", paused], ["loading", loading] ])("shows unknown categories without gating loaded documents when categories are %s", async (_name, state) => {
    mockDocuments = query([document]);
    mockCategories = { ...query<DocumentCategory[]>(undefined), ...state };
    const { container } = await renderPage();
    expect(screen.getByText(document.name)).toBeInTheDocument();
    expect(statValues(container)).toEqual(["1", "—"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the cached category count after a failed category refetch", async () => {
    mockCategories = { ...query<DocumentCategory[]>([{ id: "guide", value: "guide", label: "안내", color: "primary", isCustom: false, createdAt: document.createdAt }]), ...failed };
    const { container } = await renderPage();
    expect(statValues(container)).toEqual(["0", "1"]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
