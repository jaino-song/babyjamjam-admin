import { render, screen } from "@testing-library/react";

import TemplatesPage from "../page";

const mockUseSystemTemplates = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/features/system-templates/hooks", () => ({
  useSystemTemplates: () => mockUseSystemTemplates(),
}));

jest.mock("@/hooks/use-message-templates", () => ({
  useMessageTemplates: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useListInfiniteScroll", () => ({
  useListInfiniteScroll: () => ({
    visibleCount: 20,
    isInitialLoad: false,
    hasMore: false,
    sentinelRef: { current: null },
    scrollContainerRef: { current: null },
    loadMore: jest.fn(),
  }),
}));

describe("TemplatesPage", () => {
  beforeEach(() => {
    mockUseSystemTemplates.mockReturnValue({ data: [], isLoading: false });
  });

  it("uses the shared message section shell without a standalone back header", () => {
    const { container } = render(<TemplatesPage />);

    const messagesShell = container.querySelector<HTMLElement>('[data-slot="messages-page"]');
    const content = container.querySelector<HTMLElement>('[data-slot="messages-content"]');
    const card = container.querySelector<HTMLElement>('[data-component="mobile_messages_templates_page_content_list-card"]');

    expect(messagesShell).toHaveAttribute("data-page", "messages-templates");
    expect(content).toContainElement(card);
    const templatesSectionButton = screen.getByRole("button", { name: "템플릿" });
    expect(templatesSectionButton).toHaveAttribute("aria-pressed", "false");
    expect(templatesSectionButton).toBeDisabled();
    expect(screen.getByText("템플릿 관리")).toHaveClass("list-title-text");
    expect(card).toContainElement(
      container.querySelector('[data-component="mobile_messages_templates_page_content_list-card_filters"]'),
    );
    expect(card).toContainElement(
      container.querySelector('[data-component="mobile_messages_templates_page_content_list-card_body"]'),
    );
    expect(screen.getByRole("link", { name: "+ 새 템플릿" }))
      .toHaveAttribute("href", "/messages/templates/new");
    expect(screen.queryByRole("link", { name: "메시지" })).not.toBeInTheDocument();
  });

  it("omits retired automation-only templates from the mobile list", () => {
    mockUseSystemTemplates.mockReturnValue({
      data: [
        { templateKey: "CLIENT_WELCOME", name: "고객 등록 안내", description: "", updatedAt: "2026-09-01T00:00:00.000Z" },
        { templateKey: "SERVICE_START_REMINDER", name: "서비스 시작 알림", description: "", updatedAt: "2026-09-01T00:00:00.000Z" },
        { templateKey: "SERVICE_END_REMINDER", name: "서비스 종료 알림", description: "", updatedAt: "2026-09-01T00:00:00.000Z" },
        { templateKey: "EMPLOYEE_ASSIGNED", name: "직원 배정 알림", description: "", updatedAt: "2026-09-01T00:00:00.000Z" },
        { templateKey: "GREETING", name: "인사(소개)", description: "소개", updatedAt: "2026-09-01T00:00:00.000Z" },
      ],
      isLoading: false,
    });

    render(<TemplatesPage />);

    expect(screen.queryByText("고객 등록 안내")).not.toBeInTheDocument();
    expect(screen.queryByText("서비스 시작 알림")).not.toBeInTheDocument();
    expect(screen.queryByText("서비스 종료 알림")).not.toBeInTheDocument();
    expect(screen.queryByText("직원 배정 알림")).not.toBeInTheDocument();
    expect(screen.getByText("인사(소개)")).toBeInTheDocument();
  });
});
