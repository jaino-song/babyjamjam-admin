import { fireEvent, render, screen } from "@testing-library/react";
import { AgentTaskSchema, type AgentTask } from "@babyjamjam/shared/agent";

import { MobileAgentPartRegistry } from "./MobileAgentPartRegistry";

const registryProps = {
    onEntitySelect: jest.fn(),
    onApproveAction: jest.fn(),
    onRejectAction: jest.fn(),
    onSubmitForm: jest.fn(),
};

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

const TASK_IDS = {
    task: "11111111-1111-4111-8111-111111111111",
    session: "22222222-2222-4222-8222-222222222222",
    snapshot: "55555555-5555-4555-8555-555555555555",
    choiceSet: "77777777-7777-4777-8777-777777777777",
    option: "88888888-8888-4888-8888-888888888888",
};

function makeTask(overrides: Partial<AgentTask> = {}): AgentTask {
    return AgentTaskSchema.parse({
        schemaVersion: 1,
        taskId: TASK_IDS.task,
        sessionId: TASK_IDS.session,
        kind: "clients.create",
        capabilityId: "clients.create",
        revision: 2,
        state: "confirming_target",
        confirmed: { name: "홍길동", phone: "01012345678" },
        tentative: {},
        provenance: {
            confirmed: { name: { source: "user" }, phone: { source: "user" } },
            tentative: {},
        },
        issues: [],
        constraints: { noSend: false },
        choiceSets: [],
        orderedChoiceRefs: [],
        target: null,
        consent: { choice: "unanswered", binding: null },
        action: null,
        times: { createdAt: "2026-09-16T00:00:00.000Z", updatedAt: "2026-09-16T00:00:01.000Z" },
        currentSnapshotRef: TASK_IDS.snapshot,
        ...overrides,
    });
}

