import { fireEvent, render, screen } from "@testing-library/react";

import { useDocumentCategories } from "@/hooks/use-document-categories";
import { useDocuments, type Document } from "@/hooks/use-documents";
import { FileStorageScreen } from "./file-storage-screen";

jest.mock("@/hooks/use-documents", () => ({
  useDocuments: jest.fn(),
  getDownloadUrl: (id: string) => `/file-storage/files/${id}/download`,
}));
jest.mock("@/hooks/use-document-categories", () => ({
  useDocumentCategories: jest.fn(),
}));
jest.mock("@/hooks/useAuthenticatedFileUrl", () => ({
  useAuthenticatedFileUrl: () => ({ url: null, isLoading: false, error: null }),
}));

const mockedUseDocuments = jest.mocked(useDocuments);
const mockedUseDocumentCategories = jest.mocked(useDocumentCategories);

const EMPTY_TEXT = "등록된 파일이 없습니다.";
const NO_MATCH_TEXT = "검색 결과가 없습니다.";

function makeDocument(id: string, overrides: Partial<Document> = {}): Document {
  return {
    id,
    name: `계약서 ${id}.pdf`,
    description: null,
    categoryId: "contract",
    categoryLabel: "계약서",
    tags: [],
    mimeType: "application/pdf",
    fileSize: 2048,
    storagePath: `files/${id}`,
    uploadedBy: "관리자",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    visibilityScope: "branch",
    canManage: true,
    ...overrides,
  };
}

type DocumentsQueryState = Record<string, unknown>;

const LOADING: DocumentsQueryState = {
  data: undefined,
  isPending: true,
  isLoading: true,
  isError: false,
  isFetching: true,
  isPaused: false,
  status: "pending",
  fetchStatus: "fetching",
};
const PAUSED: DocumentsQueryState = {
  data: undefined,
  isPending: true,
  isLoading: false,
  isError: false,
  isFetching: false,
  isPaused: true,
  status: "pending",
  fetchStatus: "paused",
};
const FAILED: DocumentsQueryState = {
  data: undefined,
  isPending: false,
  isLoading: false,
  isError: true,
  isFetching: false,
  isPaused: false,
  status: "error",
  fetchStatus: "idle",
};

function mockDocuments(state: DocumentsQueryState, refetch = jest.fn()) {
  mockedUseDocuments.mockReturnValue({
    refetch,
    ...state,
  } as unknown as ReturnType<typeof useDocuments>);
  return refetch;
}

function success(data: Document[], overrides: DocumentsQueryState = {}): DocumentsQueryState {
  return {
    data,
    isPending: false,
    isLoading: false,
    isError: false,
    isFetching: false,
    isPaused: false,
    status: "success",
    fetchStatus: "idle",
    ...overrides,
  };
}

describe("FileStorageScreen documents load states", () => {
  beforeEach(() => {
    class ObserverStub {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    Object.assign(globalThis, {
      IntersectionObserver: ObserverStub,
      ResizeObserver: ObserverStub,
    });
    mockedUseDocumentCategories.mockReturnValue({
      data: [{ id: "contract", label: "계약서" }],
    } as unknown as ReturnType<typeof useDocumentCategories>);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("shows the loading skeleton and unknown counts while the documents load", () => {
    mockDocuments(LOADING);
    render(<FileStorageScreen />);

    expect(screen.getByRole("status", { name: "파일 로딩 중" })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("0개")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("—");
  });

  it("treats a paused first load (offline) exactly like loading", () => {
    mockDocuments(PAUSED);
    render(<FileStorageScreen />);

    expect(screen.getByRole("status", { name: "파일 로딩 중" })).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("0개")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("—");
  });

  it("shows a titled failure with retry, not the empty text or a zero count, when the load failed", () => {
    const refetch = mockDocuments(FAILED);
    render(<FileStorageScreen />);

    expect(screen.getByRole("alert")).toHaveTextContent("파일을 불러오지 못했습니다");
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByText(NO_MATCH_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "파일 로딩 중" })).not.toBeInTheDocument();
    expect(screen.queryByText("0개")).not.toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("—");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the upload action and search bar rendered in every no-data state", () => {
    for (const state of [LOADING, PAUSED, FAILED]) {
      mockDocuments(state);
      const { unmount } = render(<FileStorageScreen />);
      expect(screen.getByRole("link", { name: /업로드/ })).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "파일명, 고객명 검색" })).toBeInTheDocument();
      unmount();
    }
  });

  it("shows the empty text and a real zero count after a successful empty load", () => {
    mockDocuments(success([]));
    render(<FileStorageScreen />);

    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(screen.getByText("0개")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /전체/ })).toHaveTextContent("0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "파일 로딩 중" })).not.toBeInTheDocument();
  });

  it("shows the no-match text only after the documents loaded and the search leaves nothing", () => {
    mockDocuments(success([makeDocument("1")]));
    render(<FileStorageScreen />);

    expect(screen.getByText("계약서 1.pdf")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "파일명, 고객명 검색" }), {
      target: { value: "존재하지않는검색어" },
    });
    expect(screen.getByText(NO_MATCH_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(EMPTY_TEXT)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the rows and shows exactly one inline notice when a refetch fails over cached documents", () => {
    const refetch = mockDocuments(success([makeDocument("1")], { isError: true, status: "error" }));
    render(<FileStorageScreen />);

    expect(screen.getByText("계약서 1.pdf")).toBeInTheDocument();
    expect(screen.getByText("1개")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");

    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("disables the notice retry while the refetch is in flight", () => {
    mockDocuments(success([makeDocument("1")], { isError: true, isFetching: true, status: "error" }));
    render(<FileStorageScreen />);

    expect(screen.getByRole("button", { name: "다시 시도" })).toBeDisabled();
  });

  it("shows the empty text plus the inline notice when a refetch fails over a cached empty list", () => {
    mockDocuments(success([], { isError: true, status: "error" }));
    render(<FileStorageScreen />);

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getByText(EMPTY_TEXT)).toBeInTheDocument();
    expect(screen.getByText("0개")).toBeInTheDocument();
  });

  it("does not change what a paused refetch over cached documents renders", () => {
    mockDocuments(success([makeDocument("1")], { isPaused: true, fetchStatus: "paused" }));
    render(<FileStorageScreen />);

    expect(screen.getByText("계약서 1.pdf")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "파일 로딩 중" })).not.toBeInTheDocument();
  });
});
