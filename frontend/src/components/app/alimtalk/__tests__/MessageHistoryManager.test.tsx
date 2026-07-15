import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MessageHistoryManager } from "../MessageHistoryManager";
import { useMessageHistory } from "@/features/message-triggers/hooks/use-message-triggers";
import type { MessageLogRecord } from "@/features/message-triggers/types";

jest.mock("@/components/app/v3", () => {
  const React = jest.requireActual("react");
  const actual = jest.requireActual("@/components/app/v3");

  return {
    ...actual,
    SplitLayout: ({
      children,
      hasSelection,
      onBack,
      onModeChange,
    }: {
      children: ReactNode;
      hasSelection?: boolean;
      onBack?: () => void;
      onModeChange?: (mode: "desktop" | "compact") => void;
    }) => {
      React.useLayoutEffect(() => {
        onModeChange?.("compact");
      }, [onModeChange]);

      return React.createElement(
        "div",
        {
          "data-component": "split-layout",
          "data-mode": "compact",
          "data-has-selection": hasSelection ? "true" : "false",
        },
        hasSelection
          ? React.createElement(
              "button",
              {
                type: "button",
                onClick: onBack,
              },
              "목록으로 돌아가기",
            )
          : null,
        children,
      );
    },
  };
});

jest.mock("@/features/message-triggers/hooks/use-message-triggers", () => ({
  useMessageHistory: jest.fn(),
}));

const mockedUseMessageHistory = jest.mocked(useMessageHistory);

const historyRecord: MessageLogRecord = {
  id: 101,
  provider: "aligo_alimtalk",
  templateKey: "CLIENT_WELCOME",
  triggerJobId: "job-1",
  receiver: "010-1234-5678",
  clientId: 10,
  recipientPhone: "010-1234-5678",
  messageBody: "안녕하세요. 베이비잼잼입니다.",
  variables: {
    clientName: "김하나",
  },
  status: "sent",
  aligoMid: "mid-1",
  errorMessage: null,
  attempts: 1,
  lastAttemptAt: "2026-06-10T09:00:00.000Z",
  nextRetryAt: null,
  createdAt: "2026-06-10T08:59:00.000Z",
  updatedAt: "2026-06-10T09:00:00.000Z",
  ruleId: "rule-1",
  ruleName: "인사(소개)",
  eventType: "CLIENT_CREATED",
  offsetType: "IMMEDIATE",
  offsetDays: 0,
  scheduledFor: "2026-06-10T09:00:00.000Z",
  recipientType: "CLIENT",
  recipientName: "김하나",
  clientName: "김하나",
  employeeName: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseMessageHistory.mockReturnValue({
    data: [historyRecord],
    isLoading: false,
  } as unknown as ReturnType<typeof useMessageHistory>);
});

describe("MessageHistoryManager", () => {
  it("filters sms delivery records out of the alimtalk history list", () => {
    mockedUseMessageHistory.mockReturnValue({
      data: [
        historyRecord,
        {
          ...historyRecord,
          id: 102,
          provider: "aligo_sms",
          templateKey: "SERVICE_INFO",
          ruleName: "SMS 서비스 안내",
          recipientName: "박문자",
          receiver: "010-9999-0000",
        },
      ],
      isLoading: false,
    } as unknown as ReturnType<typeof useMessageHistory>);

    render(<MessageHistoryManager />);

    expect(screen.getByText("인사(소개)")).toBeInTheDocument();
    expect(screen.queryByText("SMS 서비스 안내")).not.toBeInTheDocument();
  });

  it("does not preselect the first history item in compact split layout", async () => {
    const { container } = render(<MessageHistoryManager />);

    expect(await screen.findByText("인사(소개)")).toBeInTheDocument();
    await waitFor(() => {
      expect(container.querySelector('[data-component="split-layout"]')).toHaveAttribute("data-has-selection", "false");
    });

    expect(container.querySelector('[data-component="alimtalk-history-detail-empty"]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="list-empty-state-copy"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="alimtalk-history-detail"]')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("인사(소개)"));

    await waitFor(() => {
      expect(container.querySelector('[data-component="split-layout"]')).toHaveAttribute("data-has-selection", "true");
    });
    expect(container.querySelector('[data-component="alimtalk-history-detail"]')).toBeInTheDocument();
  });
});
