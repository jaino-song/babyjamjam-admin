import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { getFeedbackDetail, getFeedbackList, getFeedbackStats } from "@/lib/api/admin";
import type { FeedbackDetail, FeedbackItem } from "@/lib/api/admin";
import AdminFeedbackPage from "./page";

jest.mock("@/lib/api/admin", () => ({
  getFeedbackList: jest.fn(),
  getFeedbackStats: jest.fn(),
  getFeedbackDetail: jest.fn(),
}));

const mockList = jest.mocked(getFeedbackList);
const mockStats = jest.mocked(getFeedbackStats);
const mockDetail = jest.mocked(getFeedbackDetail);

const row: FeedbackItem = {
  id: "fb-1",
  type: "positive",
  comment: "캐시된 코멘트",
  createdAt: "2026-10-01T03:00:00.000Z",
  user: { id: "u1", name: "김캐시", email: "cache@example.com" },
} as FeedbackItem;

function listResponse(rows: FeedbackItem[]) {
  return { data: rows, total: rows.length, page: 1, limit: 100, totalPages: 1 } as Awaited<ReturnType<typeof getFeedbackList>>;
}

function detailResponse(messages: FeedbackDetail["session"]["messages"]): FeedbackDetail {
  return {
    id: "fb-1",
    type: "positive",
    comment: "캐시된 코멘트",
    createdAt: row.createdAt,
    user: row.user,
    message: { id: "m2" },
    session: { id: "s1", messages },
  } as FeedbackDetail;
}

const conversation = [
  { id: "m1", role: "user", content: "질문입니다", timestamp: "2026-10-01T02:59:00.000Z" },
  { id: "m2", role: "user", content: "후속 질문", timestamp: "2026-10-01T03:00:00.000Z" },
] as FeedbackDetail["session"]["messages"];

function statValues(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-slot="stat-mini-value"]'), (node) => node.textContent);
}

function skeletonCount(container: HTMLElement) {
  return container.querySelectorAll('[data-slot="skeleton"]').length;
}

