import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { getFeedbackList, getFeedbackStats } from "@/lib/api/admin";
import AdminFeedbackPage from "./page";

jest.mock("@/lib/api/admin", () => ({
    getFeedbackList: jest.fn(),
    getFeedbackStats: jest.fn(),
}));

const mockGetFeedbackList = getFeedbackList as jest.MockedFunction<typeof getFeedbackList>;
const mockGetFeedbackStats = getFeedbackStats as jest.MockedFunction<typeof getFeedbackStats>;

describe("AdminFeedbackPage navigation", () => {
    beforeEach(() => {
        mockGetFeedbackStats.mockResolvedValue({ positive: 1, negative: 0, total: 1 });
        mockGetFeedbackList.mockResolvedValue({
            data: [
                {
                    id: "feedback-1",
                    type: "positive",
                    comment: "QA 피드백 내용",
                    createdAt: "2026-09-18T09:00:00.000Z",
                    user: { id: "user-1", name: "QA 피드백 사용자", email: "qa@example.com" },
                    message: {
                        id: "message-1",
                        content: "질문",
                        role: "user",
                        timestamp: "2026-09-18T08:59:00.000Z",
                    },
                },
            ],
            total: 1,
            page: 1,
            limit: 100,
            totalPages: 1,
        });
    });

    it("exposes each populated feedback row as a named keyboard link", async () => {
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });

        render(
            <QueryClientProvider client={queryClient}>
                <AdminFeedbackPage />
            </QueryClientProvider>,
        );

        const link = await screen.findByRole("link", { name: /QA 피드백 사용자/ });
        expect(link).toHaveAttribute("href", "/admin/feedback/feedback-1");
        link.focus();
        expect(link).toHaveFocus();
    });
});
