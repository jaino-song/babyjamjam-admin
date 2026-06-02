import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import NewMessagePage from "../page";

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
});