describe("MobileAgentPartRegistry", () => {
    it("preserves the entity domain when selecting a choice", () => {
        const onEntitySelect = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_entity-choice"
            part={{
                type: "data-entity-choice",
                data: {
                    entityType: "employees",
                    prompt: "직원 선택",
                    choices: [{ id: "employee-1", label: "김직원" }, { id: "employee-2", label: "이직원" }],
                },
            }}
            onEntitySelect={onEntitySelect}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        fireEvent.click(screen.getByRole("button", { name: "김직원" }));
        expect(onEntitySelect).toHaveBeenCalledWith("employee-1", "employees");
    });

    it("renders sanitized uncertain delivery details for operator recovery", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_action-result"
            part={{
                type: "data-action-result",
                data: {
                    actionId: "action-1",
                    status: "uncertain",
                    summary: "일부 구독에 전달되어 결과 확인이 필요합니다.",
                    result: { status: "partial", subscriptions: 3, delivered: 1, failed: 2, notificationId: 9 },
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        expect(screen.getByText("확인 필요")).toBeInTheDocument();
        expect(screen.getByText("처리 상세")).toBeInTheDocument();
        expect(screen.getByText(/"delivered": 1/)).toBeInTheDocument();
        expect(screen.getByText(/"failed": 2/)).toBeInTheDocument();
    });

    it("requires acknowledgement when a side-effect proposal carries a server token", () => {
        const onApproveAction = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_action-proposal"
            part={{
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
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={onApproveAction}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);
        const approve = screen.getByRole("button", { name: "승인하고 실행" });

        expect(approve).toBeDisabled();
        expect(screen.getByLabelText("승인 대기 작업")).toHaveAttribute(
            "data-component",
            "mobile_chat_tests_agent-part-registry_action-proposal",
        );
        fireEvent.click(screen.getByRole("checkbox"));
        expect(approve).toBeEnabled();
        fireEvent.click(approve);
        expect(onApproveAction).toHaveBeenCalledWith("action-reversible", "revision-1", "ack-token");
    });

    it("falls back safely for an unknown part", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_unknown"
            part={{ type: "data-new-renderer", data: { html: "<script>bad()</script>" } }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        expect(screen.getByText(/새 형식/)).toBeInTheDocument();
        expect(screen.queryByText("bad()")).not.toBeInTheDocument();
    });

    it("serializes untouched booleans as false and preserves non-boolean values", () => {
        const onSubmitForm = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_form"
            part={{
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
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={onSubmitForm}
        />);

        const form = screen.getByText("프로필").closest("form");
        expect(form).toHaveAttribute("data-component", "mobile_chat_tests_agent-part-registry_form_form");
        expect(form).toHaveAttribute("data-slot", "form");
        expect(form).toHaveAttribute("data-source-component", "MobileAgentForm");
        fireEvent.change(screen.getByLabelText("이름"), { target: { value: "Dana" } });
        fireEvent.change(screen.getByLabelText("횟수"), { target: { value: "3" } });
        fireEvent.submit(form!);

        expect(onSubmitForm).toHaveBeenCalledWith("profile-form", { enabled: false, name: "Dana", count: 3 });
    });

    it("keeps a cleared optional number empty and omits it from the submitted payload", () => {
        const onSubmitForm = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_form-number"
            part={{
                type: "data-form",
                data: {
                    formId: "profile-form",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [{ name: "count", label: "횟수", type: "number" }],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={onSubmitForm}
        />);

        const count = screen.getByRole("spinbutton", { name: "횟수" });
        const form = screen.getByText("프로필").closest("form");
        fireEvent.change(count, { target: { value: "3" } });
        expect(count).toHaveValue(3);
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(1, "profile-form", { count: 3 });

        fireEvent.change(count, { target: { value: "" } });
        expect((count as HTMLInputElement).value).toBe("");
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(2, "profile-form", {});
    });

    it("keeps a required number invalid after clearing instead of submitting zero", () => {
        const onSubmitForm = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_form-required-number"
            part={{
                type: "data-form",
                data: {
                    formId: "profile-form",
                    title: "프로필",
                    schemaVersion: "1",
                    fields: [{ name: "count", label: "횟수", type: "number", required: true }],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={onSubmitForm}
        />);

        const count = screen.getByRole("spinbutton", { name: "횟수" });
        const form = screen.getByText("프로필").closest("form");
        fireEvent.change(count, { target: { value: "3" } });
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenCalledWith("profile-form", { count: 3 });

        fireEvent.change(count, { target: { value: "" } });
        expect(count).toBeInvalid();
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenCalledTimes(1);
    });

    it("keeps touched boolean values true and then false", () => {
        const onSubmitForm = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_form-toggle"
            part={{
                type: "data-form",
                data: {
                    formId: "settings-form",
                    title: "설정",
                    schemaVersion: "1",
                    fields: [{ name: "enabled", label: "사용", type: "boolean" }],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={onSubmitForm}
        />);

        const form = screen.getByText("설정").closest("form");
        const checkbox = screen.getByRole("checkbox", { name: "사용" });
        fireEvent.click(checkbox);
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(1, "settings-form", { enabled: true });

        fireEvent.click(checkbox);
        fireEvent.submit(form!);
        expect(onSubmitForm).toHaveBeenNthCalledWith(2, "settings-form", { enabled: false });
    });

    it("passes YYYY-MM-DD metadata to mobile inputs and keeps default behavior", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_birthday-form"
            part={{
                type: "data-form",
                data: {
                    formId: "employee-create",
                    title: "직원 등록",
                    schemaVersion: "1",
                    fields: [
                        { name: "birthday", label: "생년월일", type: "date", inputMode: "numeric", placeholder: "YYYY-MM-DD", maxLength: 10 },
                        { name: "name", label: "이름", type: "text" },
                    ],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        const birthday = screen.getByLabelText("생년월일");
        expect(birthday).toHaveAttribute("type", "date");
        expect(birthday).toHaveAttribute("inputmode", "numeric");
        expect(birthday).toHaveAttribute("placeholder", "YYYY-MM-DD");
        expect(birthday).toHaveAttribute("maxlength", "10");
        expect(birthday).toHaveAttribute("data-component", "mobile_chat_tests_agent-part-registry_birthday-form_form_field_control");

        const name = screen.getByRole("textbox", { name: "이름" });
        expect(name).toHaveAttribute("placeholder", "이름");
        expect(name).not.toHaveAttribute("inputmode");
        expect(name).not.toHaveAttribute("maxlength");
    });

    it("preserves distinct caller namespaces for forms and their descendants", () => {
        const firstBase = "mobile_chat_tests_agent-part-registry_message-a_part-0";
        const secondBase = "mobile_chat_tests_agent-part-registry_message-b_part-0";
        const part = {
            type: "data-form",
            data: {
                formId: "profile-form",
                title: "프로필",
                schemaVersion: "1",
                fields: [{ name: "enabled", label: "사용", type: "boolean" as const }],
            },
        };

        render(
            <>
                <MobileAgentPartRegistry
                    data-component={firstBase}
                    part={part}
                    onEntitySelect={jest.fn()}
                    onApproveAction={jest.fn()}
                    onRejectAction={jest.fn()}
                    onSubmitForm={jest.fn()}
                />
                <MobileAgentPartRegistry
                    data-component={secondBase}
                    part={part}
                    onEntitySelect={jest.fn()}
                    onApproveAction={jest.fn()}
                    onRejectAction={jest.fn()}
                    onSubmitForm={jest.fn()}
                />
            </>,
        );

        for (const base of [firstBase, secondBase]) {
            const form = screen.getByText("프로필", { selector: `[data-component="${base}_form_title"]` }).closest("form");
            expect(form).toHaveAttribute("data-component", `${base}_form`);
            expect(form).toHaveAttribute("data-slot", "form");
            expect(form).toHaveAttribute("data-source-component", "MobileAgentForm");
            expect(form?.querySelector(`[data-component="${base}_form_title"]`)).toBeInTheDocument();
            expect(form?.querySelector(`[data-component="${base}_form_field"]`)).toBeInTheDocument();
            expect(form?.querySelector(`[data-component="${base}_form_field_label"]`)).toBeInTheDocument();
            expect(form?.querySelector(`[data-component="${base}_form_field_control"]`)).toBeInTheDocument();
            expect(form?.querySelector(`[data-component="${base}_form_submit"]`)).toBeInTheDocument();
            expect(form?.querySelector('[data-component="mobile_chat_agent-form"]')).not.toBeInTheDocument();
        }
    });

    it("renders a safe task snapshot without exposing field values", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_task-snapshot"
            part={{
                type: "data-task-snapshot",
                data: {
                    taskId: "11111111-1111-4111-8111-111111111111",
                    snapshotRef: "55555555-5555-4555-8555-555555555555",
                    kind: "clients.create",
                    capabilityId: "clients.create",
                    revision: 4,
                    state: "review_ready",
                    fieldStatus: [{ field: "name", status: "confirmed" }, { field: "phone", status: "missing" }],
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        const snapshot = screen.getByRole("region", { name: "현재 업무 초안" });
        expect(snapshot).toHaveAttribute("data-slot", "task-snapshot");
        expect(snapshot).toHaveTextContent("검토 준비");
        expect(snapshot).toHaveTextContent("버전 4");
        expect(snapshot).toHaveTextContent("name · confirmed");
        expect(snapshot).not.toHaveTextContent("홍길동");
    });

    it("hides controls when a snapshot reference is stale even at the same revision", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_stale-task-snapshot"
            part={{
                type: "data-task-snapshot",
                data: {
                    taskId: TASK_IDS.task,
                    snapshotRef: "66666666-6666-4666-8666-666666666666",
                    kind: "clients.create",
                    capabilityId: "clients.create",
                    revision: 2,
                    state: "confirming_target",
                    fieldStatus: [{ field: "name", status: "confirmed" }],
                },
            }}
            task={makeTask()}
            onTaskPatch={jest.fn()}
            onTaskCommand={jest.fn()}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        expect(screen.queryByRole("button", { name: "변경 적용" })).not.toBeInTheDocument();
    });

    it("keeps structured entity selections reference-based and usable in a narrow review", () => {
        const onTaskEntitySelect = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_task-entity-select"
            part={{
                type: "data-entity-select",
                data: {
                    taskId: "11111111-1111-4111-8111-111111111111",
                    choiceSetRef: "77777777-7777-4777-8777-777777777777",
                    optionIds: ["88888888-8888-4888-8888-888888888888"],
                },
            }}
            onEntitySelect={jest.fn()}
            onTaskEntitySelect={onTaskEntitySelect}
            task={makeTask({
                choiceSets: [{ choiceSetRef: TASK_IDS.choiceSet, options: [{ optionId: TASK_IDS.option, label: "서울 보호자" }] }],
                orderedChoiceRefs: [TASK_IDS.choiceSet],
            })}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        const option = screen.getByRole("button", { name: "서울 보호자" });
        expect(option).toHaveClass("min-h-11", "whitespace-normal");
        fireEvent.click(option);
        expect(onTaskEntitySelect).toHaveBeenCalledWith(
            "11111111-1111-4111-8111-111111111111",
            "77777777-7777-4777-8777-777777777777",
            "88888888-8888-4888-8888-888888888888",
        );
    });

    it.each([
        ["mismatched task", makeTask({ taskId: "99999999-9999-4999-8999-999999999999" }), "선택 1"],
        ["missing choice set", makeTask(), "선택 1"],
        ["stale option", makeTask({ choiceSets: [{ choiceSetRef: TASK_IDS.choiceSet, options: [{ optionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "다른 대상" }] }] }), "선택 1"],
    ] as const)("disables structured selection for %s", (_reason, task, label) => {
        const onTaskEntitySelect = jest.fn();
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_task-entity-select-invalid"
            part={{
                type: "data-entity-select",
                data: {
                    taskId: TASK_IDS.task,
                    choiceSetRef: TASK_IDS.choiceSet,
                    optionIds: [TASK_IDS.option],
                },
            }}
            onEntitySelect={jest.fn()}
            onTaskEntitySelect={onTaskEntitySelect}
            task={task}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        const option = screen.getByRole("button", { name: label });
        expect(option).toBeDisabled();
        fireEvent.click(option);
        expect(onTaskEntitySelect).not.toHaveBeenCalled();
    });

    it("renders the server receipt for a task patch", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_task-patch"
            part={{
                type: "data-task-patch",
                data: {
                    taskId: "11111111-1111-4111-8111-111111111111",
                    eventId: "33333333-3333-4333-8333-333333333333",
                    acceptedRevision: 5,
                    currentSnapshotRef: "66666666-6666-4666-8666-666666666666",
                },
            }}
            onEntitySelect={jest.fn()}
            onApproveAction={jest.fn()}
            onRejectAction={jest.fn()}
            onSubmitForm={jest.fn()}
        />);

        expect(screen.getByText("초안이 버전 5으로 업데이트되었습니다.")).toHaveAttribute("data-slot", "task-patch");
    });
});

describe("MobileAgentPartRegistry step and reasoning parts", () => {
    it("shows no fallback for step-start markers surrounding tool output in a normal reply", () => {
        const parts = [
            { type: "step-start" },
            { type: "text", text: "안내 문구입니다." },
            { type: "tool-lookup", state: "output-available", output: { ok: true } },
            { type: "step-start" },
            { type: "text", text: "마무리 문구입니다." },
        ];

        render(
            <>
                {parts.map((part, index) => (
                    <MobileAgentPartRegistry
                        key={index}
                        data-component={`mobile_chat_tests_agent-part-registry_step-flow_part-${index}`}
                        part={part}
                        {...registryProps}
                    />
                ))}
            </>,
        );

        expect(screen.queryByText(/새 형식/)).not.toBeInTheDocument();
    });

    it("renders nothing for a reasoning part and never leaks its text", () => {
        const { container } = render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_reasoning"
            part={{ type: "reasoning", text: "내부 사고 과정입니다." }}
            {...registryProps}
        />);

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByText(/새 형식/)).not.toBeInTheDocument();
        expect(screen.queryByText("내부 사고 과정입니다.")).not.toBeInTheDocument();
    });

    it("still shows the fallback for a genuinely unknown data-* part", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_unknown-data"
            part={{ type: "data-xyz", data: { anything: true } }}
            {...registryProps}
        />);

        expect(screen.getByText(/새 형식/)).toBeInTheDocument();
    });
});

describe("MobileAgentPartRegistry text markdown rendering", () => {
    it("renders a markdown table with its cells", () => {
        const text = "| a | b |\n| --- | --- |\n| 1 | 2 |";
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-table"
            part={{ type: "text", text }}
            {...registryProps}
        />);

        expect(screen.getByRole("table")).toBeInTheDocument();
        expect(screen.getByText("1")).toBeInTheDocument();
        expect(screen.getByText("2")).toBeInTheDocument();
    });

    it("renders bold markdown as a strong element", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-bold"
            part={{ type: "text", text: "**굵게**" }}
            {...registryProps}
        />);

        expect(screen.getByText("굵게").tagName).toBe("STRONG");
    });

    it("keeps the data-component and data-slot on the text wrapper", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-wrapper"
            part={{ type: "text", text: "안녕하세요" }}
            {...registryProps}
        />);

        const wrapper = screen.getByText("안녕하세요").closest('[data-slot="text"]');
        expect(wrapper).toHaveAttribute("data-component", "mobile_chat_tests_agent-part-registry_text-wrapper");
    });

    it("does not render a script tag or an inline event-handler image from model text", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-xss"
            part={{ type: "text", text: '<script>bad()</script><img src=x onerror="bad()">' }}
            {...registryProps}
        />);

        // react-markdown (no rehype-raw) escapes raw HTML to inert text — it
        // must never become a real <script> or <img> element.
        expect(document.querySelector("script")).not.toBeInTheDocument();
        expect(document.querySelector("img")).not.toBeInTheDocument();
    });

    it("never renders a markdown image as an <img>, only its alt text", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-image"
            part={{ type: "text", text: "![대체텍스트](https://evil.test/x.png)" }}
            {...registryProps}
        />);

        expect(document.querySelector("img")).not.toBeInTheDocument();
        expect(screen.getByText("대체텍스트")).toBeInTheDocument();
    });

    it("opens external http(s) links in a new tab with a safe rel", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-link-external"
            part={{ type: "text", text: "[문서](https://example.com/doc)" }}
            {...registryProps}
        />);

        const link = screen.getByRole("link", { name: "문서" });
        expect(link).toHaveAttribute("href", "https://example.com/doc");
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
    });

    it("keeps a relative in-app link same-tab without target=_blank", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-link-relative"
            part={{ type: "text", text: "[내부](/clients/1)" }}
            {...registryProps}
        />);

        const link = screen.getByRole("link", { name: "내부" });
        expect(link).toHaveAttribute("href", "/clients/1");
        expect(link).not.toHaveAttribute("target");
    });

    it("renders any other link scheme as plain text instead of a clickable link", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-link-unsafe"
            part={{ type: "text", text: "[클릭](javascript:alert(1))" }}
            {...registryProps}
        />);

        expect(screen.queryByRole("link")).not.toBeInTheDocument();
        expect(screen.getByText("클릭")).toBeInTheDocument();
    });

    it("never renders protocol-relative hosts as links", () => {
        render(<MobileAgentPartRegistry
            data-component="mobile_chat_tests_agent-part-registry_text-link-protocol-relative"
            part={{ type: "text", text: "[외부1](//evil.test/x) [외부2](/\\evil.test/x)" }}
            {...registryProps}
        />);

        expect(screen.queryByRole("link", { name: "외부1" })).not.toBeInTheDocument();
        expect(screen.getByText("외부1")).toBeInTheDocument();
        for (const anchor of Array.from(document.querySelectorAll("a"))) {
            expect(new URL(anchor.getAttribute("href") ?? "", "https://app.test").origin).toBe("https://app.test");
        }
    });
});
