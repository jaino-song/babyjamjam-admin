"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
    CLIENT_WRITE_FIELD_NAMES,
    type AgentTask,
    type ClientClearableField,
    type ClientInputOperation,
    type AutomationInputField,
    type ClientWriteField,
} from "@babyjamjam/shared/agent";

import { FormNativeSelect, FormSection } from "@/components/app/ui/form-section";
import { InputField } from "@/components/app/v3/InputField";
import { MobileTwoButtonModal } from "@/components/app/ui/MobileTwoButtonModal";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { MobileAgentTaskCommand, MobileAgentTaskMutationResult } from "@/hooks/useAgentChat";

const TASK_STATE_LABELS: Record<AgentTask["state"], string> = {
    collecting: "정보 수집",
    confirming_target: "대상 확인",
    review_ready: "검토 준비",
    awaiting_approval: "승인 대기",
    paused: "보류",
    executing: "실행 중",
    reconciling: "결과 확인 중",
    completed: "완료",
    failed: "확정 실패",
    cancelled: "취소",
};

const FIELD_LABELS: Record<ClientWriteField, string> = {
    name: "이름",
    address: "주소",
    phone: "연락처",
    type: "고객 유형",
    duration: "서비스 기간",
    fullPrice: "정가",
    grant: "지원금",
    actualPrice: "실결제 금액",
    startDate: "서비스 시작일",
    endDate: "서비스 종료일",
    careCenter: "케어센터",
    voucherClient: "바우처 고객",
    birthday: "생년월일",
    dueDate: "예정일",
    birthDate: "출산일",
    serviceStatus: "서비스 상태",
    breastPump: "유축기",
    areaId: "지역",
};

const CLEARABLE_FIELDS = new Set<ClientClearableField>([
    "address",
    "type",
    "duration",
    "fullPrice",
    "grant",
    "actualPrice",
    "startDate",
    "endDate",
    "careCenter",
    "birthday",
    "dueDate",
    "birthDate",
    "serviceStatus",
    "areaId",
]);
const BOOLEAN_FIELDS = new Set<ClientWriteField>(["careCenter", "voucherClient", "breastPump"]);
const DATE_FIELDS = new Set<ClientWriteField>(["startDate", "endDate", "dueDate", "birthDate"]);
const NUMBER_FIELDS = new Set<ClientWriteField>(["duration"]);
const SERVICE_STATUS_OPTIONS = [
    { value: "pre_booking", label: "예약 전" },
    { value: "waiting", label: "대기" },
    { value: "replacement_requested", label: "대체 요청" },
    { value: "active", label: "진행 중" },
    { value: "completed", label: "완료" },
    { value: "terminated", label: "종료" },
] as const;

type EditableField = ClientWriteField | AutomationInputField;
type DraftValue = string | boolean;
type DraftValues = Partial<Record<EditableField, DraftValue>>;

export type MobileTaskControlsProps = {
    "data-component": string;
    task: AgentTask;
    taskBusy?: boolean;
    taskNeedsReconciliation?: boolean;
    onPatch?: (taskId: string, operations: readonly ClientInputOperation[]) => Promise<MobileAgentTaskMutationResult | void> | MobileAgentTaskMutationResult | void;
    onCommand?: (taskId: string, command: MobileAgentTaskCommand) => Promise<MobileAgentTaskMutationResult | void> | MobileAgentTaskMutationResult | void;
};

function isOwn(record: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(record, key);
}

function isClearableField(field: ClientWriteField): field is ClientClearableField {
    return CLEARABLE_FIELDS.has(field as ClientClearableField);
}

function displayValue(field: ClientWriteField, value: unknown): DraftValue {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return String(value);
    if (typeof value !== "string") return "";
    if (DATE_FIELDS.has(field) && value.includes("T")) return value.slice(0, 10);
    return value;
}

