import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import NewMessagePage from "../page";
import { api } from "@/lib/api/client";

const mockBack = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ back: mockBack }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [] }),
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    post: jest.fn(),
  },
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <NewMessagePage />
    </QueryClientProvider>,
  );
}

describe("NewMessagePage", () => {
  beforeEach(() => {
    mockBack.mockClear();
    (api.post as jest.Mock).mockReset();
    (api.post as jest.Mock).mockResolvedValue({ data: { result: "ok" } });
    mockSearchParams = new URLSearchParams();
  });

  it("refreshes route-provided message body when search params change in place", () => {
    mockSearchParams = new URLSearchParams({
      body: "첫 번째 템플릿 본문",
      template: "service-start-d-1",
    });

    const { rerender } = renderPage();
    expect(screen.getByLabelText("메시지 본문")).toHaveValue("첫 번째 템플릿 본문");

    mockSearchParams = new URLSearchParams({
      body: "두 번째 템플릿 본문",
      template: "visit-change",
    });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <NewMessagePage />
      </QueryClientProvider>,
    );

    expect(screen.getByLabelText("메시지 본문")).toHaveValue("두 번째 템플릿 본문");
  });

  it("submits the selected SMS channel in the delivery payload", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "SMS" }));
    fireEvent.click(screen.getByRole("button", { name: "2명에게 발송" }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        "/message-deliveries/sms",
        expect.objectContaining({
          channel: "sms",
          msgType: "SMS",
          receiver: "010-1234-5678,010-2345-6789",
        }),
      );
    });
  });

  it("blocks submissions with more than 50 recipients", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "박서연 수신자 제거" }));
    fireEvent.click(screen.getByRole("button", { name: "김도윤 수신자 제거" }));

    const tooManyRecipients = Array.from({ length: 51 }, (_, index) => (
      `010-0000-${String(index + 1).padStart(4, "0")}`
    )).join(",");

    const receiverInput = screen.getByLabelText(/수신자/);
    fireEvent.change(receiverInput, { target: { value: tooManyRecipients } });
    fireEvent.blur(receiverInput);
    fireEvent.click(screen.getByRole("button", { name: "51명에게 발송" }));

    expect(await screen.findByText("수신자는 한 번에 최대 50명까지 선택할 수 있습니다.")).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
