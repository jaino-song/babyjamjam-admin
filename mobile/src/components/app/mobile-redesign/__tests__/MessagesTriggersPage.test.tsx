import { fireEvent, render, screen } from "@testing-library/react";

import { MessagesTriggersPage } from "../MessagesTriggersPage";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockSearchParams = new URLSearchParams();
type MockRule = {
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
};

let mockRules: MockRule[] = [];
let mockRulesQuery: {
  data?: MockRule[];
  isError: boolean;
  isLoading: boolean;
  isFetching: boolean;
};

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: mockBack }),
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: jest.fn(),
}));

const mockUseGetAuthUser = useGetAuthUser as jest.Mock;

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageTriggerRules: () => ({
    data: mockRulesQuery.data ?? mockRules,
    isError: mockRulesQuery.isError,
    isLoading: mockRulesQuery.isLoading,
    isFetching: mockRulesQuery.isFetching,
  }),
}));

jest.mock("@/components/app/mobile-redesign/ClientRegistrationPolicySettings", () => ({
  ClientRegistrationPolicySettings: () => <div data-testid="client-registration-policy" />,
}));

jest.mock("@/components/app/mobile-redesign/MessageTriggerList", () => ({
  MessageTriggerList: ({
    canManage,
    onCreate,
    onEdit,
  }: {
    canManage: boolean;
    onCreate?: () => void;
    onEdit?: (rule: MockRule) => void;
  }) => (
    <div data-testid="message-trigger-list">
      {canManage ? <button type="button" onClick={onCreate}>+ 규칙</button> : null}
      {canManage && mockRules[0] ? (
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
    mockRulesQuery = {
      data: undefined,
      isError: false,
      isLoading: false,
      isFetching: false,
    };
    mockPush.mockReset();
    mockReplace.mockReset();
    mockBack.mockReset();
    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
  });

  const createRule = (id = "rule-1"): MockRule => ({
    id,
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
  });

  const expectListVisible = (container: HTMLElement) => {
    const listPane = container.querySelector('[data-slot="list-pane"]');
    const detailPane = container.querySelector('[data-slot="detail-pane"]');

    expect(listPane).toHaveAttribute("aria-hidden", "false");
    expect(listPane).not.toHaveAttribute("inert");
    expect(detailPane).toHaveAttribute("aria-hidden", "true");
    expect(detailPane).toHaveAttribute("inert");
  };

  const expectDetailVisible = (container: HTMLElement) => {
    const listPane = container.querySelector('[data-slot="list-pane"]');
    const detailPane = container.querySelector('[data-slot="detail-pane"]');

    expect(listPane).toHaveAttribute("aria-hidden", "true");
    expect(listPane).toHaveAttribute("inert");
    expect(detailPane).toHaveAttribute("aria-hidden", "false");
    expect(detailPane).not.toHaveAttribute("inert");
  };

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
    expectDetailVisible(view.container);
  });

  it("routes a selected rule into its detail and returns with history", () => {
    mockRules = [createRule()];
    const view = render(<MessagesTriggersPage />);

    fireEvent.click(screen.getByRole("button", { name: "규칙 편집 열기" }));
    expect(mockPush).toHaveBeenCalledWith("?item=rule-1", { scroll: false });

    mockSearchParams = new URLSearchParams({ item: "rule-1" });
    view.rerender(<MessagesTriggersPage />);
    expectDetailVisible(view.container);
    fireEvent.click(screen.getByRole("button", { name: "자동 전송 목록으로 돌아가기" }));

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it.each(["new", "rule-1"])(
    "keeps the list usable and removes a denied %s deep link",
    (item) => {
      mockRules = item === "new" ? [] : [createRule()];
      mockSearchParams = new URLSearchParams({ item });
      mockUseGetAuthUser.mockReturnValue({
        data: { role: "user", branchRole: "user" },
        isPending: false,
        isLoading: false,
        isFetching: false,
        isError: false,
      });

      const { container } = render(<MessagesTriggersPage />);

      expectListVisible(container);
      expect(screen.queryByText("규칙 편집 화면")).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ 규칙" })).not.toBeInTheDocument();
      expect(mockReplace).toHaveBeenCalledWith("/messages/automation", { scroll: false });
    },
  );

  it.each([
    ["pending", { data: undefined, isPending: true, isLoading: true, isFetching: true, isError: false }],
    ["loading", { data: undefined, isPending: false, isLoading: true, isFetching: true, isError: false }],
    ["error", { data: null, isPending: false, isLoading: false, isFetching: false, isError: true }],
  ])("keeps a deep link closed without clearing it while authority is %s", (_label, query) => {
    mockRules = [createRule()];
    mockSearchParams = new URLSearchParams({ item: "rule-1" });
    mockUseGetAuthUser.mockReturnValue(query);

    const { container, rerender } = render(<MessagesTriggersPage />);

    expectListVisible(container);
    expect(mockReplace).not.toHaveBeenCalled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    rerender(<MessagesTriggersPage />);

    expectDetailVisible(container);
    expect(screen.getByText("규칙 편집 화면")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("keeps an authorized detail open during refetch and closes it after demotion", () => {
    mockRules = [createRule()];
    mockSearchParams = new URLSearchParams({ item: "rule-1" });
    const view = render(<MessagesTriggersPage />);
    expectDetailVisible(view.container);

    mockReplace.mockReset();
    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: true,
      isError: false,
    });
    view.rerender(<MessagesTriggersPage />);

    expectDetailVisible(view.container);
    expect(mockReplace).not.toHaveBeenCalled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: true,
    });
    view.rerender(<MessagesTriggersPage />);

    expectListVisible(view.container);
    expect(mockReplace).not.toHaveBeenCalled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    view.rerender(<MessagesTriggersPage />);
    expectDetailVisible(view.container);

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "user" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    view.rerender(<MessagesTriggersPage />);

    expectListVisible(view.container);
    expect(mockReplace).toHaveBeenCalledWith("/messages/automation", { scroll: false });
  });

  it("waits for a rule refetch before removing an invalid manager deep link", () => {
    mockSearchParams = new URLSearchParams({ item: "missing-rule" });
    mockRulesQuery = {
      data: [],
      isError: false,
      isLoading: false,
      isFetching: true,
    };

    const view = render(<MessagesTriggersPage />);

    expectListVisible(view.container);
    expect(mockReplace).not.toHaveBeenCalled();

    mockRulesQuery = {
      data: [],
      isError: false,
      isLoading: false,
      isFetching: false,
    };
    view.rerender(<MessagesTriggersPage />);

    expect(mockReplace).toHaveBeenCalledWith("/messages/automation", { scroll: false });
  });

  it("fails closed when a manager refetch keeps stale data with an error", () => {
    mockRules = [createRule()];
    mockSearchParams = new URLSearchParams({ item: "rule-1" });
    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: true,
      isError: true,
    });

    const view = render(<MessagesTriggersPage />);

    expectListVisible(view.container);
    expect(mockReplace).not.toHaveBeenCalled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    view.rerender(<MessagesTriggersPage />);

    expectDetailVisible(view.container);
    expect(mockReplace).not.toHaveBeenCalled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "user" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    view.rerender(<MessagesTriggersPage />);

    expectListVisible(view.container);
    expect(mockReplace).toHaveBeenCalledWith("/messages/automation", { scroll: false });
  });
});