function taskDraftValues(task: AgentTask): DraftValues {
    const values: DraftValues = {};
    for (const field of CLIENT_WRITE_FIELD_NAMES) {
        const confirmed = isOwn(task.confirmed, field) ? task.confirmed[field] : undefined;
        const source = confirmed ?? task.tentative[field];
        if (source !== undefined && source !== null) values[field] = displayValue(field, source);
        else if (BOOLEAN_FIELDS.has(field) && isOwn(task.confirmed, field)) values[field] = false;
    }
    values.automationChoice = task.consent.choice;
    values.noSend = task.constraints.noSend;
    return values;
}

function normalizedComparable(field: ClientWriteField, value: unknown): string | boolean | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (BOOLEAN_FIELDS.has(field)) return value === true;
    if (NUMBER_FIELDS.has(field)) return typeof value === "number" ? String(value) : String(value).trim();
    if (DATE_FIELDS.has(field) && typeof value === "string" && value.includes("T")) return value.slice(0, 10);
    return typeof value === "string" ? value.trim() : String(value);
}

function fieldChanged(task: AgentTask, field: EditableField, value: DraftValue | undefined): boolean {
    if (field === "automationChoice") return value !== task.consent.choice;
    if (field === "noSend") return value !== task.constraints.noSend;
    const confirmed = isOwn(task.confirmed, field) ? task.confirmed[field] : undefined;
    const original = confirmed ?? task.tentative[field];
    return normalizedComparable(field, value) !== normalizedComparable(field, original);
}

function buildOperations(task: AgentTask, values: DraftValues, touchedFields: ReadonlySet<EditableField>): { operations: ClientInputOperation[]; error?: string } {
    const operations: ClientInputOperation[] = [];
    for (const field of touchedFields) {
        const value = values[field];
        if (!fieldChanged(task, field, value)) continue;

        if (field === "automationChoice") {
            if (value === "unanswered" || value === "yes" || value === "no") operations.push({ op: "set", field, value });
            continue;
        }
        if (field === "noSend") {
            if (typeof value === "boolean") operations.push({ op: "set", field, value });
            continue;
        }

        if (BOOLEAN_FIELDS.has(field)) {
            if (typeof value === "boolean") operations.push({ op: "set", field, value });
            continue;
        }

        const textValue = typeof value === "string" ? value.trim() : "";
        if (!textValue) {
            if (field === "name" || field === "phone") return { operations: [], error: `${FIELD_LABELS[field]}을(를) 입력해 주세요.` };
            if (isClearableField(field) && isOwn(task.confirmed, field) && task.confirmed[field] !== null) {
                operations.push({ op: "clear", field });
            }
            continue;
        }

        if (NUMBER_FIELDS.has(field)) {
            const numberValue = Number(textValue);
            if (!Number.isInteger(numberValue) || numberValue < 0) return { operations: [], error: `${FIELD_LABELS[field]}은(는) 0 이상의 정수로 입력해 주세요.` };
            operations.push({ op: "set", field, value: numberValue });
            continue;
        }

        operations.push({ op: "set", field, value: textValue });
    }
    return { operations };
}

function stateBadgeVariant(state: AgentTask["state"]): "neutral" | "info" | "success" | "warning" | "danger" {
    if (state === "completed") return "success";
    if (state === "failed" || state === "cancelled") return "danger";
    if (state === "paused") return "warning";
    if (state === "executing" || state === "reconciling") return "info";
    return "neutral";
}

function commandAllowed(task: AgentTask, command: MobileAgentTaskCommand["command"]): boolean {
    if (command === "pause") return ["collecting", "confirming_target", "review_ready", "paused"].includes(task.state);
    if (command === "resume") return task.state === "paused";
    if (command === "cancel") return ["collecting", "confirming_target", "review_ready", "paused", "awaiting_approval"].includes(task.state);
    if (command === "prepare-review") return ["collecting", "confirming_target", "review_ready", "awaiting_approval"].includes(task.state);
    return false;
}

