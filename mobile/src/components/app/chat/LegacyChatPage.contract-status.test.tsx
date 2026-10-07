import { fireEvent, render, screen } from "@testing-library/react";

import { LegacyChatPage } from "./LegacyChatPage";

let mockWizardResult: Record<string, unknown> = {};

jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("remark-gfm", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@/components/app/chat/CodeBlock", () => ({
  CodeBlock: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));

jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => ({ name: "테스트 사용자", branchName: "테스트 지점" }),
}));

jest.mock("@/components/app/chat/ContractStatusWizard", () => ({
  __esModule: true,
  default: ({ onCheck }: { onCheck: (result: unknown) => void }) => (
    <button type="button" onClick={() => onCheck(mockWizardResult)}>
      조회하기
    </button>
  ),
}));

jest.mock("@/hooks/useChatStream", () => ({
  useChatStream: () => ({
    messages: [
      {
        role: "assistant",
        content: "",
        timestamp: "2026-10-07T00:00:00.000Z",
        ui: { type: "contractStatusWizard" },
      },
    ],
    state: "idle",
    sendMessage: jest.fn(),
    clearSession: jest.fn(),
    isToolExecuting: false,
    currentTool: null,
    loadHistory: jest.fn(),
    isLoadingHistory: false,
    hasMoreHistory: false,
  }),
}));

function check(result: { documentStatus: string; hasSigned: boolean }) {
  mockWizardResult = { clientId: 7, clientName: "홍길동", serviceStatus: null, ...result };
  render(<LegacyChatPage />);
  fireEvent.click(screen.getByRole("button", { name: "조회하기" }));
}

describe("LegacyChatPage contract-status result honours hasSigned", () => {
  beforeAll(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: jest.fn(),
    });
  });

  it("reads requested + hasSigned=true as signed, never 서명 요청됨", () => {
    check({ documentStatus: "requested", hasSigned: true });
    expect(screen.getByText("서명 완료")).toBeInTheDocument();
    expect(screen.queryByText("서명 요청됨")).not.toBeInTheDocument();
    expect(screen.queryByText("requested")).not.toBeInTheDocument();
  });

  it("reads requested + hasSigned=false as 서명 요청됨", () => {
    check({ documentStatus: "requested", hasSigned: false });
    expect(screen.getByText("서명 요청됨")).toBeInTheDocument();
    expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
  });
});
