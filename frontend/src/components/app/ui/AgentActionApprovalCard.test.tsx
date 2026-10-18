import { render, screen } from "@testing-library/react";

import { AgentActionApprovalCard, omitMaskedContactKeys } from "./AgentActionApprovalCard";

describe("AgentActionApprovalCard", () => {
    const dataComponent = "desktop_chat_tests_agent-part-registry_action-approval";

    it("composes the shared Card primitives and exposes its owned slots", () => {
        render(
            <AgentActionApprovalCard
                data-component={dataComponent}
                actionId="action-1"
                capability="clients.update"
                title="고객 정보 수정"
                summary="변경 내용을 확인해 주세요."
                expiresAt="2099-08-03T00:00:00.000Z"
                expectedRevision="revision-1"
                changes={{ name: "홍길동" }}
            />,
        );

        const card = screen.getByLabelText("승인 대기 작업");
        expect(card).toHaveAttribute("data-component", dataComponent);
        expect(card).toHaveAttribute("data-source-component", "Card");
        expect(card.querySelector(`[data-component="${dataComponent}_content"]`)).toBeInTheDocument();
        expect(card.querySelector('[data-source-component="CardContent"]')).toBeInTheDocument();
        expect(card.querySelector(`[data-component="${dataComponent}_content_summary"]`)).toBeInTheDocument();
        expect(card.querySelector('[data-slot="actions"]')).toBeInTheDocument();
    });

    const baseProps = {
        "data-component": dataComponent,
        actionId: "action-1",
        capability: "messages.send",
        title: "문자 발송",
        summary: "변경 내용을 확인해 주세요.",
        expiresAt: "2099-08-03T00:00:00.000Z",
        expectedRevision: "revision-1",
    };

    it("renders the contact node directly under the summary", () => {
        const { container } = render(
            <AgentActionApprovalCard {...baseProps} changes={{ body: "안내" }} contact={<span data-testid="contact">김하늘 · 010-1234-5678</span>} />,
        );
        const contact = screen.getByTestId("contact");
        const summary = container.querySelector(`[data-component="${dataComponent}_content_summary"]`);
        expect(summary?.nextElementSibling).toBe(contact);
    });

    it("renders no extra node without the contact prop", () => {
        const { container } = render(<AgentActionApprovalCard {...baseProps} changes={{ body: "안내" }} />);
        const summary = container.querySelector(`[data-component="${dataComponent}_content_summary"]`);
        expect(summary?.nextElementSibling).toBe(container.querySelector(`[data-component="${dataComponent}_content_details"]`));
    });

    it("does not print masked contact keys, in any letter case, but prints everything else", () => {
        render(
            <AgentActionApprovalCard
                {...baseProps}
                target={{ clientId: 12, phoneLast4: "5678", MASKEDCONTACT: "••••5678" }}
                changes={{ receiver: "••••5678", Receiver: "••••5678", maskedReceiver: "••••5678", phone: "••••5678", body: "안내" }}
            />,
        );
        const target = document.querySelector(`[data-component="${dataComponent}_content_details_target-value"]`);
        const changes = document.querySelector(`[data-component="${dataComponent}_content_details_changes-value"]`);
        expect(target?.textContent).toBe('{"clientId":12}');
        expect(changes?.textContent).toContain('"phone": "••••5678"');
        expect(changes?.textContent).toContain('"body": "안내"');
        expect(changes?.textContent).not.toMatch(/receiver/i);
    });

    it("omitMaskedContactKeys only drops top-level masked keys", () => {
        expect(omitMaskedContactKeys({ phoneLast4: "1", maskedContact: "2", maskedReceiver: "3", receiver: "4", clientId: 5, nested: { receiver: "keep" } }))
            .toEqual({ clientId: 5, nested: { receiver: "keep" } });
    });
});
