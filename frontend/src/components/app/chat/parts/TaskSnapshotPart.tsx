"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
    CLIENT_CLEARABLE_FIELD_NAMES,
    CLIENT_WRITE_FIELD_NAMES,
    type AgentDataParts,
    type AgentTask,
    type AgentTaskPatchRequest,
    type ClientClearableField,
    type ClientWriteField,
} from "@babyjamjam/shared/agent";
import type { AgentTaskCommand } from "@/hooks/useAgentChat";

type TaskSnapshotData = AgentDataParts["task-snapshot"];
type EntitySelectData = AgentDataParts["entity-select"];
type TaskPatchData = AgentDataParts["task-patch"];

const TASK_STATE_LABELS: Record<TaskSnapshotData["state"], string> = {
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

const FIELD_STATUS_LABELS: Record<TaskSnapshotData["fieldStatus"][number]["status"], string> = {
    missing: "미입력",
    confirmed: "확정",
    tentative: "희망값",
    "confirmed-and-tentative": "확정·희망값",
};

const FIELD_LABELS: Partial<Record<TaskSnapshotData["fieldStatus"][number]["field"], string>> = {
    name: "이름",
    phone: "연락처",
    birthday: "생년월일",
    address: "주소",
    type: "고객 유형",
    duration: "서비스 기간",
    fullPrice: "정가",
    grant: "지원금",
    actualPrice: "실결제 금액",
    startDate: "서비스 시작일",
    endDate: "서비스 종료일",
    careCenter: "케어센터",
    voucherClient: "바우처",
    serviceStatus: "서비스 상태",
    dueDate: "예정일",
    birthDate: "출산일",
    breastPump: "유축기",
    areaId: "지역",
};

const CAPABILITY_LABELS: Record<TaskSnapshotData["capabilityId"], string> = {
    "clients.create": "고객 등록",
    "clients.update": "고객 수정",
};

const BOOLEAN_FIELDS = new Set<ClientWriteField>(["careCenter", "voucherClient", "breastPump"]);
const NUMBER_FIELDS = new Set<ClientWriteField>(["duration"]);
const TEXTAREA_FIELDS = new Set<ClientWriteField>(["address"]);
const CLEARABLE_FIELDS = new Set<ClientWriteField>(CLIENT_CLEARABLE_FIELD_NAMES);
const TASK_TERMINAL_STATES = new Set<TaskSnapshotData["state"]>(["completed", "failed", "cancelled"]);
const PAUSABLE_TASK_STATES = new Set<TaskSnapshotData["state"]>(["collecting", "confirming_target", "review_ready"]);
const REVIEWABLE_TASK_STATES = new Set<TaskSnapshotData["state"]>(["collecting", "confirming_target", "review_ready", "awaiting_approval"]);
const CANCELLABLE_TASK_STATES = new Set<TaskSnapshotData["state"]>(["collecting", "confirming_target", "review_ready", "awaiting_approval", "paused"]);

function readTaskFieldValue(task: AgentTask, field: ClientWriteField): string {
    const confirmed = task.confirmed[field];
    const tentative = task.tentative[field];
    const value = confirmed ?? tentative;
    if (value === undefined || value === null) return "";
    if (typeof value === "boolean") return value ? "true" : "false";
    const stringValue = String(value);
    const isDateField = field.endsWith("Date") || field === "dueDate" || field === "startDate" || field === "endDate";
    return isDateField ? stringValue.slice(0, 10) : stringValue;
}

function toOperationValue(field: ClientWriteField, value: string): unknown {
    if (NUMBER_FIELDS.has(field)) return Number(value);
    if (BOOLEAN_FIELDS.has(field)) return value === "true";
    return value;
}

function isValidOperationValue(field: ClientWriteField, value: string): boolean {
    if (!value.trim()) return false;
    if (!NUMBER_FIELDS.has(field)) return true;
    const number = Number(value);
    return Number.isFinite(number) && Number.isInteger(number) && number >= 0;
}

function isClearableField(field: ClientWriteField): field is ClientClearableField {
    return CLEARABLE_FIELDS.has(field);
}

function fieldInputType(field: ClientWriteField): "text" | "number" | "date" {
    if (NUMBER_FIELDS.has(field)) return "number";
    if (field.endsWith("Date") || field === "dueDate" || field === "startDate" || field === "endDate") return "date";
    return "text";
}

export type TaskSnapshotControlsProps = {
    "data-component": string;
    task: AgentTask;
    disabled?: boolean;
    onPatch?: (taskId: string, operations: AgentTaskPatchRequest["operations"]) => void | Promise<unknown>;
    onCommand?: (taskId: string, command: AgentTaskCommand) => void | Promise<unknown>;
};

export function TaskSnapshotControls({ "data-component": dataComponent, task, disabled = false, onPatch, onCommand }: TaskSnapshotControlsProps) {
    const [selectedField, setSelectedField] = useState<ClientWriteField>(CLIENT_WRITE_FIELD_NAMES[0]);
    const [draftValue, setDraftValue] = useState("");
    const fieldOptions = useMemo(() => task.issues.some(({ field }) => field !== undefined)
        ? [...new Set(task.issues.flatMap(({ field }) => field ? [field] : [])), ...CLIENT_WRITE_FIELD_NAMES].filter((field, index, fields) => fields.indexOf(field) === index)
        : [...CLIENT_WRITE_FIELD_NAMES], [task.issues]);

    useEffect(() => {
        if (!fieldOptions.includes(selectedField)) setSelectedField(fieldOptions[0] ?? CLIENT_WRITE_FIELD_NAMES[0]);
    }, [fieldOptions, selectedField]);

    useEffect(() => {
        setDraftValue(readTaskFieldValue(task, selectedField));
    }, [selectedField, task]);

    const state = task.state as TaskSnapshotData["state"];
    const isTerminal = TASK_TERMINAL_STATES.has(state);
    const canPause = PAUSABLE_TASK_STATES.has(state);
    const canResume = state === "paused";
    const canPrepareReview = REVIEWABLE_TASK_STATES.has(state);
    const canCancel = CANCELLABLE_TASK_STATES.has(state);
    const fieldLabel = FIELD_LABELS[selectedField] ?? selectedField;
    const valueIsValid = isValidOperationValue(selectedField, draftValue);
    const controlsDisabled = disabled || isTerminal;

    const emitPatch = (operation: AgentTaskPatchRequest["operations"][number]) => {
        if (controlsDisabled || !onPatch) return;
        void onPatch(task.taskId, [operation]);
    };

    const submitValue = (op: "set" | "mark-tentative") => {
        if (!valueIsValid) return;
        emitPatch({ op, field: selectedField, value: toOperationValue(selectedField, draftValue) } as AgentTaskPatchRequest["operations"][number]);
    };

    const handleEditorKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Enter" && !event.shiftKey && !TEXTAREA_FIELDS.has(selectedField)) {
            event.preventDefault();
            submitValue("set");
        }
    };

    const emitCommand = (command: AgentTaskCommand["command"]) => {
        if (controlsDisabled || !onCommand) return;
        onCommand(task.taskId, { command } as AgentTaskCommand);
    };

    return (
        <section data-component={dataComponent} data-source-component="TaskSnapshotControls" data-slot="controls" aria-label="작업 초안 제어">
            <div data-component={`${dataComponent}_editor`} data-slot="editor" className="mt-4 flex flex-col gap-3 rounded-lg border bg-muted/20 p-3">
                <div data-component={`${dataComponent}_editor_heading`} data-slot="editor-heading" className="flex items-center justify-between gap-3">
                    <p data-component={`${dataComponent}_editor_heading_title`} data-slot="title" className="text-sm font-semibold">초안 수정</p>
                    <span data-component={`${dataComponent}_editor_heading_revision`} data-slot="revision" className="text-xs text-muted-foreground">버전 {task.revision}</span>
                </div>
                <div data-component={`${dataComponent}_editor_fields`} data-slot="fields" className="grid gap-2 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-end">
                    <div data-component={`${dataComponent}_editor_fields_field`} data-slot="field" className="flex flex-col gap-1">
                        <Label data-component={`${dataComponent}_editor_fields_field_label`} htmlFor={`${dataComponent}_field`}>수정할 항목</Label>
                        <Select value={selectedField} onValueChange={(value) => setSelectedField(value as ClientWriteField)} disabled={controlsDisabled}>
                            <SelectTrigger id={`${dataComponent}_field`} data-component={`${dataComponent}_editor_field`} aria-label="수정할 항목">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {fieldOptions.map((field) => <SelectItem key={field} value={field}>{FIELD_LABELS[field] ?? field}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div data-component={`${dataComponent}_editor_fields_value`} data-slot="value" className="flex flex-col gap-1">
                        <Label data-component={`${dataComponent}_editor_fields_value_label`} htmlFor={`${dataComponent}_value`}>{fieldLabel} 변경값</Label>
                        {BOOLEAN_FIELDS.has(selectedField)
                            ? <Select value={draftValue || undefined} onValueChange={setDraftValue} disabled={controlsDisabled}>
                                <SelectTrigger id={`${dataComponent}_value`} data-component={`${dataComponent}_editor_value`} aria-label={`${fieldLabel} 변경값`}>
                                    <SelectValue placeholder="선택해 주세요" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="true">예</SelectItem>
                                    <SelectItem value="false">아니요</SelectItem>
                                </SelectContent>
                            </Select>
                            : TEXTAREA_FIELDS.has(selectedField)
                                ? <Textarea id={`${dataComponent}_value`} data-component={`${dataComponent}_editor_value`} aria-label={`${fieldLabel} 변경값`} value={draftValue} disabled={controlsDisabled} onChange={(event) => setDraftValue(event.target.value)} onKeyDown={handleEditorKeyDown} rows={2} />
                                : <Input id={`${dataComponent}_value`} data-component={`${dataComponent}_editor_value`} aria-label={`${fieldLabel} 변경값`} type={fieldInputType(selectedField)} value={draftValue} disabled={controlsDisabled} onChange={(event) => setDraftValue(event.target.value)} onKeyDown={handleEditorKeyDown} />}
                    </div>
                </div>
                <div data-component={`${dataComponent}_editor_actions`} data-slot="editor-actions" className="flex flex-wrap gap-2">
                    <Button data-component={`${dataComponent}_editor_actions_apply`} type="button" size="sm" disabled={controlsDisabled || !valueIsValid} onClick={() => submitValue("set")}>변경 적용</Button>
                    <Button data-component={`${dataComponent}_editor_actions_tentative`} type="button" size="sm" variant="outline" disabled={controlsDisabled || !valueIsValid} onClick={() => submitValue("mark-tentative")}>희망값으로 저장</Button>
                    <Button data-component={`${dataComponent}_editor_actions_clear`} type="button" size="sm" variant="ghost" disabled={controlsDisabled || !isClearableField(selectedField)} onClick={() => { if (isClearableField(selectedField)) emitPatch({ op: "clear", field: selectedField }); }}>값 지우기</Button>
                </div>
                {!valueIsValid && draftValue.trim() !== "" && NUMBER_FIELDS.has(selectedField) && <p data-component={`${dataComponent}_editor_error`} data-slot="error" className="text-xs text-destructive" role="alert">숫자 형식의 값을 입력해 주세요.</p>}
            </div>
            <div data-component={`${dataComponent}_lifecycle`} data-slot="lifecycle" className="mt-3 flex flex-wrap gap-2" aria-label="작업 생명주기 명령">
                <Button data-component={`${dataComponent}_lifecycle_pause`} type="button" size="sm" variant="outline" disabled={controlsDisabled || !canPause} onClick={() => emitCommand("pause")}>일시정지</Button>
                <Button data-component={`${dataComponent}_lifecycle_resume`} type="button" size="sm" variant="outline" disabled={controlsDisabled || !canResume} onClick={() => emitCommand("resume")}>재개</Button>
                <Button data-component={`${dataComponent}_lifecycle_prepare-review`} type="button" size="sm" disabled={controlsDisabled || !canPrepareReview} onClick={() => emitCommand("prepare-review")}>검토 준비</Button>
                <Button data-component={`${dataComponent}_lifecycle_cancel`} type="button" size="sm" variant="destructive" disabled={controlsDisabled || !canCancel} onClick={() => emitCommand("cancel")}>취소</Button>
            </div>
            {(state === "review_ready" || state === "awaiting_approval") && <div data-component={`${dataComponent}_review`} data-slot="review" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" aria-live="polite">
                <p data-component={`${dataComponent}_review_title`} data-slot="title" className="font-semibold">{state === "awaiting_approval" ? "승인 대기 중" : "검토 준비 완료"}</p>
                <p data-component={`${dataComponent}_review_description`} data-slot="description" className="mt-1 text-xs">{task.action ? "아래 승인 카드에서 변경 내용을 확인하고 실행할 수 있습니다." : "변경 내용을 확인한 뒤 검토안을 준비해 주세요."}</p>
            </div>}
        </section>
    );
}

export type TaskSnapshotPartProps = {
    "data-component": string;
    data: TaskSnapshotData;
    task?: AgentTask | null;
    taskBusy?: boolean;
    onPatch?: TaskSnapshotControlsProps["onPatch"];
    onCommand?: TaskSnapshotControlsProps["onCommand"];
};

export function TaskSnapshotPart({ "data-component": dataComponent, data, task, taskBusy = false, onPatch, onCommand }: TaskSnapshotPartProps) {
    const missingCount = data.fieldStatus.filter(({ status }) => status === "missing").length;
    const tentativeCount = data.fieldStatus.filter(({ status }) => status === "tentative").length;
    const isCurrentTaskSnapshot = task?.taskId === data.taskId
        && task.revision === data.revision
        && task.currentSnapshotRef === data.snapshotRef;

    return (
        <Card
            aria-label="작업 초안"
            data-component={dataComponent}
            data-source-component="TaskSnapshotPart"
            data-task-id={data.taskId}
        >
            <CardHeader data-component={`${dataComponent}_header`} data-slot="header" className="p-4">
                <div className="flex items-center justify-between gap-3">
                    <CardTitle data-component={`${dataComponent}_title`} data-slot="title" className="text-base">
                        {CAPABILITY_LABELS[data.capabilityId]}
                    </CardTitle>
                    <Badge
                        data-component={`${dataComponent}_state`}
                        data-slot="state"
                        variant={data.state === "completed" ? "success" : data.state === "failed" || data.state === "cancelled" ? "destructive" : "secondary"}
                    >
                        {TASK_STATE_LABELS[data.state]}
                    </Badge>
                </div>
                <p data-component={`${dataComponent}_revision`} data-slot="revision" className="text-sm text-muted-foreground">
                    초안 버전 {data.revision}
                </p>
            </CardHeader>
            <CardContent data-component={`${dataComponent}_content`} data-slot="content" className="p-4 pt-0">
                <div data-component={`${dataComponent}_field-status`} data-slot="field-status" className="flex flex-wrap gap-2" aria-label="입력 상태">
                    {data.fieldStatus.map(({ field, status }) => (
                        <Badge key={field} data-component={`${dataComponent}_field-status_${field}`} data-slot="field-status-item" variant={status === "missing" ? "warning" : "outline"}>
                            {FIELD_LABELS[field] ?? field} · {FIELD_STATUS_LABELS[status]}
                        </Badge>
                    ))}
                </div>
                {(missingCount > 0 || tentativeCount > 0) && (
                    <p data-component={`${dataComponent}_attention`} data-slot="attention" className="mt-3 text-sm text-muted-foreground">
                        {missingCount > 0 ? `아직 입력되지 않은 항목 ${missingCount}개` : ""}
                        {missingCount > 0 && tentativeCount > 0 ? " · " : ""}
                        {tentativeCount > 0 ? `희망값 ${tentativeCount}개` : ""}
                    </p>
                )}
                {isCurrentTaskSnapshot && task && (onPatch || onCommand) && <TaskSnapshotControls data-component={`${dataComponent}_controls`} task={task} disabled={taskBusy} onPatch={onPatch} onCommand={onCommand} />}
            </CardContent>
        </Card>
    );
}

export type TaskEntitySelectPartProps = {
    "data-component": string;
    data: EntitySelectData;
    task?: AgentTask | null;
    onSelect?: (optionId: string) => void;
    disabled?: boolean;
};

export function TaskEntitySelectPart({ "data-component": dataComponent, data, task, onSelect, disabled = false }: TaskEntitySelectPartProps) {
    const choiceSet = task?.taskId === data.taskId
        ? task.choiceSets.find(({ choiceSetRef }) => choiceSetRef === data.choiceSetRef)
        : undefined;
    const hasCurrentOptions = choiceSet !== undefined
        && data.optionIds.every((optionId) => choiceSet.options.some((option) => option.optionId === optionId));
    const isDisabled = disabled || !hasCurrentOptions;
    const options = data.optionIds.map((optionId, index) => ({
        optionId,
        label: choiceSet?.options.find((option) => option.optionId === optionId)?.label ?? `선택지 ${index + 1}`,
        description: choiceSet?.options.find((option) => option.optionId === optionId)?.description,
    }));

    return (
        <Card data-component={dataComponent} data-source-component="TaskEntitySelectPart" aria-label="작업 대상 선택">
            <CardHeader data-component={`${dataComponent}_header`} data-slot="header" className="p-4">
                <CardTitle data-component={`${dataComponent}_title`} data-slot="title" className="text-base">대상을 선택해 주세요</CardTitle>
            </CardHeader>
            <CardContent data-component={`${dataComponent}_content`} data-slot="content" className="flex flex-wrap gap-2 p-4 pt-0" role="group" aria-label="작업 대상 선택지">
                {options.map(({ optionId, label, description }) => (
                    <Button
                        key={optionId}
                        data-component={`${dataComponent}_option`}
                        data-option-id={optionId}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isDisabled}
                        title={description}
                        onClick={() => onSelect?.(optionId)}
                    >
                        {label}
                    </Button>
                ))}
            </CardContent>
        </Card>
    );
}

export type TaskPatchPartProps = {
    "data-component": string;
    data: TaskPatchData;
};

export function TaskPatchPart({ "data-component": dataComponent, data }: TaskPatchPartProps) {
    return (
        <p data-component={dataComponent} data-source-component="TaskPatchPart" data-task-id={data.taskId} data-event-id={data.eventId} data-slot="task-patch" className="text-sm text-muted-foreground">
            초안이 업데이트되었습니다. 현재 버전 {data.acceptedRevision}을 확인해 주세요.
        </p>
    );
}
