"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import type { ServiceRecordEditPreviewResponse, ServiceRecordPlannedSession } from "@/features/service-records/types";

const SOURCE_COMPONENT = "ServiceRecordEditPreviewDialog";
const DEFAULT_DATA_COMPONENT = "desktop_service-record-admin_edit-preview-dialog";

export interface ServiceRecordEditPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preview: ServiceRecordEditPreviewResponse | null;
    busy?: boolean;
    error?: string | null;
    "data-component"?: string;
}

function formatDate(value: string | null): string {
    if (!value) return "없음";
    return value.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, "$1.$2.$3");
}

function SessionDateList({
    dataComponent,
    sessions,
}: {
    dataComponent: string;
    sessions: ServiceRecordPlannedSession[];
}) {
    if (sessions.length === 0) {
        return <p data-component={`${dataComponent}_empty`} data-slot="empty">계산된 회차가 없습니다.</p>;
    }
    return (
        <ol data-component={dataComponent} data-slot="session-dates" className="flex flex-col gap-2">
            {sessions.map((session) => (
                <li
                    data-component={`${dataComponent}_item-${session.sessionIndex}`}
                    data-slot="session-date"
                    className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm"
                    key={`${session.sessionIndex}-${session.assignmentId}`}
                >
                    <span>{session.sessionIndex}회차</span>
                    <span className="font-semibold text-v3-dark">{formatDate(session.serviceDate)}</span>
                </li>
            ))}
        </ol>
    );
}

export function ServiceRecordEditPreviewDialog({
    open,
    onOpenChange,
    preview,
    busy = false,
    error = null,
    "data-component": canonicalDataComponent,
}: ServiceRecordEditPreviewDialogProps) {
    const dataComponent = canonicalDataComponent ?? DEFAULT_DATA_COMPONENT;
    const blockingReasons = preview?.blockingReasons ?? [];
    const hasBlockingReasons = blockingReasons.length > 0;
    const contentChanges = preview?.contentChanges ?? {
        headerChanged: false,
        changedSessionIndexes: [],
    };

    return (
        <Dialog open={open} onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}>
            <FormDialogShell
                data-component={dataComponent}
                size="form"
                title="초안 변경 미리보기"
                description="저장된 관리자 초안이 적용될 때의 날짜, 배정 영향, 내용 변경을 확인합니다. 이 화면에서는 최종 확정하지 않습니다."
                contentClassName="max-h-[min(72vh,720px)] overflow-y-auto flex flex-col gap-5"
                footer={(
                    <Button
                        type="button"
                        variant="neutral"
                        data-component={`${dataComponent}_actions_close`}
                        disabled={busy}
                        onClick={() => onOpenChange(false)}
                    >
                        닫기
                    </Button>
                )}
            >
                <div data-component={`${dataComponent}_content`} data-source-component={SOURCE_COMPONENT} className="flex flex-col gap-5">
                    {busy ? (
                        <p data-component={`${dataComponent}_content_loading`} data-slot="loading" role="status">미리보기를 불러오는 중…</p>
                    ) : null}
                    {error ? (
                        <Alert variant="destructive" data-component={`${dataComponent}_content_error`} data-slot="error">
                            <AlertTitle>미리보기를 불러오지 못했습니다.</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    ) : null}
                    {!busy && !error && preview ? (
                        <>
                            <div data-component={`${dataComponent}_content_meta`} data-slot="meta" className="flex flex-wrap gap-2">
                                <Badge variant="secondary">초안 버전 {preview.draftVersion}</Badge>
                                {preview.requiredSessionCount ? <Badge variant="secondary">총 {preview.requiredSessionCount}회차</Badge> : null}
                                {preview.calendarVersion ? <Badge variant="secondary">달력 {preview.calendarVersion}</Badge> : null}
                            </div>

                            {hasBlockingReasons ? (
                                <Alert variant="warning" data-component={`${dataComponent}_content_blocking-reasons`} data-slot="blocking-reasons">
                                    <AlertTitle>현재 변경을 적용할 수 없습니다.</AlertTitle>
                                    <AlertDescription>
                                        <ul className="list-disc space-y-1 pl-5">
                                            {blockingReasons.map((reason, index) => (
                                                <li key={`${reason.code}-${reason.sessionIndex ?? "all"}-${index}`}>
                                                    {reason.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            <section data-component={`${dataComponent}_content_dates`} data-slot="dates" className="grid gap-4 md:grid-cols-2">
                                <div data-component={`${dataComponent}_content_dates_before`} data-slot="before" className="flex flex-col gap-2">
                                    <h3 className="text-sm font-semibold text-v3-dark">변경 전</h3>
                                    <p className="text-sm text-v3-text-muted">{formatDate(preview.before.startDate)} ~ {formatDate(preview.before.endDate)}</p>
                                    <SessionDateList dataComponent={`${dataComponent}_content_dates_before_sessions`} sessions={preview.before.sessions} />
                                </div>
                                <div data-component={`${dataComponent}_content_dates_after`} data-slot="after" className="flex flex-col gap-2">
                                    <h3 className="text-sm font-semibold text-v3-dark">변경 후</h3>
                                    <p className="text-sm text-v3-text-muted">{formatDate(preview.after.startDate)} ~ {formatDate(preview.after.endDate)}</p>
                                    <SessionDateList dataComponent={`${dataComponent}_content_dates_after_sessions`} sessions={preview.after.sessions} />
                                </div>
                            </section>

                            <section data-component={`${dataComponent}_content_assignments`} data-slot="assignments" className="flex flex-col gap-2">
                                <h3 className="text-sm font-semibold text-v3-dark">배정 영향</h3>
                                {preview.impactedAssignments.length > 0 ? (
                                    <ul className="list-disc space-y-1 pl-5 text-sm text-v3-text-muted">
                                        {preview.impactedAssignments.map((assignmentId) => <li key={assignmentId}>{assignmentId}</li>)}
                                    </ul>
                                ) : (
                                    <p data-slot="none" className="text-sm text-v3-text-muted">변경되는 배정이 없습니다.</p>
                                )}
                            </section>

                            <section data-component={`${dataComponent}_content_changes`} data-slot="content-changes" className="flex flex-col gap-2">
                                <h3 className="text-sm font-semibold text-v3-dark">내용 변경</h3>
                                <p className="text-sm text-v3-text-muted">기본정보: {contentChanges.headerChanged ? "변경됨" : "변경 없음"}</p>
                                <p className="text-sm text-v3-text-muted">
                                    기록 회차: {contentChanges.changedSessionIndexes.length > 0
                                        ? contentChanges.changedSessionIndexes.map((sessionIndex) => `${sessionIndex}회차`).join(", ")
                                        : "변경 없음"}
                                </p>
                            </section>
                        </>
                    ) : null}
                    {!busy && !error && !preview ? (
                        <p data-component={`${dataComponent}_content_empty`} data-slot="empty">미리보기 데이터가 없습니다.</p>
                    ) : null}
                </div>
            </FormDialogShell>
        </Dialog>
    );
}
