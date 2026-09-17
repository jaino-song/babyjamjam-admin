"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { AgentDataParts, AgentTask } from "@babyjamjam/shared";

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

export type TaskSnapshotPartProps = {
    "data-component": string;
    data: TaskSnapshotData;
};

export function TaskSnapshotPart({ "data-component": dataComponent, data }: TaskSnapshotPartProps) {
    const missingCount = data.fieldStatus.filter(({ status }) => status === "missing").length;
    const tentativeCount = data.fieldStatus.filter(({ status }) => status === "tentative").length;

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
