import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { callIngestTokenApi } from "@/services/api";

import { CallIngestTokenSection } from "./CallIngestTokenSection";

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

jest.mock("@/services/api", () => ({
  callIngestTokenApi: {
    list: jest.fn(),
    create: jest.fn(),
    revoke: jest.fn(),
  },
}));

const mockedList = callIngestTokenApi.list as jest.Mock;
const mockedRevoke = callIngestTokenApi.revoke as jest.Mock;

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    ...render(
      <QueryClientProvider client={queryClient}>
        <CallIngestTokenSection branchId="branch-1" />
      </QueryClientProvider>,
    ),
    queryClient,
  };
}

const TOKENS_QUERY_KEY = ["settings", "call-ingest-tokens", "branch-1"] as const;
const SKELETON = '[data-component="desktop_settings_sections_call-ingest-tokens_content_skeleton"]';

describe("CallIngestTokenSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders the token list with label, issue date, and status", async () => {
    mockedList.mockResolvedValue([
      { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
      { id: "tok-2", label: "구 토큰", active: false, createdAt: "2026-02-02T00:00:00.000Z" },
    ]);

    renderSection();

    expect(await screen.findByText("인천본점 n8n")).toBeInTheDocument();
    expect(screen.getByText("구 토큰")).toBeInTheDocument();
    expect(screen.getByText("사용 중")).toBeInTheDocument();
    expect(screen.getByText("취소됨")).toBeInTheDocument();
    expect(mockedList).toHaveBeenCalledWith("branch-1");
  });

  it("shows an empty state when the branch has no tokens", async () => {
    mockedList.mockResolvedValue([]);

    renderSection();

    expect(await screen.findByText("발급된 토큰이 없습니다.")).toBeInTheDocument();
  });

  it("revoke confirm calls the API with the target token id", async () => {
    mockedList.mockResolvedValue([
      { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);
    mockedRevoke.mockResolvedValue(undefined);

    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "취소" }));

    const approveButton = await screen.findByRole("button", { name: "토큰 취소" });
    fireEvent.click(approveButton);

    await waitFor(() => {
      expect(mockedRevoke).toHaveBeenCalledWith("tok-1");
    });
  });

  it("does not call revoke when the confirm dialog is dismissed", async () => {
    mockedList.mockResolvedValue([
      { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
    ]);

    renderSection();

    fireEvent.click(await screen.findByRole("button", { name: "취소" }));
    fireEvent.click(await screen.findByRole("button", { name: "닫기" }));

    expect(mockedRevoke).not.toHaveBeenCalled();
  });

  describe("unknown load states (rule S5)", () => {
    it("failed with no data: titled failure with retry, no empty text; retry calls the API again", async () => {
      mockedList.mockRejectedValueOnce(new Error("boom"));
      mockedList.mockResolvedValueOnce([
        { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
      ]);

      renderSection();

      expect(await screen.findByText("토큰 목록을 불러오지 못했습니다.")).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.queryByText("발급된 토큰이 없습니다.")).not.toBeInTheDocument();
      expect(mockedList).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

      expect(await screen.findByText("인천본점 n8n")).toBeInTheDocument();
      expect(mockedList).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("paused with no data: shows the skeleton, not the empty text or an alert", async () => {
      onlineManager.setOnline(false);
      try {
        const { container } = renderSection();

        await waitFor(() => {
          expect(container.querySelector(SKELETON)).not.toBeNull();
        });
        expect(screen.queryByText("발급된 토큰이 없습니다.")).not.toBeInTheDocument();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(mockedList).not.toHaveBeenCalled();
      } finally {
        onlineManager.setOnline(true);
      }
    });

    it("paused refetch over cached rows: rows stay, no skeleton, no alert", async () => {
      mockedList.mockResolvedValue([
        { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
      ]);
      const { container, queryClient } = renderSection();
      await screen.findByText("인천본점 n8n");

      onlineManager.setOnline(false);
      try {
        act(() => {
          void queryClient.invalidateQueries({ queryKey: TOKENS_QUERY_KEY });
        });
        await waitFor(() => {
          expect(queryClient.getQueryState(TOKENS_QUERY_KEY)?.fetchStatus).toBe("paused");
        });

        expect(screen.getByText("인천본점 n8n")).toBeInTheDocument();
        expect(container.querySelector(SKELETON)).toBeNull();
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
        expect(mockedList).toHaveBeenCalledTimes(1);
      } finally {
        onlineManager.setOnline(true);
      }
    });

    it("successful empty load: empty text and no alert", async () => {
      mockedList.mockResolvedValue([]);

      const { container } = renderSection();

      expect(await screen.findByText("발급된 토큰이 없습니다.")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(container.querySelector(SKELETON)).toBeNull();
    });

    it("cached rows + failed refetch: rows stay with exactly one notice whose retry refetches", async () => {
      mockedList.mockResolvedValueOnce([
        { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
      ]);
      const { queryClient } = renderSection();
      await screen.findByText("인천본점 n8n");

      mockedList.mockRejectedValueOnce(new Error("boom"));
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: TOKENS_QUERY_KEY });
      });

      expect(await screen.findByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByText("인천본점 n8n")).toBeInTheDocument();
      expect(screen.queryByText("토큰 목록을 불러오지 못했습니다.")).not.toBeInTheDocument();

      mockedList.mockResolvedValueOnce([
        { id: "tok-1", label: "인천본점 n8n", active: true, createdAt: "2026-01-01T00:00:00.000Z" },
      ]);
      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(mockedList).toHaveBeenCalledTimes(3);
      expect(screen.getByText("인천본점 n8n")).toBeInTheDocument();
    });

    it("cached empty list + failed refetch: empty text plus the notice, not the no-data failure", async () => {
      mockedList.mockResolvedValueOnce([]);
      const { queryClient } = renderSection();
      await screen.findByText("발급된 토큰이 없습니다.");

      mockedList.mockRejectedValueOnce(new Error("boom"));
      await act(async () => {
        await queryClient.refetchQueries({ queryKey: TOKENS_QUERY_KEY });
      });

      expect(await screen.findByText("최신 정보를 불러오지 못했습니다")).toBeInTheDocument();
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.getByText("발급된 토큰이 없습니다.")).toBeInTheDocument();
    });
  });
});
