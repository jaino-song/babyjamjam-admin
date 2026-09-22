import { fireEvent, render, screen } from "@testing-library/react";
import type { UIMessage } from "ai";
import { CLIENT_WRITE_FIELD_NAMES, type AgentTask } from "@babyjamjam/shared";

import { AgentPartRegistry } from "./AgentPartRegistry";

if (typeof globalThis.ResizeObserver === "undefined") {
    Object.defineProperty(globalThis, "ResizeObserver", {
        configurable: true,
        value: class ResizeObserverMock {
            observe() {}
            unobserve() {}
            disconnect() {}
        },
    });
}

describe("AgentPartRegistry", () => {
    const dataComponent = "desktop_chat_tests_agent-part-registry";

    it("renders structured entity choices through safe design-system buttons", () => {
        const onEntitySelect = jest.fn();
        const message = {
            id: "assistant-1",
            role: "assistant",
            parts: [{
                type: "data-entity-choice",
                data: { entityType: "employees", prompt: "선택", choices: [{ id: "1", label: "홍길동" }, { id: "2", label: "김영희" }] },
            }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} onEntitySelect={onEntitySelect} />);
        expect(screen.getByRole("button", { name: "홍길동" })).toBeInTheDocument();
        expect(screen.getByRole("group", { name: "선택" })).toHaveAttribute("data-component", `${dataComponent}_entity-choice`);
        fireEvent.click(screen.getByRole("button", { name: "홍길동" }));
        expect(onEntitySelect).toHaveBeenCalledWith("1", "employees");
    });

    it("falls back safely for unknown parts instead of interpreting HTML", () => {
        const message = {
            id: "assistant-2",
            role: "assistant",
            parts: [{ type: "data-new-renderer", data: { html: "<script>bad()</script>" } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} />);
        expect(screen.getByText(/새 형식/)).toBeInTheDocument();
        expect(screen.queryByText("bad()")).not.toBeInTheDocument();
        expect(screen.getByText(/새 형식/)).toHaveAttribute("data-component", `${dataComponent}_fallback`);
    });

    it("keeps navigation parts on internal routes", () => {
        const message = {
            id: "assistant-3",
            role: "assistant",
            parts: [{ type: "data-navigation", data: { href: "https://untrusted.example", label: "열기" } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} />);
        expect(screen.queryByRole("link", { name: "열기" })).not.toBeInTheDocument();
        expect(screen.getByText(/새 형식/)).toBeInTheDocument();
    });

    it("renders AI SDK tool results as escaped, bounded JSON", () => {
        const message = {
            id: "assistant-4",
            role: "assistant",
            parts: [{ type: "tool-clients_search", state: "output-available", output: { kind: "entity", entity: { id: 1, name: "홍길동" } } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} />);
        expect(screen.getByText("clients.search 결과")).toBeInTheDocument();
        expect(screen.getByText(/홍길동/)).toBeInTheDocument();
    });

    it("derives namespaces for every structured renderer and its fallback", () => {
        const message = {
            id: "assistant-structured",
            role: "assistant",
            parts: [
                { type: "text", text: "본문" },
                { type: "data-activity", data: { label: "조회 중", status: "running" } },
                { type: "data-navigation", data: { href: "/clients", label: "고객 보기" } },
                { type: "data-error", data: { code: "validation_failed", category: "validation", message: "입력을 확인하세요.", retryable: false } },
                { type: "data-action-result", data: { actionId: "action-1", status: "succeeded", summary: "완료" } },
                { type: "data-form-submit", data: { formId: "form-1", values: {} } },
                { type: "data-attachment", data: { id: "file-1", name: "보고서.pdf", mediaType: "application/pdf", size: 12 } },
                { type: "data-feedback", data: { messageId: "assistant-structured", prompt: "도움이 되었나요?" } },
                { type: "data-task-snapshot", data: {
                    taskId: "11111111-1111-4111-8111-111111111111",
                    snapshotRef: "22222222-2222-4222-8222-222222222222",
                    kind: "clients.create",
                    capabilityId: "clients.create",
                    revision: 2,
                    state: "collecting",
                    fieldStatus: [{ field: "name", status: "confirmed" }, { field: "phone", status: "missing" }],
                } },
                { type: "data-entity-select", data: {
                    taskId: "11111111-1111-4111-8111-111111111111",
                    choiceSetRef: "33333333-3333-4333-8333-333333333333",
                    optionIds: ["44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"],
                } },
                { type: "data-task-patch", data: {
                    taskId: "11111111-1111-4111-8111-111111111111",
                    eventId: "66666666-6666-4666-8666-666666666666",
                    acceptedRevision: 3,
                    currentSnapshotRef: "77777777-7777-4777-8777-777777777777",
                } },
                { type: "data-unknown", data: { html: "<b>unsafe</b>" } },
            ],
        } as unknown as UIMessage;

        render(<AgentPartRegistry data-component={dataComponent} message={message} />);

        for (const suffix of ["text", "activity", "navigation", "error", "action-result", "form-submit", "attachment-part", "feedback", "task-snapshot", "entity-select", "task-patch", "fallback"]) {
            expect(document.querySelector(`[data-component="${dataComponent}_${suffix}"]`)).toBeInTheDocument();
        }
        expect(document.querySelector(`[data-component="${dataComponent}_error_message"]`)).toBeInTheDocument();
        expect(document.querySelector(`[data-component="${dataComponent}_action-result_summary"]`)).toBeInTheDocument();
        expect(document.querySelector(`[data-component="${dataComponent}_attachment-part_metadata"]`)).toBeInTheDocument();
    });

    it("renders task entity choices with server labels and emits structured selection", () => {
        const onTaskEntitySelect = jest.fn();
        const task = {
            schemaVersion: 1,
            taskId: "11111111-1111-4111-8111-111111111111",
            sessionId: "88888888-8888-4888-8888-888888888888",
            kind: "clients.update",
            capabilityId: "clients.update",
            revision: 2,
            state: "confirming_target",
            confirmed: {},
            tentative: {},
            clearedFields: [],
            provenance: { confirmed: {}, tentative: {} },
            issues: [],
            constraints: { noSend: false },
            choiceSets: [{
                choiceSetRef: "33333333-3333-4333-8333-333333333333",
                options: [
                    { optionId: "44444444-4444-4444-8444-444444444444", label: "홍길동" },
                    { optionId: "55555555-5555-4555-8555-555555555555", label: "김영희" },
                ],
            }],
            orderedChoiceRefs: ["33333333-3333-4333-8333-333333333333"],
            target: null,
            consent: { choice: "unanswered", binding: null },
            action: null,
            times: { createdAt: "2026-08-03T00:00:00.000Z", updatedAt: "2026-08-03T00:00:00.000Z" },
            currentSnapshotRef: "77777777-7777-4777-8777-777777777777",
        } as AgentTask;
        const message = {
            id: "assistant-task-choice",
            role: "assistant",
            parts: [{ type: "data-entity-select", data: {
                taskId: task.taskId,
                choiceSetRef: "33333333-3333-4333-8333-333333333333",
                optionIds: ["44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"],
            } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} task={task} onTaskEntitySelect={onTaskEntitySelect} />);

        fireEvent.click(screen.getByRole("button", { name: "홍길동" }));
        expect(onTaskEntitySelect).toHaveBeenCalledWith(task.taskId, "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444");
    });

    it("does not let task busy state disable a generic form", () => {
        const message = {
            id: "assistant-form-ready",
            role: "assistant",
            parts: [{ type: "data-form", data: {
                formId: "profile-form-ready",
                title: "프로필",
                schemaVersion: "1",
                fields: [{ name: "name", label: "이름", type: "text" }],
            } }],
        } as unknown as UIMessage;

        render(<AgentPartRegistry data-component={dataComponent} message={message} isBusy={false} taskBusy />);

        expect(screen.getByRole("button", { name: "입력 제출" })).toBeEnabled();
    });

    it("describes a complete client snapshot without implying missing fields are required", () => {
        const message = {
            id: "assistant-task-full-fields",
            role: "assistant",
            parts: [{ type: "data-task-snapshot", data: {
                taskId: "11111111-1111-4111-8111-111111111111",
                snapshotRef: "22222222-2222-4222-8222-222222222222",
                kind: "clients.create",
                capabilityId: "clients.create",
                revision: 7,
                state: "review_ready",
                fieldStatus: CLIENT_WRITE_FIELD_NAMES.map((field) => ({
                    field,
                    status: field === "startDate" || field === "endDate" ? "tentative" : "confirmed",
                })),
            } }],
        } as unknown as UIMessage;

        render(<AgentPartRegistry data-component={dataComponent} message={message} />);

        expect(document.querySelectorAll(`[data-component^="${dataComponent}_task-snapshot_field-status_"]`)).toHaveLength(CLIENT_WRITE_FIELD_NAMES.length);
        expect(screen.queryByText("아직 입력되지 않은 항목 0개")).not.toBeInTheDocument();
        expect(screen.queryByText(/필수 확인이 필요한 항목/)).not.toBeInTheDocument();
        expect(screen.getByText("희망값 2개")).toBeInTheDocument();
        expect(screen.getByText(/서비스 기간/)).toBeInTheDocument();
        expect(screen.getByText(/지역/)).toBeInTheDocument();
    });

    it("does not turn action-result URLs into external or javascript links", () => {
        const message = {
            id: "assistant-5",
            role: "assistant",
            parts: [{ type: "data-action-result", data: { actionId: "a-1", status: "succeeded", summary: "완료", href: "javascript:alert(1)" } }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} />);
        expect(screen.queryByRole("link", { name: "결과 열기" })).not.toBeInTheDocument();
    });

    it("requires the server-issued acknowledgement for side-effect proposals", () => {
        const onApproveAction = jest.fn();
        const message = {
            id: "assistant-6",
            role: "assistant",
            parts: [{
                type: "data-action-proposal",
                data: {
                    actionId: "action-reversible",
                    capability: "contracts.dispatch",
                    title: "계약서 생성 및 발송",
                    summary: "계약서를 생성하고 발송합니다.",
                    expiresAt: "2099-08-03T00:00:00.000Z",
                    expectedRevision: "revision-1",
                    risk: "external-side-effect",
                    changes: { clientId: 1 },
                    acknowledgementToken: "ack-token",
                },
            }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} onApproveAction={onApproveAction} />);
        const approve = screen.getByRole("button", { name: "승인하고 실행" });
        expect(screen.getByLabelText("승인 대기 작업")).toHaveAttribute("data-component", `${dataComponent}_action-approval`);
        expect(screen.getByLabelText("승인 대기 작업")).toHaveAttribute("data-source-component", "Card");

        expect(approve).toBeDisabled();
        fireEvent.click(screen.getByRole("checkbox"));
        expect(approve).toBeEnabled();
        fireEvent.click(approve);
        expect(onApproveAction).toHaveBeenCalledWith("action-reversible", "revision-1", "ack-token");
    });

    it("serializes untouched booleans as false and preserves non-boolean values", () => {
        const onSubmitForm = jest.fn();
        const message = {
            id: "assistant-form-1",
            role: "assistant",
            parts: [{
                type: "data-form",
                data: {
                    formId: "profile-form",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [
                        { name: "enabled", label: "사용", type: "boolean" },
                        { name: "name", label: "이름", type: "text" },
                        { name: "count", label: "횟수", type: "number" },
                    ],
                },
            }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} onSubmitForm={onSubmitForm} />);

        const form = screen.getByRole("heading", { name: "프로필" }).closest("form");
        expect(form).toHaveAttribute("data-component", `${dataComponent}_form-request`);
        expect(form).toHaveAttribute("data-source-component", "FormRequestPart");
        expect(screen.getByRole("heading", { name: "프로필" })).toHaveAttribute("data-component", `${dataComponent}_form-request_title`);
        expect(screen.getByRole("heading", { name: "프로필" })).toHaveAttribute("data-slot", "title");
        fireEvent.change(screen.getByRole("textbox", { name: "이름" }), { target: { value: "Dana" } });
        fireEvent.change(screen.getByRole("spinbutton", { name: "횟수" }), { target: { value: "3" } });
        fireEvent.submit(form!);

        expect(onSubmitForm).toHaveBeenCalledWith("profile-form", { enabled: false, name: "Dana", count: 3 });
    });

    it("keeps touched boolean values true and then false", () => {
        const onSubmitForm = jest.fn();
        const message = {
            id: "assistant-form-2",
            role: "assistant",
            parts: [{
                type: "data-form",
                data: {
                    formId: "settings-form",
                    title: "설정",
                    schemaVersion: "1",
                    fields: [{ name: "enabled", label: "사용", type: "boolean" }],
                },
            }],
        } as unknown as UIMessage;
        render(<AgentPartRegistry data-component={dataComponent} message={message} onSubmitForm={onSubmitForm} />);

        const form = screen.getByRole("heading", { name: "설정" }).closest("form");
        const checkbox = screen.getByRole("checkbox", { name: "사용" });
        fireEvent.click(checkbox);
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(1, "settings-form", { enabled: true });

        fireEvent.click(checkbox);
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(2, "settings-form", { enabled: false });
    });
});
