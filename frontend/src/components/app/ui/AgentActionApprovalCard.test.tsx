import { render, screen } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

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

    describe("preview", () => {
        const preview = {
            sections: [
                {
                    title: "회차 날짜",
                    rows: [
                        { label: "1회차", before: "2026-08-03", after: "2026-08-04" },
                        { label: "2회차", before: "2026-08-10", after: "2026-08-10" },
                        { label: "3회차", before: null, after: "2026-08-17", note: "공휴일과 겹칩니다" },
                    ],
                },
                { title: "서비스 기간", rows: [{ label: "종료일", before: "2026-09-01", after: null }] },
            ],
        };

        it("renders each section as a before/after table with a changed marker per row", () => {
            const { container } = render(<AgentActionApprovalCard {...baseProps} changes={{ id: 1 }} preview={preview} />);
            const root = container.querySelector(`[data-component="${dataComponent}_content_preview"]`);
            expect(root).toHaveAttribute("data-slot", "preview");
            expect(root?.querySelectorAll('[data-slot="preview-section"]')).toHaveLength(2);
            expect(screen.getByText("회차 날짜")).toBeInTheDocument();
            expect(screen.getByText("서비스 기간")).toBeInTheDocument();
            expect(screen.getAllByText("항목")).toHaveLength(2);
            expect(screen.getAllByText("변경 전")).toHaveLength(2);
            expect(screen.getAllByText("변경 후")).toHaveLength(2);
            const rows = Array.from(root?.querySelectorAll('[data-slot="preview-row"]') ?? []);
            expect(rows.map((row) => row.getAttribute("data-changed"))).toEqual(["true", "false", "true", "true"]);
            expect(rows[0]).toHaveTextContent("1회차2026-08-032026-08-04");
        });

        it("shows the row note as a warning and null values as a dash", () => {
            render(<AgentActionApprovalCard {...baseProps} changes={{ id: 1 }} preview={preview} />);
            expect(screen.getByRole("note")).toHaveTextContent("공휴일과 겹칩니다");
            expect(screen.getAllByRole("note")).toHaveLength(1);
            const rows = Array.from(document.querySelectorAll('[data-slot="preview-row"]'));
            expect(rows[2]).toHaveTextContent("3회차—2026-08-17");
            expect(rows[3]).toHaveTextContent("종료일2026-09-01—");
        });

        it("keeps the raw changes JSON and the summary/approve UI, with the preview above the changes", () => {
            const { container } = render(<AgentActionApprovalCard {...baseProps} changes={{ id: 1 }} preview={preview} />);
            const changes = container.querySelector(`[data-component="${dataComponent}_content_details_changes-value"]`);
            expect(changes?.textContent).toBe(JSON.stringify({ id: 1 }, null, 2));
            expect(screen.getByRole("button", { name: "승인하고 실행" })).toBeInTheDocument();
            const previewRoot = container.querySelector('[data-slot="preview"]') as Element;
            const details = container.querySelector(`[data-component="${dataComponent}_content_details"]`) as Element;
            expect(previewRoot.compareDocumentPosition(details) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            expect(details.contains(previewRoot)).toBe(false);
        });

        it("renders a legacy card without a preview exactly as before", () => {
            const { container } = render(<AgentActionApprovalCard {...baseProps} changes={{ id: 1 }} />);
            expect(container.querySelector('[data-slot="preview"]')).toBeNull();
            expect(container.querySelector("table")).toBeNull();
            const withEmpty = render(<AgentActionApprovalCard {...baseProps} changes={{ id: 1 }} preview={undefined} />);
            expect(withEmpty.container.innerHTML).toBe(container.innerHTML);
            // Expected markup captured from the BASE component (d73c8c490), not from this candidate.
            // Only the locale-formatted expiry text is substituted so the comparison stays deterministic.
            const expiry = new Date(baseProps.expiresAt).toLocaleString();
            const baseMarkup = readFileSync(join(__dirname, "AgentActionApprovalCard.legacy.fixture.html"), "utf-8").replace("{{EXPIRY}}", expiry);
            expect(container.innerHTML).toBe(baseMarkup);
        });
    });
});
