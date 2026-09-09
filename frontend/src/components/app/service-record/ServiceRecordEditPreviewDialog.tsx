"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import type {
    ServiceRecordEditConfirmResponse,
    ServiceRecordEditPreviewResponse,
    ServiceRecordPlannedSession,
} from "@/features/service-records/types";

const SOURCE_COMPONENT = "ServiceRecordEditPreviewDialog";
const DEFAULT_DATA_COMPONENT = "desktop_service-record-admin_edit-preview-dialog";

export interface ServiceRecordEditPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preview: ServiceRecordEditPreviewResponse | null;
    busy?: boolean;
    error?: string | null;
    onConfirm?: () => void | Promise<void>;
    confirmBusy?: boolean;
    confirmError?: string | null;
    confirmResult?: ServiceRecordEditConfirmResponse | null;
    onRefresh?: () => void | Promise<void>;
    "data-component"?: string;
}

function formatDate(value: string | null): string {
    if (!value) return "없음";
    return value.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, "$1.$2.$3");
}

function formatTimestamp(value: string | null): string {
    if (!value) return "없음";
    return value.replace("T", " ").replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
}

function formatEvidence(value: "observed" | "unverified"): string {
    return value === "observed" ? "서버 확인됨" : "확인되지 않음";
}

function formatSignatureTreatment(value: "preserve_existing" | "manual_review"): string {
    return value === "preserve_existing"
        ? "기존 제공기록지 서명과 실제 서명·제출 시각 보존"
        : "서명 보존 근거가 없어 수동 검토 필요";
}

function formatContractStage(value: string | null): string {
    switch (value) {
        case "completed":
            return "완료 계약 · 새 계약과 새 이용자 서명이 필요합니다.";
        case "in_progress":
            return "진행 중 계약 · 실제 문서 필드 확인 후 처리합니다.";
        case "rejected":
            return "반려·만료 계약 · 새 문서 검토가 필요합니다.";
        default:
            return "계약 상태 확인 필요 · 수동 검토가 필요합니다.";
    }
}

