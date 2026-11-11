"use client";

import { X } from "lucide-react";
import { REVIEW_EMPTY_LABEL } from "@babyjamjam/service-record-ui";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type {
    ServiceRecordEditConfirmResponse,
    ServiceRecordEditPreviewImpactedAssignment,
    ServiceRecordEditPreviewResponse,
} from "@/features/service-records/types";

import type { PendingChangeRow, PendingSessionChange } from "./pending-session-changes";
import { describeScheduleBlockingReasons } from "./service-record-blocking-reasons";

const SOURCE_COMPONENT = "ServiceRecordEditPreviewDialog";
const DEFAULT_DATA_COMPONENT = "desktop_service-record-admin_edit-preview-dialog";

export interface ServiceRecordEditPreviewDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    preview: ServiceRecordEditPreviewResponse | null;
    busy?: boolean;
    sessionChanges?: ReadonlyArray<PendingSessionChange>;
    headerChanges?: ReadonlyArray<PendingChangeRow>;
    error?: string | null;
    onConfirm?: () => void | Promise<void>;
    confirmBusy?: boolean;
    confirmError?: string | null;
    /** Registered failure status of `confirmError`; gates the stale-retry affordance. */
    confirmErrorStatus?: number | null;
    confirmResult?: ServiceRecordEditConfirmResponse | null;
    onRefresh?: () => void | Promise<void>;
    "data-component"?: string;
}

function formatDate(value: string | null): string {
    if (!value) return "없음";
    return value.replace(/^(\d{4})-(\d{2})-(\d{2}).*$/, "$1.$2.$3");
}

function formatImpactedAssignment(assignment: ServiceRecordEditPreviewImpactedAssignment): string {
    const name = assignment.employeeName?.trim() || "이름 없는 관리사";
    if (!assignment.startDate && !assignment.endDate) return name;
    return `${name} · ${formatDate(assignment.startDate)} ~ ${formatDate(assignment.endDate)}`;
}