export function MobileTaskControls({ "data-component": dataComponent, task, taskBusy = false, taskNeedsReconciliation = false, onPatch, onCommand }: MobileTaskControlsProps) {
    const [values, setValues] = useState<DraftValues>(() => taskDraftValues(task));
    const [touchedFields, setTouchedFields] = useState<Set<EditableField>>(new Set());
    const [formError, setFormError] = useState<string | null>(null);
    const [localBusy, setLocalBusy] = useState(false);
    const [cancelOpen, setCancelOpen] = useState(false);
    const mutationRef = useRef(false);
    const taskIdentityRef = useRef(task.taskId);

    useEffect(() => {
        if (taskIdentityRef.current === task.taskId) return;
        taskIdentityRef.current = task.taskId;
        setValues(taskDraftValues(task));
        setTouchedFields(new Set());
        setFormError(null);
        setCancelOpen(false);
    }, [task]);

    const operationsResult = useMemo(() => buildOperations(task, values, touchedFields), [task, touchedFields, values]);
    const terminal = task.state === "completed" || task.state === "failed" || task.state === "cancelled";
    const busy = taskBusy || taskNeedsReconciliation || localBusy || terminal;
    const sub = (suffix: string) => `${dataComponent}_${suffix}`;

    const setField = (field: EditableField, value: DraftValue) => {
        setValues((current) => ({ ...current, [field]: value }));
        setTouchedFields((current) => new Set(current).add(field));
        setFormError(null);
    };

    const invokeMutation = async (invoke: () => Promise<MobileAgentTaskMutationResult | void> | MobileAgentTaskMutationResult | void): Promise<MobileAgentTaskMutationResult | void> => {
        if (mutationRef.current || busy) return undefined;
        mutationRef.current = true;
        setLocalBusy(true);
        try {
            return await invoke();
        } finally {
            mutationRef.current = false;
            setLocalBusy(false);
        }
    };

    const applyPatch = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!onPatch || busy || mutationRef.current) return;
        const result = buildOperations(task, values, touchedFields);
        if (result.error) {
            setFormError(result.error);
            return;
        }
        if (result.operations.length === 0) {
            setFormError(touchedFields.size > 0 ? "변경된 내용이 없습니다." : "변경할 내용을 입력해 주세요.");
            return;
        }
        setFormError(null);
        const mutation = await invokeMutation(() => onPatch(task.taskId, result.operations));
        if (mutation?.status === "applied") {
            setValues(taskDraftValues(mutation.task ?? task));
            setTouchedFields(new Set());
        }
    };

    const runCommand = async (command: MobileAgentTaskCommand) => {
        if (!onCommand || busy || !commandAllowed(task, command.command)) return;
        const mutation = await invokeMutation(() => onCommand(task.taskId, command));
        if (command.command === "cancel" && mutation?.status === "applied") setCancelOpen(false);
    };

    const renderTextField = (field: ClientWriteField, type: "text" | "date" | "number" = "text") => (
        <InputField
            key={field}
            data-component={sub(`edit-field_${field}`)}
            title={FIELD_LABELS[field]}
            message={formError && (field === "name" || field === "phone") ? formError : undefined}
            messageTone="error"
            inputProps={{
                "data-component": sub(`edit-field_${field}_control`),
                id: `${dataComponent}-${field}`,
                name: field,
                type,
                inputMode: field === "phone" || field === "birthday" || type === "number" ? "numeric" : undefined,
                maxLength: field === "birthday" ? 6 : undefined,
                value: typeof values[field] === "string" ? values[field] : "",
                disabled: busy,
                onChange: (event) => setField(field, event.target.value),
                onKeyDown: (event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Enter") {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                    }
                },
            }}
        />
    );

    const renderCheckbox = (field: ClientWriteField) => (
        <div key={field} data-component={sub(`edit-field_${field}`)} className="flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2">
            <Checkbox
                data-component={sub(`edit-field_${field}_control`)}
                id={`${dataComponent}-${field}`}
                checked={values[field] === true}
                disabled={busy}
                onCheckedChange={(checked) => setField(field, checked === true)}
            />
            <Label htmlFor={`${dataComponent}-${field}`} className="text-sm">{FIELD_LABELS[field]}</Label>
        </div>
    );

    const reviewIssues = task.issues.filter((issue) => issue.severity === "error" || issue.severity === "warning");
    const showPause = commandAllowed(task, "pause") && task.state !== "paused";
    const showResume = commandAllowed(task, "resume");
    const showPrepareReview = commandAllowed(task, "prepare-review");
    const showCancel = commandAllowed(task, "cancel");

    return (
        <section data-component={dataComponent} data-source-component="MobileTaskControls" data-slot="task-controls" aria-label="업무 초안 컨트롤" className="mt-3 min-w-0 rounded-xl border p-3">
            <div data-component={sub("review-state")} data-slot="review-state" className="flex min-w-0 flex-wrap items-center gap-2">
                <StatusBadge data-component={sub("review-state_badge")} variant={stateBadgeVariant(task.state)}>{TASK_STATE_LABELS[task.state]}</StatusBadge>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">버전 {task.revision}</span>
                {task.action && <span data-component={sub("review-state_approval")} className="text-xs font-medium text-primary">승인 대기 작업</span>}
            </div>

            {reviewIssues.length > 0 && <ul data-component={sub("review-state_issues")} className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">{reviewIssues.map((issue, index) => <li key={`${issue.code}-${issue.field ?? "task"}-${index}`}>{issue.message}</li>)}</ul>}

            <form data-component={sub("editor")} data-slot="editor" className="mt-3 flex min-w-0 flex-col gap-3" onSubmit={(event) => void applyPatch(event)}>
                <FormSection data-component={sub("editor_basic")} title="기본 정보">
                    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        {renderTextField("name")}
                        {renderTextField("phone")}
                        {renderTextField("birthday")}
                        {renderTextField("address")}
                        {renderTextField("type")}
                    </div>
                </FormSection>
                <FormSection data-component={sub("editor_service")} title="서비스 정보" showSeparator>
                    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                        {renderTextField("duration", "number")}
                        {renderTextField("startDate", "date")}
                        {renderTextField("endDate", "date")}
                        {renderTextField("dueDate", "date")}
                        {renderTextField("birthDate", "date")}
                        <div data-component={sub("edit-field_serviceStatus")} className="flex min-w-0 flex-col gap-1.5">
                            <Label htmlFor={`${dataComponent}-serviceStatus`}>{FIELD_LABELS.serviceStatus}</Label>
                            <FormNativeSelect
                                data-component={sub("edit-field_serviceStatus_control")}
                                id={`${dataComponent}-serviceStatus`}
                                value={typeof values.serviceStatus === "string" ? values.serviceStatus : ""}
                                options={SERVICE_STATUS_OPTIONS}
                                placeholder="서비스 상태 선택"
                                disabled={busy}
                                onValueChange={(value) => setField("serviceStatus", value)}
                            />
                        </div>
                        {renderTextField("fullPrice")}
                        {renderTextField("grant")}
                        {renderTextField("actualPrice")}
                        {renderTextField("areaId")}
                        {renderCheckbox("careCenter")}
                        {renderCheckbox("voucherClient")}
                        {renderCheckbox("breastPump")}
                    </div>
                </FormSection>
                {(task.automation || task.consent.choice !== "unanswered" || task.constraints.noSend) && (
                    <FormSection data-component={sub("editor_automation")} title="자동화 검토" showSeparator>
                        <div className="grid min-w-0 grid-cols-1 gap-3">
                            <div data-component={sub("edit-field_automationChoice")} className="flex min-w-0 flex-col gap-1.5">
                                <Label htmlFor={`${dataComponent}-automationChoice`}>자동화 동의</Label>
                                <FormNativeSelect
                                    data-component={sub("edit-field_automationChoice_control")}
                                    id={`${dataComponent}-automationChoice`}
                                    value={typeof values.automationChoice === "string" ? values.automationChoice : "unanswered"}
                                    options={[{ value: "unanswered", label: "아직 선택하지 않음" }, { value: "yes", label: "예" }, { value: "no", label: "아니요" }]}
                                    disabled={busy}
                                    onValueChange={(value) => setField("automationChoice", value)}
                                />
                            </div>
                            <div data-component={sub("edit-field_noSend")} className="flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2 text-sm">
                                <Checkbox
                                    data-component={sub("edit-field_noSend_control")}
                                    id={`${dataComponent}-noSend`}
                                    checked={values.noSend === true}
                                    disabled={busy}
                                    onCheckedChange={(checked) => setField("noSend", checked === true)}
                                />
                                <Label htmlFor={`${dataComponent}-noSend`}>자동 발송 안 함</Label>
                            </div>
                            {task.automation && <p className="text-xs text-muted-foreground">검토 대상 효과 {task.automation.effects.length}건 · 수신자 {new Set(task.automation.effects.map(({ recipientRef }) => recipientRef)).size}명</p>}
                        </div>
                    </FormSection>
                )}
                {formError && <p data-component={sub("editor_error")} role="alert" className="text-sm text-destructive">{formError}</p>}
                <Button data-component={sub("editor_submit")} type="submit" className="min-h-11 w-full" disabled={busy || !onPatch || operationsResult.operations.length === 0} aria-busy={busy || undefined}>변경 적용</Button>
            </form>

            <div data-component={sub("lifecycle")} data-slot="lifecycle" className="mt-3 flex min-w-0 flex-wrap gap-2 border-t pt-3">
                {showPause && <Button data-component={sub("lifecycle_pause")} type="button" variant="outline" className="min-h-11 min-w-0 flex-1" disabled={busy || !onCommand} onClick={() => void runCommand({ command: "pause" })}>일시정지</Button>}
                {showResume && <Button data-component={sub("lifecycle_resume")} type="button" variant="outline" className="min-h-11 min-w-0 flex-1" disabled={busy || !onCommand} onClick={() => void runCommand({ command: "resume" })}>재개</Button>}
                {showPrepareReview && <Button data-component={sub("lifecycle_prepare-review")} type="button" variant="secondary" className="min-h-11 min-w-0 flex-1" disabled={busy || !onCommand} onClick={() => void runCommand({ command: "prepare-review" })}>검토 준비</Button>}
                {showCancel && <Button data-component={sub("lifecycle_cancel")} type="button" variant="destructive" className="min-h-11 min-w-0 flex-1" disabled={busy || !onCommand} onClick={() => setCancelOpen(true)}>취소</Button>}
            </div>

            {(task.state === "review_ready" || task.state === "awaiting_approval") && (
                <div data-component={sub("review")} data-slot="review" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" aria-live="polite">
                    <p data-component={sub("review_title")} data-slot="title" className="font-semibold">{task.state === "awaiting_approval" ? "승인 대기 중" : "검토 준비 완료"}</p>
                    <p data-component={sub("review_description")} data-slot="description" className="mt-1 text-xs">{task.action ? "아래 승인 카드에서 변경 내용을 확인하고 실행할 수 있습니다." : "변경 내용을 확인한 뒤 검토안을 준비해 주세요."}</p>
                </div>
            )}

            <MobileTwoButtonModal
                data-component={sub("cancel-confirmation")}
                open={cancelOpen}
                title="업무 초안을 취소할까요?"
                description="취소한 초안은 다시 실행할 수 없습니다."
                cancelLabel="돌아가기"
                confirmLabel="초안 취소"
                loading={localBusy}
                onOpenChange={setCancelOpen}
                onCancel={() => setCancelOpen(false)}
                onConfirm={() => void runCommand({ command: "cancel" })}
            />
        </section>
    );
}