function formatConfirmDocumentStatus(value: ServiceRecordEditConfirmResponse["documentStatus"]): string {
    switch (value) {
        case "not_required": return "전자문서 처리 불필요";
        case "waiting_for_completion": return "전자문서 처리 대기 중";
        case "capability_unverified": return "전자문서 처리 근거 확인 필요";
        case "pending": return "전자문서 처리 중";
    }
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
    onConfirm,
    confirmBusy = false,
    confirmError = null,
    confirmResult = null,
    onRefresh,
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
                description="저장된 관리자 초안이 적용될 때의 날짜, 배정 영향, 내용 변경을 확인한 뒤 수정 확정을 처리합니다."
                contentClassName="max-h-[min(72vh,720px)] overflow-y-auto flex flex-col gap-5"
                footer={(
                    <div data-component={`${dataComponent}_actions`} data-slot="actions" className="flex flex-wrap justify-end gap-2">
                        {preview && !hasBlockingReasons && onConfirm ? (
                            <Button
                                type="button"
                                variant="positive"
                                data-component={`${dataComponent}_actions_confirm`}
                                disabled={busy || confirmBusy || Boolean(confirmResult)}
                                onClick={() => { void onConfirm(); }}
                            >
                                {confirmBusy ? "확정 처리 중…" : confirmResult ? "수정 확정됨" : "수정 확정"}
                            </Button>
                        ) : null}
                        <Button
                            type="button"
                            variant="neutral"
                            data-component={`${dataComponent}_actions_close`}
                            disabled={busy || confirmBusy}
                            onClick={() => onOpenChange(false)}
                        >
                            닫기
                        </Button>
                    </div>
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
                    {confirmError ? (
                        <Alert variant="destructive" data-component={`${dataComponent}_content_confirm-error`} data-slot="confirm-error">
                            <AlertTitle>수정 확정을 완료하지 못했습니다.</AlertTitle>
                            <AlertDescription>
                                <p>{confirmError}</p>
                                {onRefresh && confirmError.includes("오래되어") ? (
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="neutral"
                                        data-component={`${dataComponent}_content_confirm-error_refresh`}
                                        onClick={() => { void onRefresh(); }}
                                    >
                                        최신 미리보기
                                    </Button>
                                ) : null}
                            </AlertDescription>
                        </Alert>
                    ) : null}
                    {confirmResult ? (
                        <Alert variant="success" data-component={`${dataComponent}_content_confirmed`} data-slot="confirmed">
                            <AlertTitle>수정 확정됨</AlertTitle>
                            <AlertDescription>
                                {confirmResult.status === "no_changes" ? "변경 없이 초안이 확정되었습니다." : "관리자 수정본이 확정되었습니다."}
                                <br />{formatConfirmDocumentStatus(confirmResult.documentStatus)} · 확정 시각 {formatTimestamp(confirmResult.confirmedAt)}
                            </AlertDescription>
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

                            <section data-component={`${dataComponent}_content_signature-metadata`} data-slot="signature-metadata" className="flex flex-col gap-2">
                                <h3 className="text-sm font-semibold text-v3-dark">제공기록지 서명 메타데이터</h3>
                                <p className="text-sm text-v3-text-muted">처리: {formatSignatureTreatment(preview.signatureMetadata.treatment)}</p>
                                <p className="text-sm text-v3-text-muted">근거: {formatEvidence(preview.signatureMetadata.evidence)}</p>
                                <p className="text-xs text-v3-text-muted">이 항목은 제공기록지 서명만 다루며 계약서 서명을 재사용하지 않습니다.</p>
                                {preview.signatureMetadata.sessions.length > 0 ? (
                                    <ul className="list-disc space-y-1 pl-5 text-sm text-v3-text-muted">
                                        {preview.signatureMetadata.sessions.map((session) => (
                                            <li key={session.sessionIndex}>
                                                {session.sessionIndex}회차 · {session.hasSignature ? "서명 있음" : "서명 없음"}
                                                · 서명 시각 {formatTimestamp(session.signedAt)}
                                                · 제출 시각 {formatTimestamp(session.submittedAt)}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p data-slot="none" className="text-sm text-v3-text-muted">회차별 서명 메타데이터가 없습니다.</p>
                                )}
                            </section>

                            <section data-component={`${dataComponent}_content_document-scope`} data-slot="document-scope" className="flex flex-col gap-2">
                                <h3 className="text-sm font-semibold text-v3-dark">전자문서 영향 범위</h3>
                                <p className="text-sm text-v3-text-muted">근거: {formatEvidence(preview.documentScope.evidence)}</p>
                                <p className="text-sm text-v3-text-muted">계약 상태: {formatContractStage(preview.documentScope.contract.stage)}</p>
                                <p className="text-sm text-v3-text-muted">
                                    현재 계약 문서: {preview.documentScope.contract.currentDocumentId ?? "확인되지 않음"}
                                </p>
                                <p className="text-sm text-v3-text-muted">
                                    제공기록지 문서: {preview.documentScope.serviceRecordSnapshot.documentIds.length > 0
                                        ? preview.documentScope.serviceRecordSnapshot.documentIds.join(", ")
                                        : "확인되지 않음"}
                                </p>
                                <p className="text-sm text-v3-text-muted">
                                    문서·버전 범위: snapshot {preview.documentScope.serviceRecordSnapshot.snapshotVersion ?? "확인되지 않음"}
                                    · 청크 {preview.documentScope.serviceRecordSnapshot.chunks.length}개
                                    · 현재 수정본 {preview.documentScope.currentRevision.revisionNumber ?? "확인되지 않음"}
                                    · 양식 {preview.documentScope.form.version ?? "확인되지 않음"}
                                </p>
                                <p className="text-xs text-v3-text-muted">
                                    날짜 표시 변경 범위와 문서 재생성 범위는 서버가 확인한 값만 표시합니다.
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