function renderPage(seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  const view = render(
    <QueryClientProvider client={client}>
      <AdminFeedbackPage />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

async function withOffline(run: () => Promise<void>) {
  onlineManager.setOnline(false);
  try {
    await run();
  } finally {
    onlineManager.setOnline(true);
  }
}

beforeEach(() => {
  jest.resetAllMocks();
  mockStats.mockResolvedValue({ total: 3, positive: 2, negative: 1 } as Awaited<ReturnType<typeof getFeedbackStats>>);
});

describe("AdminFeedbackPage list load failure", () => {
  it("shows the failure panel with retry, keeps the filters, and never the empty text", async () => {
    mockList.mockRejectedValue(new Error("network"));
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("피드백을 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "긍정적" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "부정적" })).toBeInTheDocument();
    expect(screen.queryByText("피드백이 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("검색 결과가 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("피드백을 불러오는데 실패했습니다.")).not.toBeInTheDocument();

    mockList.mockResolvedValue(listResponse([row]));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("김캐시")).toBeInTheDocument();
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("treats a paused first load exactly like loading", async () => {
    await withOffline(async () => {
      mockList.mockResolvedValue(listResponse([]));
      const { container } = renderPage();

      expect(skeletonCount(container)).toBeGreaterThan(0);
      expect(screen.queryByText("피드백이 없습니다")).not.toBeInTheDocument();
      expect(screen.queryByText("검색 결과가 없습니다")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(statValues(container)).not.toContain("0");
      expect(mockList).not.toHaveBeenCalled();
    });
  });

  it("shows the empty text and real zero stats after a successful empty load", async () => {
    mockList.mockResolvedValue(listResponse([]));
    mockStats.mockResolvedValue({ total: 0, positive: 0, negative: 0 } as Awaited<ReturnType<typeof getFeedbackStats>>);
    const { container } = renderPage();

    expect(await screen.findByText("피드백이 없습니다")).toBeInTheDocument();
    await waitFor(() => expect(statValues(container)).toEqual(["0", "0", "0"]));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps cached rows and shows one inline notice whose retry refetches the list", async () => {
    mockList.mockRejectedValue(new Error("network"));
    renderPage((client) => client.setQueryData(["feedbackList", 1, "all"], listResponse([row])));

    expect(await screen.findByText("김캐시")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("피드백이 없습니다")).not.toBeInTheDocument();

    mockList.mockResolvedValue(listResponse([row]));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mockList).toHaveBeenCalledTimes(2);
    expect(screen.getByText("김캐시")).toBeInTheDocument();
  });

  it("keeps cached rows and adds no notice while a refetch is paused", async () => {
    await withOffline(async () => {
      mockList.mockResolvedValue(listResponse([row]));
      renderPage((client) => client.setQueryData(["feedbackList", 1, "all"], listResponse([row])));

      expect(await screen.findByText("김캐시")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  it("shows the empty text plus the notice when a cached empty list fails to refresh", async () => {
    mockList.mockRejectedValue(new Error("network"));
    renderPage((client) => client.setQueryData(["feedbackList", 1, "all"], listResponse([])));

    expect(await screen.findByText("피드백이 없습니다")).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });
});

describe("AdminFeedbackPage stats", () => {
  it("shows an em dash, never 0, while the stats failed", async () => {
    mockStats.mockRejectedValue(new Error("network"));
    mockList.mockResolvedValue(listResponse([row]));
    const { container } = renderPage();

    expect(await screen.findByText("김캐시")).toBeInTheDocument();
    await waitFor(() => expect(statValues(container)).toEqual(["—", "—", "—"]));
  });

  it("shows no 0 while the stats are paused", async () => {
    await withOffline(async () => {
      mockList.mockResolvedValue(listResponse([row]));
      const { container } = renderPage();

      expect(statValues(container)).not.toContain("0");
      expect(statValues(container)).not.toContain("—");
      expect(skeletonCount(container)).toBeGreaterThan(0);
    });
  });

  it("shows the real numbers after a successful load", async () => {
    mockList.mockResolvedValue(listResponse([row]));
    const { container } = renderPage();

    await waitFor(() => expect(statValues(container)).toEqual(["3", "2", "1"]));
  });
});

describe("AdminFeedbackPage inline detail", () => {
  async function openDetail() {
    mockList.mockResolvedValue(listResponse([row]));
    const view = renderPage();
    fireEvent.click(await screen.findByText("김캐시"));
    return view;
  }

  it("keeps the feedback card and shows a retryable alert when the conversation fails to load", async () => {
    mockDetail.mockRejectedValue(new Error("network"));
    await openDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("대화 내역을 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("피드백 정보")).toBeInTheDocument();
    // The comment shows in the list row and in the feedback card.
    expect(screen.getAllByText("캐시된 코멘트").length).toBeGreaterThan(1);

    mockDetail.mockResolvedValue(detailResponse(conversation));
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("질문입니다")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockDetail).toHaveBeenCalledTimes(2);
  });

  it("shows the conversation skeleton, not nothing, while the detail load is paused", async () => {
    mockList.mockResolvedValue(listResponse([row]));
    mockDetail.mockResolvedValue(detailResponse(conversation));
    const { container } = renderPage();
    const rowLabel = await screen.findByText("김캐시");
    await withOffline(async () => {
      fireEvent.click(rowLabel);
      expect(await screen.findByText("피드백 정보")).toBeInTheDocument();
      expect(screen.getByText("대화 내역")).toBeInTheDocument();
      expect(container.querySelector('[data-component="desktop_admin_detail-panel_info-card-2_loading-messages"]')).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(mockDetail).not.toHaveBeenCalled();
    });
  });

  it("renders nothing for a successful conversation with no messages", async () => {
    mockDetail.mockResolvedValue(detailResponse([]));
    await openDetail();

    expect(await screen.findByText("피드백 정보")).toBeInTheDocument();
    await waitFor(() => expect(mockDetail).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText("대화 내역")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the cached conversation and shows the notice when a refresh fails", async () => {
    mockDetail.mockRejectedValue(new Error("network"));
    mockList.mockResolvedValue(listResponse([row]));
    renderPage((client) => client.setQueryData(["feedbackDetail", "fb-1"], detailResponse(conversation)));
    fireEvent.click(await screen.findByText("김캐시"));

    expect(await screen.findByText("질문입니다")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("피드백 정보")).toBeInTheDocument();
  });
});