function formatTimestamp(value: string | null): string {
    if (!value) return "없음";
    return value.replace("T", " ").replace(/\.\d{3}Z$/, "").replace(/Z$/, "");
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

function formatSessionDate(value: string | undefined): string {
    if (!value) return REVIEW_EMPTY_LABEL;
    const iso = value.slice(0, 10);
    const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
    return `${iso.slice(5).replace("-", ".")}(${"일월화수목금토"[weekday]})`;
}

type PreviewChangeRow = PendingChangeRow & { afterOnly?: boolean };

function ChangeRows({ rows, dataComponent }: { rows: ReadonlyArray<PreviewChangeRow>; dataComponent: string }) {
    return (
        <div data-component={dataComponent} data-slot="change-rows" data-source-component="ChangeRows" className="flex flex-col gap-[calc(6px*var(--glint-ui-scale,1))]">
            {rows.map((row) => {
                const rowId = row.key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
                return (
                    <div key={row.key} role="group" data-component={`${dataComponent}_${rowId}`} data-slot="change-row"
                        className="flex min-w-0 justify-between gap-[calc(12px*var(--glint-ui-scale,1))] rounded-[calc(10px*var(--glint-ui-scale,1))] border border-v3-border! bg-v3-dim-white px-[calc(10px*var(--glint-ui-scale,1))] py-[calc(8px*var(--glint-ui-scale,1))] text-[length:calc(16px*var(--glint-ui-scale,1))] leading-[calc(24px*var(--glint-ui-scale,1))]">
                        <span data-component={`${dataComponent}_${rowId}_label`} data-slot="change-label" className="shrink-0 text-v3-text-muted">{row.label}</span>
                        <span data-component={`${dataComponent}_${rowId}_value`} data-slot="change-value" className="min-w-0 text-right font-bold break-keep [overflow-wrap:anywhere]">
                            {!row.afterOnly ? <>
                                <span data-component={`${dataComponent}_${rowId}_value_before`} data-slot="before" className="text-v3-text-muted font-medium">{row.before || REVIEW_EMPTY_LABEL}</span>
                                {" → "}
                            </> : null}
                            <span data-component={`${dataComponent}_${rowId}_value_after`} data-slot="after" className="text-v3-burgundy">{row.after || REVIEW_EMPTY_LABEL}</span>
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

export function ServiceRecordEditPreviewDialog({
    open,
    onOpenChange,
    preview,
    busy = false,
    sessionChanges = [],
    headerChanges = [],
    error = null,
    onConfirm,
    confirmBusy = false,
    confirmError = null,
    confirmErrorStatus = null,
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
    // The id list is authoritative; details only label it. An id without details
    // (older payloads) shows a generic name rather than the raw id.
    const impactedAssignments: ServiceRecordEditPreviewImpactedAssignment[] = (preview?.impactedAssignments ?? []).map((assignmentId) =>
        preview?.impactedAssignmentDetails?.find((detail) => detail.assignmentId === assignmentId)
            ?? { assignmentId, employeeName: null, startDate: null, endDate: null });

    const loading = busy && preview === null;
    const closeDisabled = busy || confirmBusy;
    const sessionIndexes = new Set(sessionChanges.map((change) => change.sessionIndex));
    for (const index of contentChanges.changedSessionIndexes) sessionIndexes.add(index);
    const beforeDates = new Map(preview?.before.sessions.map((session) => [session.sessionIndex, session.serviceDate]) ?? []);
    const afterDates = new Map(preview?.after.sessions.map((session) => [session.sessionIndex, session.serviceDate]) ?? []);
    const movedSessionIndexes = new Set<number>();
    for (const index of new Set([...beforeDates.keys(), ...afterDates.keys()])) {
        if (beforeDates.get(index) !== afterDates.get(index)) {
            movedSessionIndexes.add(index);
            sessionIndexes.add(index);
        }
    }
    const movedAssignmentIds = new Set(preview?.after.sessions
        .filter((session) => movedSessionIndexes.has(session.sessionIndex))
        .map((session) => session.assignmentId) ?? []);
    const movedAssignments = impactedAssignments.filter((assignment) => movedAssignmentIds.has(assignment.assignmentId));
    const groups = [...sessionIndexes].sort((left, right) => left - right).map((sessionIndex) => {
        const rows: PreviewChangeRow[] = [
            ...(beforeDates.get(sessionIndex) !== afterDates.get(sessionIndex) ? [{
                key: "service-date", label: "서비스 제공일",
                before: formatSessionDate(beforeDates.get(sessionIndex)), after: formatSessionDate(afterDates.get(sessionIndex)),
            }] : []),
            ...(sessionChanges.find((change) => change.sessionIndex === sessionIndex)?.rows ?? []),
        ];
        if (rows.length === 0 && contentChanges.changedSessionIndexes.includes(sessionIndex)) {
            rows.push({ key: "record-content", label: "기록 내용", before: "", after: "변경됨", afterOnly: true });
        }
        return { sessionIndex, rows };
    }).filter((group) => group.rows.length > 0);
    const periodChanged = preview !== null && (preview.before.startDate !== preview.after.startDate
        || preview.before.endDate !== preview.after.endDate);
    // Match confirm's contract/receipt operations; snapshot jobs alone need no operator section.
    const contractAffected = periodChanged && (preview.documentScope.evidence !== "observed"
        || preview.documentScope.contract.currentDocumentId !== null);
    const receipt = preview?.documentScope.receipt;
    const receiptAffected = periodChanged && (receipt?.evidence !== "observed" || receipt.tokenIds.length > 0);
    const documentsAffected = contractAffected || receiptAffected;
    const affectedSignatureSessions = preview?.signatureMetadata.sessions.filter((session) => session.hasSignature
        && (sessionIndexes.has(session.sessionIndex) || contentChanges.changedSessionIndexes.includes(session.sessionIndex))) ?? [];
    const signatureReviewRequired = preview?.signatureMetadata.treatment === "manual_review" && affectedSignatureSessions.length > 0;
    const hasPreviewChanges = groups.length > 0 || contentChanges.headerChanged || movedAssignments.length > 0
        || signatureReviewRequired || documentsAffected;

    return (
        <Sheet open={open} onOpenChange={(nextOpen) => !closeDisabled && onOpenChange(nextOpen)}>
            <SheetContent side="bottom" data-component={dataComponent} data-source-component={SOURCE_COMPONENT}
                className="h-[86dvh] max-h-[94dvh] min-w-0 gap-0 overflow-hidden rounded-t-[calc(28px*var(--glint-ui-scale,1))] bg-white p-0 sm:h-auto sm:max-h-[86dvh] sm:left-1/2 sm:right-auto sm:bottom-6 sm:w-[calc(480px*var(--glint-ui-scale,1))] sm:max-w-[calc(100vw-32px)] sm:-translate-x-1/2 sm:rounded-[calc(28px*var(--glint-ui-scale,1))]"
                onEscapeKeyDown={(event) => { if (closeDisabled) event.preventDefault(); }}
                onInteractOutside={(event) => { if (closeDisabled) event.preventDefault(); }}>
                <div data-component={`${dataComponent}_handle`} data-slot="sheet-handle" aria-hidden="true"
                    className="mx-auto mt-[calc(12px*var(--glint-ui-scale,1))] h-[calc(4px*var(--glint-ui-scale,1))] w-[calc(36px*var(--glint-ui-scale,1))] shrink-0 rounded-full bg-v3-border" />
                <SheetHeader data-component={`${dataComponent}_header`}
                    className="gap-[calc(2px*var(--glint-ui-scale,1))] px-[calc(22px*var(--glint-ui-scale,1))] pb-[calc(8px*var(--glint-ui-scale,1))] pt-[calc(12px*var(--glint-ui-scale,1))] pr-[calc(64px*var(--glint-ui-scale,1))]">
                    <SheetTitle data-component={`${dataComponent}_header_title`} className="text-[length:calc(24px*var(--glint-ui-scale,1))] leading-[calc(32px*var(--glint-ui-scale,1))] font-bold text-v3-dark">수정 내용 확인</SheetTitle>
                    <SheetDescription data-component={`${dataComponent}_header_description`} className="text-[length:calc(14px*var(--glint-ui-scale,1))] leading-[calc(20px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">
                        {loading ? "바뀌는 내용을 확인하고 있어요. 창을 닫거나 새로고침하지 마세요." : "확인 후 수정 확정을 눌러주세요."}
                    </SheetDescription>
                    <Button type="button" variant="ghost" size="icon" aria-label="닫기" disabled={closeDisabled}
                        data-component={`${dataComponent}_header_close`} onClick={() => onOpenChange(false)}
                        className="absolute right-[calc(8px*var(--glint-ui-scale,1))] top-[calc(12px*var(--glint-ui-scale,1))] size-[calc(44px*var(--glint-ui-scale,1))] border-0 text-v3-text-muted">
                        <X data-component={`${dataComponent}_header_close_icon`} aria-hidden="true" />
                    </Button>
                </SheetHeader>
                <div data-component={`${dataComponent}_content`} data-slot="content" className="flex min-h-0 flex-1 flex-col gap-[calc(14px*var(--glint-ui-scale,1))] overflow-y-auto px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(16px*var(--glint-ui-scale,1))]">
                    {loading ? (
                        <div data-component={`${dataComponent}_content_loading`} data-slot="loading">
                            <p data-component={`${dataComponent}_content_loading_status`} data-slot="loading-status" role="status" aria-busy="true"
                                className="flex items-center gap-[calc(8px*var(--glint-ui-scale,1))] px-[calc(6px*var(--glint-ui-scale,1))] pt-[calc(14px*var(--glint-ui-scale,1))] pb-[calc(18px*var(--glint-ui-scale,1))] text-[length:calc(16px*var(--glint-ui-scale,1))] leading-[calc(24px*var(--glint-ui-scale,1))] font-semibold text-v3-primary">
                                <Spinner data-component={`${dataComponent}_content_loading_status_spinner`} size="sm" aria-hidden="true" />수정사항 정리하는 중...
                            </p>
                            <Skeleton data-component={`${dataComponent}_content_loading_skeleton-1`} aria-hidden="true" className="mb-[calc(12px*var(--glint-ui-scale,1))] h-[calc(22px*var(--glint-ui-scale,1))] w-3/5 rounded-lg! bg-v3-dim-white" />
                            <Skeleton data-component={`${dataComponent}_content_loading_skeleton-2`} aria-hidden="true" className="mb-[calc(8px*var(--glint-ui-scale,1))] h-[calc(12px*var(--glint-ui-scale,1))] w-[90%] rounded-lg! bg-v3-dim-white" />
                            <Skeleton data-component={`${dataComponent}_content_loading_skeleton-3`} aria-hidden="true" className="mb-[calc(24px*var(--glint-ui-scale,1))] h-[calc(12px*var(--glint-ui-scale,1))] w-[70%] rounded-lg! bg-v3-dim-white" />
                            <Skeleton data-component={`${dataComponent}_content_loading_skeleton-4`} aria-hidden="true" className="mb-[calc(10px*var(--glint-ui-scale,1))] h-[calc(14px*var(--glint-ui-scale,1))] w-[28%] rounded-lg! bg-v3-dim-white" />
                            <Skeleton data-component={`${dataComponent}_content_loading_skeleton-5`} aria-hidden="true" className="mb-[calc(16px*var(--glint-ui-scale,1))] h-[calc(50px*var(--glint-ui-scale,1))] w-full rounded-xl! bg-v3-dim-white" />
                            <Skeleton data-component={`${dataComponent}_content_loading_skeleton-6`} aria-hidden="true" className="h-[calc(46px*var(--glint-ui-scale,1))] w-full rounded-full bg-v3-dim-white" />
                        </div>
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
                                {/* Stale (409) is discriminated by the registered
                                    status, never by matching message text. */}
                                {onRefresh && confirmErrorStatus === 409 ? (
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
                            {hasBlockingReasons ? (
                                <Alert variant="warning" data-component={`${dataComponent}_content_blocking-reasons`} data-slot="blocking-reasons">
                                    <AlertTitle>현재 변경을 적용할 수 없습니다.</AlertTitle>
                                    <AlertDescription>
                                        <ul className="list-disc space-y-1 pl-5">
                                            {describeScheduleBlockingReasons(blockingReasons).map((reason) => (
                                                <li key={reason.key}>
                                                    {reason.label}
                                                </li>
                                            ))}
                                        </ul>
                                    </AlertDescription>
                                </Alert>
                            ) : null}

                            {!hasPreviewChanges && !hasBlockingReasons ? (
                                <p data-component={`${dataComponent}_content_no-changes`} data-slot="no-changes" className="text-sm text-v3-text-muted">변경된 내용이 없어요.</p>
                            ) : null}
                            {groups.map((group) => (
                                <section key={group.sessionIndex} data-component={`${dataComponent}_content_dates_session-${group.sessionIndex}`} data-slot="session-change"
                                    className="border-[1.5px] border-v3-primary! rounded-[calc(14px*var(--glint-ui-scale,1))] bg-white px-[calc(12px*var(--glint-ui-scale,1))] pt-[calc(10px*var(--glint-ui-scale,1))] pb-[calc(12px*var(--glint-ui-scale,1))] first:mt-[calc(14px*var(--glint-ui-scale,1))]">
                                    <h3 data-component={`${dataComponent}_content_dates_session-${group.sessionIndex}_title`} data-slot="session-heading"
                                        className="mb-[calc(6px*var(--glint-ui-scale,1))] w-fit rounded-[calc(6px*var(--glint-ui-scale,1))] bg-v3-primary-light px-[calc(7px*var(--glint-ui-scale,1))] py-[calc(2px*var(--glint-ui-scale,1))] text-[length:calc(12px*var(--glint-ui-scale,1))] leading-[calc(16px*var(--glint-ui-scale,1))] font-extrabold text-v3-primary">{group.sessionIndex}회차</h3>
                                    <ChangeRows dataComponent={`${dataComponent}_content_dates_session-${group.sessionIndex}_rows`} rows={group.rows} />
                                </section>
                            ))}
                            {contentChanges.headerChanged ? (
                                <section data-component={`${dataComponent}_content_changes`} data-slot="content-changes" className="flex flex-col gap-2">
                                    <h3 data-component={`${dataComponent}_content_changes_title`} data-slot="title" className="text-sm font-semibold text-v3-dark">기본정보</h3>
                                    <ChangeRows dataComponent={`${dataComponent}_content_changes_rows`} rows={headerChanges} />
                                </section>
                            ) : null}
                            {movedAssignments.length > 0 ? (
                                <section data-component={`${dataComponent}_content_assignments`} data-slot="assignments" className="flex flex-col gap-2">
                                    <h3 data-component={`${dataComponent}_content_assignments_title`} data-slot="title" className="text-sm font-semibold text-v3-dark">배정 영향</h3>
                                    <ul data-component={`${dataComponent}_content_assignments_list`} data-slot="assignments-list" className="list-disc space-y-1 pl-5 text-sm text-v3-text-muted">
                                        {movedAssignments.map((assignment) => (
                                            <li key={assignment.assignmentId} data-component={`${dataComponent}_content_assignments_item`} data-slot="assignment-item">{formatImpactedAssignment(assignment)}</li>
                                        ))}
                                    </ul>
                                </section>
                            ) : null}
                            {signatureReviewRequired ? (
                                <section data-component={`${dataComponent}_content_signature-metadata`} data-slot="signature-metadata" className="flex flex-col gap-2">
                                    <h3 data-component={`${dataComponent}_content_signature-metadata_title`} data-slot="title" className="text-sm font-semibold text-v3-dark">서명</h3>
                                    <ul data-component={`${dataComponent}_content_signature-metadata_sessions`} data-slot="signature-sessions" className="list-disc space-y-1 pl-5 text-sm text-v3-text-muted">
                                        {affectedSignatureSessions.map((session) => (
                                            <li key={session.sessionIndex} data-component={`${dataComponent}_content_signature-metadata_sessions_item-${session.sessionIndex}`} data-slot="signature-session">
                                                {session.sessionIndex}회차 · 서명 보존 근거가 없어 수동 검토 필요
                                            </li>
                                        ))}
                                    </ul>
                                </section>
                            ) : null}
                            {documentsAffected ? (
                                <section data-component={`${dataComponent}_content_document-scope`} data-slot="document-scope" className="flex flex-col gap-2">
                                    <h3 data-component={`${dataComponent}_content_document-scope_title`} data-slot="title" className="text-sm font-semibold text-v3-dark">전자문서</h3>
                                    {contractAffected ? (
                                        <p data-component={`${dataComponent}_content_document-scope_contract`} data-slot="contract" className="text-sm text-v3-text-muted">{formatContractStage(preview.documentScope.contract.stage)}</p>
                                    ) : null}
                                    {receiptAffected ? (
                                        <p data-component={`${dataComponent}_content_document-scope_receipt`} data-slot="receipt" className="text-sm text-v3-text-muted">영수증 · 변경된 서비스 기간에 맞춰 처리가 필요합니다.</p>
                                    ) : null}
                                </section>
                            ) : null}
                        </>
                    ) : null}
                    {!busy && !error && !preview ? (
                        <p data-component={`${dataComponent}_content_empty`} data-slot="empty">미리보기 데이터가 없습니다.</p>
                    ) : null}
                </div>
                <div data-component={`${dataComponent}_actions`} data-slot="actions"
                    className="flex shrink-0 gap-[calc(8px*var(--glint-ui-scale,1))] border-t border-v3-border px-[calc(16px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(16px*var(--glint-ui-scale,1)+env(safe-area-inset-bottom))] [&>*]:flex-1">
                    <Button type="button" variant="outline" data-component={`${dataComponent}_actions_close`} disabled={closeDisabled}
                        className="h-[calc(46px*var(--glint-ui-scale,1))] rounded-full text-v3-primary text-[length:calc(16px*var(--glint-ui-scale,1))] leading-[calc(24px*var(--glint-ui-scale,1))]" onClick={() => onOpenChange(false)}>닫기</Button>
                    {loading || (preview && !hasBlockingReasons && onConfirm) ? (
                        <Button type="button" variant="positive" data-component={`${dataComponent}_actions_confirm`}
                            className="h-[calc(46px*var(--glint-ui-scale,1))] rounded-full text-[length:calc(16px*var(--glint-ui-scale,1))] leading-[calc(24px*var(--glint-ui-scale,1))]"
                            disabled={busy || confirmBusy || Boolean(confirmResult)} onClick={() => { void onConfirm?.(); }}>
                            {loading ? <Spinner data-component={`${dataComponent}_actions_confirm_spinner`} size="sm" aria-hidden="true" /> : null}
                            {loading ? "확인 중…" : confirmBusy ? "확정 처리 중…" : confirmResult ? "수정 확정됨" : "수정 확정"}
                        </Button>
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}
