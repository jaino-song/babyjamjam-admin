import { fireEvent, render, screen } from "@testing-library/react";

import { MessagesTriggersPage } from "../MessagesTriggersPage";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockSearchParams = new URLSearchParams();
let mockRules: Array<{
  id: string;
  branchId: string | null;
  name: string;
  isActive: boolean;
  eventType: "SERVICE_START";
  offsetType: "BEFORE_DAYS";
  offsetDays: number;
  recipientType: "CLIENT";
  templateKey: "SERVICE_INFO";
  createdAt: string;
  updatedAt: string;
}> = [];

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerRules: () => ({
    data: mockRules,
    isError: false,
    isLoading: false,
  }),
}));

jest.mock("@/components/app/mobile-redesign/ClientRegistrationPolicySettings", () => ({
  ClientRegistrationPolicySettings: () => <div data-testid="client-registration-policy" />,
}));

jest.mock("@/components/app/mobile-redesign/MessageTriggerList", () => ({
  MessageTriggerList: ({
    onCreate,
    onEdit,
  }: {
    onCreate?: () => void;
    onEdit?: (rule: (typeof mockRules)[number]) => void;
  }) => (
    <div data-testid="message-trigger-list">
      <button type="button" onClick={onCreate}>+ 규칙</button>
      {mockRules[0] ? (
        <button type="button" onClick={() => onEdit?.(mockRules[0])}>규칙 편집 열기</button>
      ) : null}
    </div>
  ),
}));

jest.mock("@/components/app/mobile-redesign/MessageTriggerEditor", () => ({
  MessageTriggerEditor: ({ "data-component": dataComponent }: { "data-component": string }) => (
    <div data-component={dataComponent}>규칙 편집 화면</div>
  ),
}));

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class ResizeObserverMock {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
});

describe("MessagesTriggersPage", () => {
  beforeEach(() => {
    mockSearchParams = new URLSearchParams();
    mockRules = [];
    mockPush.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
  });

  it("uses the shared sliding card and list pane for mobile automation", () => {
    const { container } = render(<MessagesTriggersPage />);

    const content = container.querySelector<HTMLElement>('[data-slot="messages-content"]');
    const navigation = screen.getByRole("navigation", { name: "메시지 기능" });

    expect(content?.firstElementChild).toBe(navigation);
    expect(container.querySelector('[data-source-component="SlidingCard"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="mobile_messages_automation_page_screen_content_sliding-card_stage_list-pane"]'))
      .toContainElement(screen.getByTestId("message-trigger-list"));
  });

  it("routes creation into the shared sliding detail pane", () => {
    const view = render(<MessagesTriggersPage />);

    fireEvent.click(screen.getByRole("button", { name: "+ 규칙" }));
    expect(mockPush).toHaveBeenCalledWith("?item=new", { scroll: false });

    mockSearchParams = new URLSearchParams({ item: "new" });
    view.rerender(<MessagesTriggersPage />);

    expect(screen.getByText("규칙 편집 화면")).toBeInTheDocument();
    expect(screen.getByText("규칙 편집 화면"))
      .toHaveAttribute("data-component", "mobile_messages_automation_page_screen_content_sliding-card_stage_detail-pane_body_new-rule_editor");
  });

  it("routes a selected rule into its detail and returns with history", () => {
    mockRules = [{
      id: "rule-1",
      branchId: "branch-1",
      name: "서비스 시작 안내",
      isActive: true,
      eventType: "SERVICE_START",
      offsetType: "BEFORE_DAYS",
      offsetDays: 7,
      recipientType: "CLIENT",
      templateKey: "SERVICE_INFO",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    }];
    const view = render(<MessagesTriggersPage />);

    fireEvent.click(screen.getByRole("button", { name: "규칙 편집 열기" }));
    expect(mockPush).toHaveBeenCalledWith("?item=rule-1", { scroll: false });

    mockSearchParams = new URLSearchParams({ item: "rule-1" });
    view.rerender(<MessagesTriggersPage />);
    fireEvent.click(screen.getByRole("button", { name: "자동 전송 목록으로 돌아가기" }));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
