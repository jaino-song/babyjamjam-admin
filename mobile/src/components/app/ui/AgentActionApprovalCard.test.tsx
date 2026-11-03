import { fireEvent, render, screen } from "@testing-library/react";

import { AgentActionApprovalCard } from "./AgentActionApprovalCard";

const BASE_COMPONENT = "mobile_chat_tests_action-approval";

const defaultProps = {
    "data-component": BASE_COMPONENT,
    actionId: "action-1",
    capability: "messages.send",
    title: "메시지 발송",
    summary: "발송 전에 변경 내용을 확인해 주세요.",
    expiresAt: "2099-08-03T00:00:00.000Z",
    expectedRevision: "revision-1",
    risk: "reversible-write",
    target: { clientId: "client-1" },
    changes: { body: "안내 메시지" },
    provider: "resend",
    estimatedCost: "₩100",
};

describe("AgentActionApprovalCard", () => {
    it("retains resolved before/after preview tables without acknowledgement controls", () => {
        render(<AgentActionApprovalCard {...defaultProps} terminal risk="external-side-effect"
            preview={{ sections: [{ title: "일정 변경", rows: [{ label: "종료일", before: "2026-10-01", after: "2026-10-14", note: "변경 확인" }] }] }} />);
        expect(screen.getByRole("table")).toHaveTextContent("2026-10-01");
        expect(screen.getByRole("table")).toHaveTextContent("2026-10-14");
        expect(screen.getByRole("note")).toHaveTextContent("변경 확인");
        expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    });

    it("renders the optional contact directly below the summary", () => {
        const { container } = render(<AgentActionApprovalCard {...defaultProps} contact={<p>연락처 카드</p>} />);
        expect(container.querySelector('[data-slot="summary"]')?.nextElementSibling).toHaveTextContent("연락처 카드");
    });

    it("omits only top-level masked-contact keys from target and changes, case-insensitively", () => {
        const values = { clientId: 12, phone: "••••5678", phoneLast4: "5678", MASKEDCONTACT: "masked", maskedReceiver: "masked", Receiver: "masked", nested: { receiver: "retained" } };
        const { container } = render(<AgentActionApprovalCard {...defaultProps} target={values} changes={values} />);
        const blocks = container.querySelectorAll("dd.col-span-2");
        expect(blocks).toHaveLength(2);
        for (const block of blocks) {
            expect(block.textContent).not.toMatch(/phoneLast4|MASKEDCONTACT|maskedReceiver|Receiver|masked/);
            expect(block).toHaveTextContent("clientId");
            expect(block).toHaveTextContent("phone");
            expect(block).toHaveTextContent("••••5678");
            expect(block).toHaveTextContent("retained");
        }
    });

    it("renders the caller ancestry, safety labels, details, and touch-sized actions", () => {
        render(<AgentActionApprovalCard {...defaultProps} />);

        const card = screen.getByLabelText("승인 대기 작업");
        expect(card).toHaveAttribute("data-component", BASE_COMPONENT);
        expect(card).toHaveAttribute("data-source-component", "AgentActionApprovalCard");
        expect(card).toHaveAttribute("data-slot", "action-proposal");
        expect(card.querySelector(`[data-component="${BASE_COMPONENT}_content"]`)).toBeInTheDocument();
        expect(card.querySelector(`[data-component="${BASE_COMPONENT}_header"]`)).toBeInTheDocument();
        expect(card.querySelector(`[data-component="${BASE_COMPONENT}_actions"]`)).toBeInTheDocument();
        expect(screen.getByText("대상 변경")).toBeInTheDocument();
        expect(screen.getByText(/clientId/)).toBeInTheDocument();
        expect(screen.getByText("외부 제공자")).toBeInTheDocument();
        expect(screen.getByText("resend")).toBeInTheDocument();
        expect(screen.getByText("예상 비용")).toBeInTheDocument();
        expect(screen.getByText("₩100")).toBeInTheDocument();

        expect(screen.getByRole("button", { name: "승인하고 실행" })).toHaveClass("min-h-11");
        expect(screen.getByRole("button", { name: "거절" })).toHaveClass("min-h-11");
    });

    it("requires acknowledgement and forwards the token with the revision", () => {
        const onApprove = jest.fn();
        const onReject = jest.fn();
        render(
            <AgentActionApprovalCard
                {...defaultProps}
                acknowledgementToken="ack-token"
                onApprove={onApprove}
                onReject={onReject}
            />,
        );

        const approve = screen.getByRole("button", { name: "승인하고 실행" });
        expect(approve).toBeDisabled();

        fireEvent.click(screen.getByRole("checkbox"));
        expect(approve).toBeEnabled();
        fireEvent.click(approve);
        fireEvent.click(screen.getByRole("button", { name: "거절" }));

        expect(onApprove).toHaveBeenCalledWith("action-1", "revision-1", "ack-token");
        expect(onReject).toHaveBeenCalledWith("action-1");
    });

    it("renders terminal proposals as read-only without action controls", () => {
        render(
            <AgentActionApprovalCard
                {...defaultProps}
                terminal
                onApprove={jest.fn()}
                onReject={jest.fn()}
            />,
        );

        expect(screen.getByLabelText("처리된 작업 제안")).toHaveTextContent("읽기 전용");
        expect(screen.queryByRole("button", { name: "승인하고 실행" })).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "거절" })).not.toBeInTheDocument();
    });
});
