import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { getFeedbackDetail } from "@/lib/api/admin";
import type { FeedbackDetail } from "@/lib/api/admin";
import FeedbackDetailPage from "./page";

const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useParams: () => ({ id: "fb-1" }),
}));
jest.mock("@/lib/api/admin", () => ({
  getFeedbackDetail: jest.fn(),
}));

const mockDetail = jest.mocked(getFeedbackDetail);

const detail = {
  id: "fb-1",
  type: "positive",
  comment: "캐시된 코멘트",
  createdAt: "2026-10-01T03:00:00.000Z",
  user: { id: "u1", name: "김캐시", email: "cache@example.com" },
  message: { id: "m1" },
  session: {
    id: "s1",
    messages: [{ id: "m1", role: "user", content: "질문입니다", timestamp: "2026-10-01T03:00:00.000Z" }],
  },
} as FeedbackDetail;

function httpError(status: number) {
  return Object.assign(new Error(`status ${status}`), { response: { status } });
}

function renderPage(seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seed?.(client);
  return render(
    <QueryClientProvider client={client}>
      <FeedbackDetailPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("FeedbackDetailPage load failure", () => {
  it.each([
    ["a network failure", new Error("Network Error")],
    ["a 500", httpError(500)],
    ["a 403", httpError(403)],
  ])("shows a retryable failure, not 'not found', for %s", async (_label, error) => {
    mockDetail.mockRejectedValue(error);
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("피드백을 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "←" })).toBeInTheDocument();
    expect(screen.queryByText("피드백을 찾을 수 없습니다")).not.toBeInTheDocument();
    expect(screen.queryByText("요청하신 피드백이 존재하지 않거나 삭제되었습니다.")).not.toBeInTheDocument();

    mockDetail.mockResolvedValue(detail);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("피드백 정보")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockDetail).toHaveBeenCalledTimes(2);
  });

  it("goes back to the list from the failure state", async () => {
    mockDetail.mockRejectedValue(new Error("Network Error"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "←" }));
    expect(mockPush).toHaveBeenCalledWith("/admin");
  });

  it("shows 'not found' only for a 404", async () => {
    mockDetail.mockRejectedValue(httpError(404));
    renderPage();

    expect(await screen.findByText("피드백을 찾을 수 없습니다")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "←" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });

  it("treats a paused first load exactly like loading", async () => {
    onlineManager.setOnline(false);
    try {
      mockDetail.mockResolvedValue(detail);
      const { container } = renderPage();

      expect(container.querySelector('[data-component="desktop_admin-feedback_detail_loading"]')).toBeInTheDocument();
      expect(screen.queryByText("피드백을 찾을 수 없습니다")).not.toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(mockDetail).not.toHaveBeenCalled();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("shows the feedback after a successful load", async () => {
    mockDetail.mockResolvedValue(detail);
    renderPage();

    expect(await screen.findByText("피드백 정보")).toBeInTheDocument();
    expect(screen.getByText("질문입니다")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the cached feedback and shows one notice whose retry refetches when a refresh fails", async () => {
    mockDetail.mockRejectedValue(new Error("Network Error"));
    renderPage((client) => client.setQueryData(["feedbackDetail", "fb-1"], detail));

    expect(await screen.findByText("피드백 정보")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByText("질문입니다")).toBeInTheDocument();
    expect(screen.queryByText("피드백을 찾을 수 없습니다")).not.toBeInTheDocument();

    mockDetail.mockResolvedValue(detail);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(mockDetail).toHaveBeenCalledTimes(2);
    expect(screen.getByText("질문입니다")).toBeInTheDocument();
  });

  it("keeps a cached feedback and adds no notice while its refresh is paused", async () => {
    onlineManager.setOnline(false);
    try {
      mockDetail.mockResolvedValue(detail);
      renderPage((client) => client.setQueryData(["feedbackDetail", "fb-1"], detail));

      expect(await screen.findByText("피드백 정보")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("keeps 'not found' and adds one notice whose retry refetches when a refresh fails after a successful empty load", async () => {
    mockDetail.mockRejectedValue(new Error("Network Error"));
    renderPage((client) => client.setQueryData(["feedbackDetail", "fb-1"], null));

    expect(await screen.findByText("피드백을 찾을 수 없습니다")).toBeInTheDocument();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("피드백을 불러오지 못했습니다")).not.toBeInTheDocument();

    mockDetail.mockResolvedValue(detail);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("피드백 정보")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockDetail).toHaveBeenCalledTimes(2);
  });

  it("shows 'not found' with no notice after a successful empty load", async () => {
    mockDetail.mockResolvedValue(null as unknown as FeedbackDetail);
    renderPage();

    expect(await screen.findByText("피드백을 찾을 수 없습니다")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  });
});
