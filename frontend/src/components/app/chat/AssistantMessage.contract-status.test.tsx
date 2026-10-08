import { fireEvent, render, screen } from "@testing-library/react";

import { AssistantMessage } from "./AssistantMessage";
import type { ChatMessage } from "@/hooks/useChatStream";

jest.mock("./CodeBlock", () => ({
    CodeBlock: ({ children }: { children: React.ReactNode }) => <pre>{children}</pre>,
}));

let mockWizardResult: Record<string, unknown> = {};

jest.mock("./ContractStatusWizard", () => ({
    __esModule: true,
    default: ({ onCheck }: { onCheck: (result: unknown) => void }) => (
        <button type="button" onClick={() => onCheck(mockWizardResult)}>
            조회하기
        </button>
    ),
}));

function renderResult(result: { documentStatus: string; hasSigned: boolean }) {
    mockWizardResult = {
        clientId: 7,
        clientName: "홍길동",
        serviceStatus: null,
        ...result,
    };
    const message: ChatMessage = {
        role: "assistant",
        content: "",
        timestamp: new Date().toISOString(),
        ui: { type: "contractStatusWizard" },
    };
    render(
        <AssistantMessage
            message={message}
            messageIndex={0}
            sessionId="session-1"
            onSubmitFeedback={jest.fn()}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "조회하기" }));
}

describe("AssistantMessage contract-status result honours hasSigned", () => {
    it("reads requested + hasSigned=true as signed, never 서명 요청됨", () => {
        renderResult({ documentStatus: "requested", hasSigned: true });
        expect(screen.getByText("서명 완료")).toBeInTheDocument();
        expect(screen.queryByText("서명 요청됨")).not.toBeInTheDocument();
        expect(screen.queryByText("requested")).not.toBeInTheDocument();
    });

    it("reads requested + hasSigned=false as 서명 요청됨", () => {
        renderResult({ documentStatus: "requested", hasSigned: false });
        expect(screen.getByText("서명 요청됨")).toBeInTheDocument();
        expect(screen.queryByText("서명 완료")).not.toBeInTheDocument();
    });

    it("keeps a finalized contract as 계약 완료 regardless of the flag", () => {
        renderResult({ documentStatus: "completed", hasSigned: true });
        expect(screen.getByText("계약 완료")).toBeInTheDocument();
    });
});
