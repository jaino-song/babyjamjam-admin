"use client";

import { useMemo, type ReactNode } from "react";
import {
    Baby,
    ChevronDown,
    ClipboardList,
    FileSignature,
    Link2,
} from "lucide-react";

import { DetailEmptyState, InfoRow } from "@/components/app/v3";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { calcEndDateBusinessDays } from "@/lib/date/business-days";
import { cn } from "@/lib/utils";
import {
    SERVICE_RECORD_FORM_LAYOUT,
    SERVICE_RECORD_LAYOUT_ANSWER_KEYS,
    type ServiceRecordFieldDescriptor,
} from "@/features/service-records/constants/form-layout";
import { useSendServiceRecordLink } from "@/features/service-records/hooks/use-service-records";
import type {
    ServiceRecordAssignment,
    ServiceRecordLinkStatus,
    ServiceRecordOverview,
    ServiceRecordSession,
    SignatureDocStatus,
} from "@/features/service-records/types";

interface ClientServiceRecordsTabProps {
    overview?: ServiceRecordOverview;
    clientId: number | null;
    isLoading: boolean;
    isError: boolean;
}

interface SessionSlot {
    sessionIndex: number;
    record: ServiceRecordSession | null;
    expectedDate: string | null;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"] as const;
const LINK_STATUS_META: Record<ServiceRecordLinkStatus, {
    label: string;
    variant: "neutral" | "primary" | "success" | "warning" | "danger";
}> = {
    none: { label: "발송 전", variant: "neutral" },
    scheduled: { label: "발송 예약", variant: "primary" },
    sent: { label: "발송됨", variant: "success" },
    failed: { label: "발송 실패", variant: "danger" },
    canceled: { label: "발송 취소", variant: "neutral" },
};

export function ClientServiceRecordsTab({
    overview,
    clientId,
    isLoading,
    isError,
}: ClientServiceRecordsTabProps) {
    const { toast } = useToast();
    const sendLinkMutation = useSendServiceRecordLink();
    const assignments = overview?.assignments ?? [];

    const handleSendLink = async (assignment: ServiceRecordAssignment) => {
        const isResend = assignment.link.status === "sent" || assignment.link.status === "failed";
        if (
            isResend
            && !window.confirm("재전송 시 새 링크가 발급되며 기존 링크는 사용할 수 없게 됩니다. 계속할까요?")
        ) {
            return;
        }

        try {
            await sendLinkMutation.mutateAsync({
                scheduleId: assignment.scheduleId,
                clientId: clientId ?? undefined,
            });
            toast({ description: "제공기록지 링크를 발송했습니다." });
        } catch (error) {
            toast({
                description: getErrorDescription(error),
                variant: "destructive",
            });
        }
    };

    if (clientId === null) {
        return (
            <DetailEmptyState
                name="clients-detail-service-records-empty"
                message="고객 정보가 없어 제공기록지를 조회할 수 없습니다"
            />
        );
    }

    if (isLoading) {
        return <ClientServiceRecordsSkeleton />;
    }

    if (isError) {
        return (
            <div
                data-component="clients-detail-service-records-error"
                className="py-12 text-center text-[calc(13px*var(--v3-ui-scale,1))] text-v3-text-muted"
            >
                제공기록지 정보를 불러오지 못했습니다
            </div>
        );
    }

    if (assignments.length === 0) {
        return (
            <DetailEmptyState
                name="clients-detail-service-records-empty"
                message="제공기록지 배정 정보가 없습니다"
            />
        );
    }

    return (
        <div data-component="clients-detail-service-records" className="space-y-[calc(16px*var(--v3-ui-scale,1))]">
            {assignments.map((assignment, index) => (
                <div
                    key={assignment.scheduleId}
                    data-component="clients-detail-service-records-assignment"
                    className="space-y-[calc(16px*var(--v3-ui-scale,1))]"
                >
                    {assignments.length > 1 && (
                        <div
                            data-component="clients-detail-service-records-assignment-period"
                            className="flex items-center gap-[calc(10px*var(--v3-ui-scale,1))] text-[calc(11.5px*var(--v3-ui-scale,1))] font-semibold text-v3-text-muted"
                        >
                            <span className="h-px flex-1 bg-v3-border" />
                            <span>배정 기간 {formatDateKo(assignment.startDate)} - {formatDateKo(assignment.endDate)}</span>
                            <span className="h-px flex-1 bg-v3-border" />
                        </div>
                    )}
                    <LinkStatusCard
                        assignment={assignment}
                        isPending={sendLinkMutation.isPending
                            && sendLinkMutation.variables?.scheduleId === assignment.scheduleId}
                        onSendLink={() => void handleSendLink(assignment)}
                    />
                    <ServiceHeaderCard assignment={assignment} />
                    <ServiceSessionsCard assignment={assignment} />
                    {assignment.signatureDoc && (
                        <SignatureDocCard signatureDoc={assignment.signatureDoc} />
                    )}
                    {index < assignments.length - 1 && <div className="h-px bg-v3-border" />}
                </div>
            ))}
        </div>
    );
}

function ClientServiceRecordsSkeleton() {
    return (
        <div data-component="clients-detail-service-records-skeleton-list" className="space-y-[calc(16px*var(--v3-ui-scale,1))]">
            {[0, 1, 2].map((index) => (
                <div
                    key={index}
                    data-component="clients-detail-service-records-skeleton-card"
                    className="rounded-[18px] border border-v3-border bg-white p-[calc(18px*var(--v3-ui-scale,1))]"
                >
                    <div className="flex items-start gap-[calc(12px*var(--v3-ui-scale,1))]">
                        <Skeleton className="h-[calc(38px*var(--v3-ui-scale,1))] w-[calc(38px*var(--v3-ui-scale,1))] shrink-0 rounded-[12px] bg-v3-dim-white" />
                        <div className="min-w-0 flex-1 space-y-2">
                            <Skeleton className="h-[calc(15px*var(--v3-ui-scale,1))] w-[calc(150px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
                            <Skeleton className="h-[calc(12px*var(--v3-ui-scale,1))] w-[calc(220px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
                        </div>
                        <Skeleton className="h-[calc(24px*var(--v3-ui-scale,1))] w-[calc(68px*var(--v3-ui-scale,1))] rounded-full bg-v3-dim-white" />
                    </div>
                    <div className="mt-[calc(14px*var(--v3-ui-scale,1))] grid grid-cols-2 gap-x-[calc(24px*var(--v3-ui-scale,1))] gap-y-2 border-t border-dashed border-v3-border pt-[calc(12px*var(--v3-ui-scale,1))] max-sm:grid-cols-1">
                        {[0, 1, 2, 3].map((row) => (
                            <Skeleton key={row} className="h-[calc(18px*var(--v3-ui-scale,1))] bg-v3-dim-white" />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
}

function LinkStatusCard({
    assignment,
    isPending,
    onSendLink,
}: {
    assignment: ServiceRecordAssignment;
    isPending: boolean;
    onSendLink: () => void;
}) {
    const { link, employee } = assignment;
    const statusMeta = LINK_STATUS_META[link.status];
    const isResend = link.status === "sent" || link.status === "failed";
    const autoScheduledFor = link.scheduledFor ?? getExpectedAutoSendAt(assignment.startDate);

    return (
        <ServiceRecordCard
            dataComponent="clients-detail-service-records-link-card"
            icon={<Link2 className="h-[calc(17px*var(--v3-ui-scale,1))] w-[calc(17px*var(--v3-ui-scale,1))]" />}
            title="제공기록지 작성 링크"
            subtitle={`${employee.name} · ${formatPhone(employee.phone)} · 문자메시지 발송`}
            right={<StatusPill variant={statusMeta.variant}>{statusMeta.label}</StatusPill>}
        >
            <div className="grid grid-cols-2 gap-x-[calc(24px*var(--v3-ui-scale,1))] gap-y-[calc(6px*var(--v3-ui-scale,1))] border-t border-dashed border-v3-border pt-[calc(12px*var(--v3-ui-scale,1))] max-sm:grid-cols-1">
                <MetaRow
                    label={link.status === "none" || link.status === "scheduled" ? "자동 발송 예정" : "최근 발송"}
                    value={
                        link.status === "sent"
                            ? formatDateTimeKo(link.lastSentAt)
                            : link.status === "none" || link.status === "scheduled"
                                ? formatDateTimeKo(autoScheduledFor)
                                : <span className="text-[#b3bcc5]">-</span>
                    }
                />
                <MetaRow
                    label="발송 이력"
                    value={link.sentCount > 0 ? `${link.sentCount}회` : <span className="text-[#b3bcc5]">없음</span>}
                />
                <MetaRow label="링크 인증" value={<TokenVerificationValue assignment={assignment} />} />
                <MetaRow label="링크 만료" value={<TokenExpiryValue assignment={assignment} />} />
            </div>
            <div className="mt-[calc(14px*var(--v3-ui-scale,1))] flex flex-wrap items-center justify-between gap-[calc(12px*var(--v3-ui-scale,1))] border-t border-dashed border-v3-border pt-[calc(12px*var(--v3-ui-scale,1))]">
                <p className="min-w-[200px] flex-1 text-[calc(11.5px*var(--v3-ui-scale,1))] leading-6 text-v3-text-muted">
                    {isResend
                        ? <>재전송 시 <b>새 링크가 발급</b>되며 기존 링크는 즉시 사용할 수 없게 됩니다.</>
                        : "서비스 시작일 15:00에 자동 발송됩니다. 지금 바로 보내려면 수동 전송하세요."}
                </p>
                <Button
                    type="button"
                    variant={isResend ? "outline" : "default"}
                    size="sm"
                    disabled={isPending}
                    onClick={onSendLink}
                    data-component={isResend
                        ? "clients-detail-service-records-link-resend-button"
                        : "clients-detail-service-records-link-send-button"}
                >
                    {isPending ? "발송 중..." : isResend ? "링크 재전송" : "링크 수동 전송"}
                </Button>
            </div>
        </ServiceRecordCard>
    );
}

function TokenVerificationValue({ assignment }: { assignment: ServiceRecordAssignment }) {
    const token = assignment.link.token;
    if (!token) return <span className="text-[#b3bcc5]">-</span>;
    if (token.verifiedAt) {
        return <StatusPill variant="primary">전화번호 인증 완료</StatusPill>;
    }
    return <span className="text-v3-text-muted">미인증</span>;
}

function TokenExpiryValue({ assignment }: { assignment: ServiceRecordAssignment }) {
    const token = assignment.link.token;
    if (!token) return <span className="text-[#b3bcc5]">-</span>;

    if (token.state === "expired") {
        return (
            <span className="inline-flex items-center gap-1">
                <StatusPill variant="danger">만료됨</StatusPill>
                <span>{formatDateTimeKo(token.expiresAt)}</span>
            </span>
        );
    }

    if (token.state === "revoked") {
        return (
            <span className="inline-flex items-center gap-1">
                <StatusPill variant="danger">회수됨</StatusPill>
                <span>{formatDateTimeKo(token.expiresAt)}</span>
            </span>
        );
    }

    return <span>{formatDateTimeKo(token.expiresAt)}</span>;
}

function ServiceHeaderCard({ assignment }: { assignment: ServiceRecordAssignment }) {
    const { header } = assignment;

    return (
        <ServiceRecordCard
            dataComponent="clients-detail-service-records-header-card"
            icon={<Baby className="h-[calc(17px*var(--v3-ui-scale,1))] w-[calc(17px*var(--v3-ui-scale,1))]" />}
            title="서비스 기본정보"
            subtitle={header ? `${formatDateTimeKo(header.createdAt)} 작성` : "산모 및 신생아 정보"}
            right={<StatusPill variant={header ? "success" : "neutral"}>{header ? "작성 완료" : "작성 전"}</StatusPill>}
        >
            {header ? (
                <div className="grid grid-cols-2 gap-x-[calc(32px*var(--v3-ui-scale,1))] max-sm:grid-cols-1">
                    <InfoRow label="산모 성명" value={header.momName || "-"} />
                    <InfoRow label="산모 생년월일" value={header.momBirth || "-"} />
                    <InfoRow label="신생아 성명" value={header.babyName || "-"} />
                    <InfoRow label="신생아 출생일자" value={header.babyBirth || "-"} />
                    <InfoRow label="분만형태" value={header.deliveryType || "-"} />
                    <InfoRow label="신생아 몸무게" value={formatBabyWeight(header.babyWeight)} />
                </div>
            ) : (
                <div className="mt-[calc(12px*var(--v3-ui-scale,1))] rounded-[14px] border-2 border-dashed border-v3-border px-[calc(22px*var(--v3-ui-scale,1))] py-[calc(22px*var(--v3-ui-scale,1))] text-center text-[calc(12.3px*var(--v3-ui-scale,1))] leading-6 text-v3-text-muted">
                    아직 작성된 기본정보가 없습니다.
                    <br />
                    제공인력이 링크 접속 후 산모·신생아 정보를 입력하면 표시됩니다.
                </div>
            )}
        </ServiceRecordCard>
    );
}

function ServiceSessionsCard({ assignment }: { assignment: ServiceRecordAssignment }) {
    const slots = useMemo(() => buildSessionSlots(assignment), [assignment]);
    const lockedCount = assignment.sessions.filter((session) => session.locked).length;
    const draftCount = assignment.sessions.filter((session) => !session.locked).length;
    const totalSessions = slots.length;
    const progress = totalSessions > 0 ? Math.round((lockedCount / totalSessions) * 100) : 0;

    return (
        <ServiceRecordCard
            dataComponent="clients-detail-service-records-sessions"
            icon={<ClipboardList className="h-[calc(17px*var(--v3-ui-scale,1))] w-[calc(17px*var(--v3-ui-scale,1))]" />}
            title="회차별 제공기록"
            subtitle={assignment.sessions.length > 0
                ? "계약 회차를 누르면 기록 상세가 열립니다"
                : `계약 회차 ${assignment.totalSessions}회`}
            right={
                <span className="text-[calc(12px*var(--v3-ui-scale,1))] font-semibold text-v3-text-muted">
                    <b className="text-v3-primary">{lockedCount}</b>/{totalSessions} 제출완료
                    {draftCount > 0 ? ` · 임시저장 ${draftCount}` : ""}
                </span>
            }
        >
            <div className="mt-[calc(10px*var(--v3-ui-scale,1))] h-[calc(6px*var(--v3-ui-scale,1))] overflow-hidden rounded-full bg-v3-dim-white">
                <div
                    data-component="clients-detail-service-records-progress"
                    className={cn("h-full rounded-full bg-v3-primary transition-[width] duration-300", progress === 100 && "bg-v3-green")}
                    style={{ width: `${progress}%` }}
                />
            </div>
            <div data-component="clients-detail-service-records-session-list" className="mt-[calc(8px*var(--v3-ui-scale,1))]">
                {slots.map((slot, index) => (
                    <SessionRow
                        key={slot.sessionIndex}
                        slot={slot}
                        defaultOpen={Boolean(slot.record && index === 0)}
                    />
                ))}
            </div>
        </ServiceRecordCard>
    );
}

function SessionRow({ slot, defaultOpen }: { slot: SessionSlot; defaultOpen: boolean }) {
    const { record } = slot;
    if (!record) {
        return (
            <div data-component="clients-detail-service-records-session-item" className="border-b border-v3-dim-white last:border-b-0">
                <div className="flex items-center gap-[calc(12px*var(--v3-ui-scale,1))] px-[calc(4px*var(--v3-ui-scale,1))] py-[calc(13px*var(--v3-ui-scale,1))] opacity-75">
                    <SessionNumber index={slot.sessionIndex} state="idle" />
                    <div className="min-w-0">
                        <div className="text-[calc(13px*var(--v3-ui-scale,1))] font-semibold text-v3-dark">{slot.sessionIndex}회차</div>
                        <div className="mt-0.5 text-[calc(11.5px*var(--v3-ui-scale,1))] text-v3-text-muted">예정일 {formatDateKo(slot.expectedDate)}</div>
                    </div>
                    <div className="ml-auto shrink-0">
                        <StatusPill variant="neutral">미작성</StatusPill>
                    </div>
                </div>
            </div>
        );
    }

    const state = record.locked ? "done" : "draft";

    return (
        <Collapsible
            defaultOpen={defaultOpen}
            data-component="clients-detail-service-records-session-item"
            className="border-b border-v3-dim-white last:border-b-0"
        >
            <CollapsibleTrigger asChild>
                <button
                    type="button"
                    className="group flex w-full items-center gap-[calc(12px*var(--v3-ui-scale,1))] px-[calc(4px*var(--v3-ui-scale,1))] py-[calc(13px*var(--v3-ui-scale,1))] text-left"
                >
                    <SessionNumber index={slot.sessionIndex} state={state} />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-[calc(8px*var(--v3-ui-scale,1))] text-[calc(13px*var(--v3-ui-scale,1))] font-semibold text-v3-dark">
                            <span>{slot.sessionIndex}회차 · {formatDateKo(record.serviceDate)}</span>
                            <span className="rounded-[6px] border border-v3-border bg-v3-dim-white px-[calc(6px*var(--v3-ui-scale,1))] py-px text-[calc(10px*var(--v3-ui-scale,1))] font-semibold text-v3-text-muted">
                                양식 v1
                            </span>
                        </div>
                        <div className="mt-0.5 text-[calc(11.5px*var(--v3-ui-scale,1))] text-v3-text-muted">
                            {record.locked
                                ? <>제출 {formatDateTimeKo(record.submittedAt)} · 잠금 🔒</>
                                : <>마지막 저장 {formatDateTimeKo(record.updatedAt)} · 작성 중</>}
                        </div>
                    </div>
                    <div className="ml-auto flex shrink-0 items-center gap-[calc(10px*var(--v3-ui-scale,1))] text-right">
                        <StatusPill variant={record.locked ? "success" : "warning"}>
                            {record.locked ? "제출완료" : "임시저장"}
                        </StatusPill>
                        <ChevronDown className="h-[calc(14px*var(--v3-ui-scale,1))] w-[calc(14px*var(--v3-ui-scale,1))] text-v3-text-muted transition-transform group-data-[state=open]:rotate-180" />
                    </div>
                </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <SessionRecordDetail record={record} />
            </CollapsibleContent>
        </Collapsible>
    );
}

function SessionNumber({ index, state }: { index: number; state: "done" | "draft" | "idle" }) {
    return (
        <div
            className={cn(
                "flex h-[calc(30px*var(--v3-ui-scale,1))] w-[calc(30px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-full text-[calc(12px*var(--v3-ui-scale,1))] font-bold",
                state === "done" && "bg-v3-green-light text-v3-green",
                state === "draft" && "bg-v3-primary-light text-v3-primary",
                state === "idle" && "bg-v3-dim-white text-v3-text-muted",
            )}
        >
            {index}
        </div>
    );
}

function SessionRecordDetail({ record }: { record: ServiceRecordSession }) {
    const answers = getAnswerObject(record.answers);
    const unknownEntries = Object.entries(answers)
        .filter(([key, value]) => !SERVICE_RECORD_LAYOUT_ANSWER_KEYS.has(key) && hasDisplayValue(value));

    return (
        <div
            data-component="clients-detail-service-records-session-detail"
            className="px-[calc(4px*var(--v3-ui-scale,1))] pb-[calc(18px*var(--v3-ui-scale,1))] pl-[calc(46px*var(--v3-ui-scale,1))]"
        >
            {SERVICE_RECORD_FORM_LAYOUT.map((section) => (
                <div key={section.id}>
                    <div className="mb-[calc(4px*var(--v3-ui-scale,1))] mt-[calc(14px*var(--v3-ui-scale,1))] flex items-center gap-[calc(6px*var(--v3-ui-scale,1))] text-[calc(11px*var(--v3-ui-scale,1))] font-bold tracking-[0.05em] text-v3-text-muted">
                        <span
                            className={cn(
                                "h-[calc(7px*var(--v3-ui-scale,1))] w-[calc(7px*var(--v3-ui-scale,1))] rounded-full",
                                section.tone === "mom" && "bg-v3-burgundy",
                                section.tone === "baby" && "bg-v3-primary",
                                section.tone === "finish" && "bg-v3-green",
                            )}
                        />
                        {section.title}
                    </div>
                    <div className="grid grid-cols-2 gap-x-[calc(28px*var(--v3-ui-scale,1))] max-sm:grid-cols-1">
                        {section.fields.map((field) => (
                            <RecordFieldRow key={field.key} field={field} answers={answers} record={record} />
                        ))}
                    </div>
                </div>
            ))}
            {unknownEntries.length > 0 && (
                <div>
                    <div className="mb-[calc(4px*var(--v3-ui-scale,1))] mt-[calc(14px*var(--v3-ui-scale,1))] flex items-center gap-[calc(6px*var(--v3-ui-scale,1))] text-[calc(11px*var(--v3-ui-scale,1))] font-bold tracking-[0.05em] text-v3-text-muted">
                        <span className="h-[calc(7px*var(--v3-ui-scale,1))] w-[calc(7px*var(--v3-ui-scale,1))] rounded-full bg-v3-text-muted" />
                        기타 항목
                    </div>
                    <div className="grid grid-cols-2 gap-x-[calc(28px*var(--v3-ui-scale,1))] max-sm:grid-cols-1">
                        {unknownEntries.map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between gap-[calc(12px*var(--v3-ui-scale,1))] border-b border-dashed border-v3-dim-white py-[calc(7px*var(--v3-ui-scale,1))]">
                                <span className="shrink-0 text-[calc(12px*var(--v3-ui-scale,1))] text-v3-text-muted">{key}</span>
                                <span className="text-right text-[calc(12.3px*var(--v3-ui-scale,1))] font-medium text-v3-dark">{formatUnknownValue(value)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
            <div className="mt-[calc(12px*var(--v3-ui-scale,1))] text-[calc(10.8px*var(--v3-ui-scale,1))] text-[#b3bcc5]">
                ※ 제출 시점의 양식 스냅샷(v1) 기준으로 표시됩니다.
            </div>
        </div>
    );
}

function RecordFieldRow({
    field,
    answers,
    record,
}: {
    field: ServiceRecordFieldDescriptor;
    answers: Record<string, unknown>;
    record: ServiceRecordSession;
}) {
    const isWide = field.kind === "text";
    return (
        <div
            className={cn(
                "flex items-center justify-between gap-[calc(12px*var(--v3-ui-scale,1))] border-b border-dashed border-v3-dim-white py-[calc(7px*var(--v3-ui-scale,1))]",
                isWide && "col-span-full items-start",
            )}
        >
            <span className="shrink-0 text-[calc(12px*var(--v3-ui-scale,1))] text-v3-text-muted">{field.label}</span>
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-[calc(5px*var(--v3-ui-scale,1))] text-right text-[calc(12.3px*var(--v3-ui-scale,1))] font-medium text-v3-dark">
                {renderFieldValue(field, answers, record)}
            </div>
        </div>
    );
}

function renderFieldValue(
    field: ServiceRecordFieldDescriptor,
    answers: Record<string, unknown>,
    record: ServiceRecordSession,
) {
    if (field.source === "session") {
        if (field.key === "etcService") return <FreeTextValue value={record.etcService} />;
        if (field.key === "notes") return <FreeTextValue value={record.notes} />;
        if (field.key === "paymentConfirmed") {
            return record.paymentConfirmed
                ? <span className="font-semibold text-v3-green">✓ 완료</span>
                : <span className="text-[#b3bcc5]">미확인</span>;
        }
        if (field.key === "hasMomSignature") {
            return record.hasMomSignature
                ? <span className="font-semibold text-v3-green">✓ 서명함</span>
                : <span className="text-[#b3bcc5]">서명 전</span>;
        }
    }

    if (field.kind === "multi") {
        const values = Array.isArray(answers[field.key]) ? answers[field.key] as unknown[] : [];
        if (values.length === 0) return <EmptyValue />;
        return values.map((value) => (
            <AnswerChip key={String(value)} value={String(value)} field={field} />
        ));
    }

    if (field.kind === "radio") {
        const value = answers[field.key];
        const colorValue = field.key === "stool" ? answers.stool_color : null;
        if (!hasDisplayValue(value)) return <EmptyValue />;
        return (
            <>
                <AnswerChip value={String(value)} field={field} />
                {hasDisplayValue(colorValue) && <AnswerChip value={String(colorValue)} tone="neutral" />}
            </>
        );
    }

    if (field.kind === "counts") {
        const parts = (field.subKeys ?? [])
            .map((subKey) => {
                const value = answers[subKey.key];
                if (!hasDisplayValue(value)) return null;
                return `${subKey.label} ${String(value)}${subKey.unit}`;
            })
            .filter((part): part is string => part !== null);
        return parts.length > 0 ? parts.join(" · ") : <EmptyValue />;
    }

    return <EmptyValue />;
}

function AnswerChip({
    value,
    field,
    tone,
}: {
    value: string;
    field?: ServiceRecordFieldDescriptor;
    tone?: "neutral" | "warn" | "primary";
}) {
    const resolvedTone = tone ?? (
        field?.normalValues?.includes(value)
            ? "neutral"
            : field?.normalValues
                ? "warn"
                : "primary"
    );

    return (
        <span
            className={cn(
                "rounded-[8px] px-[calc(9px*var(--v3-ui-scale,1))] py-[calc(2.5px*var(--v3-ui-scale,1))] text-[calc(11px*var(--v3-ui-scale,1))] font-medium",
                resolvedTone === "neutral" && "bg-v3-dim-white text-v3-text",
                resolvedTone === "warn" && "bg-[hsl(32,100%,94%)] text-[hsl(32,100%,35%)]",
                resolvedTone === "primary" && "bg-v3-primary-light text-v3-primary",
            )}
        >
            {value}
        </span>
    );
}

function FreeTextValue({ value }: { value: string | null }) {
    if (!value) return <span className="text-[#b3bcc5]">미입력</span>;
    return (
        <span className="flex-1 rounded-[10px] bg-v3-dim-white px-[calc(12px*var(--v3-ui-scale,1))] py-[calc(9px*var(--v3-ui-scale,1))] text-left text-[calc(12.2px*var(--v3-ui-scale,1))] font-normal leading-6 text-v3-text">
            {value}
        </span>
    );
}

function EmptyValue() {
    return <span className="text-[calc(11.8px*var(--v3-ui-scale,1))] font-normal italic text-[#b3bcc5]">미입력</span>;
}

function SignatureDocCard({ signatureDoc }: { signatureDoc: SignatureDocStatus }) {
    return (
        <ServiceRecordCard
            dataComponent="clients-detail-service-records-signature-card"
            icon={<FileSignature className="h-[calc(17px*var(--v3-ui-scale,1))] w-[calc(17px*var(--v3-ui-scale,1))]" />}
            title="제공기록 서명 문서 (eformsign)"
            subtitle="전 회차 제출 완료 후 자동 생성 · 제공인력 서명"
            right={<StatusPill variant={getSignatureVariant(signatureDoc.statusDetail)}>{formatSignatureStatus(signatureDoc.statusDetail)}</StatusPill>}
        >
            <div className="grid grid-cols-2 gap-x-[calc(24px*var(--v3-ui-scale,1))] gap-y-[calc(6px*var(--v3-ui-scale,1))] border-t border-dashed border-v3-border pt-[calc(12px*var(--v3-ui-scale,1))] max-sm:grid-cols-1">
                <MetaRow label="문서 발송" value={formatDateTimeKo(signatureDoc.createdDate)} />
                <MetaRow label="상태 갱신" value={formatDateTimeKo(signatureDoc.updatedDate)} />
                <MetaRow label="단계" value={signatureDoc.stepName} />
                <MetaRow label="문서 ID" value={signatureDoc.documentId} />
            </div>
        </ServiceRecordCard>
    );
}

function ServiceRecordCard({
    dataComponent,
    icon,
    title,
    subtitle,
    right,
    children,
}: {
    dataComponent: string;
    icon: React.ReactNode;
    title: string;
    subtitle: string;
    right?: ReactNode;
    children: ReactNode;
}) {
    return (
        <div
            data-component={dataComponent}
            className="rounded-[18px] border border-v3-border bg-white p-[calc(18px*var(--v3-ui-scale,1))]"
        >
            <div className="mb-[calc(14px*var(--v3-ui-scale,1))] flex items-start gap-[calc(12px*var(--v3-ui-scale,1))]">
                <div className="flex h-[calc(38px*var(--v3-ui-scale,1))] w-[calc(38px*var(--v3-ui-scale,1))] shrink-0 items-center justify-center rounded-[12px] bg-v3-primary-light text-v3-primary">
                    {icon}
                </div>
                <div className="min-w-0">
                    <div className="text-[calc(13.5px*var(--v3-ui-scale,1))] font-bold text-v3-dark">{title}</div>
                    <div className="mt-0.5 text-[calc(12px*var(--v3-ui-scale,1))] text-v3-text-muted">{subtitle}</div>
                </div>
                {right && <div className="ml-auto flex shrink-0 items-center gap-[calc(8px*var(--v3-ui-scale,1))]">{right}</div>}
            </div>
            {children}
        </div>
    );
}

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-[calc(12px*var(--v3-ui-scale,1))] py-[calc(4px*var(--v3-ui-scale,1))]">
            <span className="shrink-0 text-[calc(12px*var(--v3-ui-scale,1))] text-v3-text-muted">{label}</span>
            <span className="min-w-0 text-right text-[calc(12.5px*var(--v3-ui-scale,1))] font-medium text-v3-dark">{value}</span>
        </div>
    );
}

function buildSessionSlots(assignment: ServiceRecordAssignment): SessionSlot[] {
    const total = Math.max(
        assignment.totalSessions,
        assignment.sessions.reduce((max, session) => Math.max(max, session.sessionIndex), 0),
    );
    const sessionsByIndex = new Map(assignment.sessions.map((session) => [session.sessionIndex, session]));
    return Array.from({ length: total }, (_, index) => {
        const sessionIndex = index + 1;
        return {
            sessionIndex,
            record: sessionsByIndex.get(sessionIndex) ?? null,
            expectedDate: getExpectedSessionDate(assignment.startDate, sessionIndex),
        };
    });
}

function getExpectedSessionDate(startDate: string, sessionIndex: number): string | null {
    const datePart = datePartOf(startDate);
    if (!datePart) return null;
    return calcEndDateBusinessDays(datePart, sessionIndex) || null;
}

function getExpectedAutoSendAt(startDate: string): string | null {
    const datePart = datePartOf(startDate);
    return datePart ? `${datePart}T15:00:00+09:00` : null;
}

function datePartOf(value: string | null): string | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match?.[0] ?? null;
}

function formatDateKo(value: string | null): string {
    const date = parseDateForDisplay(value);
    if (!date) return "-";
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}(${WEEKDAYS[date.getDay()]})`;
}

function formatDateTimeKo(value: string | null): string {
    const date = parseDateForDisplay(value);
    if (!date) return "-";
    return `${formatDateKo(value)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseDateForDisplay(value: string | null): Date | null {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.length === 11) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
    }
    return phone || "-";
}

function formatBabyWeight(value: string | null): string {
    if (!value) return "-";
    return value.endsWith("kg") ? value : `${value}kg`;
}

function getAnswerObject(value: Record<string, unknown>): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }
    return {};
}

function hasDisplayValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
}

function formatUnknownValue(value: unknown): string {
    if (Array.isArray(value)) return value.map(String).join(", ");
    if (typeof value === "object" && value !== null) return JSON.stringify(value);
    return String(value);
}

function formatSignatureStatus(statusDetail: string): string {
    if (statusDetail.includes("complete") || statusDetail.includes("completed")) return "서명 완료";
    if (statusDetail.includes("created")) return "발송됨";
    return statusDetail || "상태 확인";
}

function getSignatureVariant(statusDetail: string): "neutral" | "primary" | "success" | "warning" | "danger" {
    if (statusDetail.includes("complete") || statusDetail.includes("completed")) return "success";
    if (statusDetail.includes("reject") || statusDetail.includes("fail")) return "danger";
    if (statusDetail.includes("created")) return "primary";
    return "neutral";
}

function getErrorDescription(error: unknown): string {
    if (error && typeof error === "object" && "response" in error) {
        const response = (error as { response?: { data?: unknown } }).response;
        const data = response?.data;
        if (data && typeof data === "object") {
            const message = (data as { message?: unknown; error?: unknown }).message
                ?? (data as { message?: unknown; error?: unknown }).error;
            if (typeof message === "string") return message;
        }
    }

    return "제공기록지 링크 발송에 실패했습니다.";
}
