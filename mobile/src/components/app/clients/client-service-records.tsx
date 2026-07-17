"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import {
    SERVICE_RECORD_FORM_LAYOUT,
    SERVICE_RECORD_LAYOUT_ANSWER_KEYS,
    type ServiceRecordFieldDescriptor,
} from "@babyjamjam/shared/constants/service-record-form-layout";
import type {
    ServiceRecordAssignment,
    ServiceRecordLinkStatus,
    ServiceRecordOverview,
    ServiceRecordSession,
} from "@babyjamjam/shared/types/service-record";
import { formatBirthdayYYMMDD } from "@babyjamjam/shared/utils/birthday";
import { calcEndDateBusinessDays } from "@babyjamjam/shared/utils/business-days";
import {
    formatDateForDisplay,
    formatDateTimeKo,
    parseDateForDisplay,
} from "@babyjamjam/shared/utils/date";

import { InfoCard, InfoRow } from "@/components/app/mobile-redesign/detail-sheet";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { Skeleton } from "@/components/ui/skeleton";
import { useSendServiceRecordLink } from "@/hooks/useServiceRecords";
import { toast } from "@/hooks/use-toast";
import type { Client } from "@/lib/client/types";
import { cn } from "@/lib/utils";

interface ClientServiceRecordsProps {
    client: Client;
    activeTab: string;
    overview?: ServiceRecordOverview;
    isLoading: boolean;
    isError: boolean;
}

interface SessionSlot {
    sessionIndex: number;
    record: ServiceRecordSession | null;
    expectedDate: string | null;
}

type LinkBadgeTone = "gray" | "blue" | "green" | "burgundy";
type SessionTone = "green" | "orange" | "muted";

const LINK_STATUS_META: Record<ServiceRecordLinkStatus, { label: string; tone: LinkBadgeTone }> = {
    none: { label: "발송 전", tone: "gray" },
    scheduled: { label: "발송 예약", tone: "blue" },
    sent: { label: "발송됨", tone: "green" },
    failed: { label: "발송 실패", tone: "burgundy" },
    canceled: { label: "발송 취소", tone: "gray" },
};

const LINK_STATUS_TEXT_CLASS: Record<LinkBadgeTone, string> = {
    gray: "info-row-value-muted",
    blue: "info-row-value-primary",
    green: "info-row-value-green",
    burgundy: "info-row-value-burgundy",
};
const SERVICE_RECORD_SKELETON_CLASS = "service-record-skeleton-loader";

export function ClientServiceRecords({
    client,
    activeTab,
    overview,
    isLoading,
    isError,
}: ClientServiceRecordsProps) {
    const assignments = useMemo(
        () => sortAssignmentsNewestFirst(overview?.assignments ?? []),
        [overview?.assignments],
    );
    const [selectedEntry, setSelectedEntry] = useState<{
        key: string;
        assignmentScheduleId: number;
        sessionIndex: number;
    } | null>(null);

    const detailKey = `${activeTab}:${client.id}`;
    const selectedAssignment = selectedEntry?.key === detailKey
        ? assignments.find((assignment) => assignment.scheduleId === selectedEntry.assignmentScheduleId) ?? null
        : null;
    const selectedSession = selectedAssignment
        ? selectedAssignment.sessions.find((session) => session.sessionIndex === selectedEntry?.sessionIndex) ?? null
        : null;

    if (isLoading) {
        return <ServiceRecordsSkeleton />;
    }

    if (isError) {
        return (
            <div className="detail-empty-state" data-component="mobile-clients-service-records-error">
                제공기록지 정보를 불러오지 못했습니다.
            </div>
        );
    }

    if (assignments.length === 0) {
        return (
            <div className="detail-empty-state" data-component="mobile-clients-service-records-empty">
                제공기록지 배정 정보가 없습니다.
            </div>
        );
    }

    if (selectedAssignment && selectedSession) {
        return (
            <div data-component="mobile-clients-service-records">
                <ServiceRecordSessionDetail
                    record={selectedSession}
                    onBack={() => setSelectedEntry(null)}
                />
            </div>
        );
    }

    return (
        <div className="detail-column" data-component="mobile-clients-service-records">
            {assignments.map((assignment, assignmentIndex) => (
                <div
                    key={assignment.scheduleId}
                    className="detail-column"
                    data-component="mobile-clients-service-records-assignment"
                >
                    <LinkCard
                        assignment={assignment}
                        clientId={client.id}
                        delay={assignmentIndex * 180}
                    />
                    <ServiceHeaderCard assignment={assignment} delay={assignmentIndex * 180 + 60} />
                    <ServiceSessionsCard
                        assignment={assignment}
                        delay={assignmentIndex * 180 + 120}
                        onSelectSession={(sessionIndex) =>
                            setSelectedEntry({
                                key: detailKey,
                                assignmentScheduleId: assignment.scheduleId,
                                sessionIndex,
                            })}
                    />
                </div>
            ))}
        </div>
    );
}

function LinkCard({
    assignment,
    clientId,
    delay,
}: {
    assignment: ServiceRecordAssignment;
    clientId: number;
    delay: number;
}) {
    const sendLinkMutation = useSendServiceRecordLink();
    const [resendModalOpen, setResendModalOpen] = useState(false);
    const statusMeta = LINK_STATUS_META[assignment.link.status];
    const isResend = assignment.link.status === "sent" || assignment.link.status === "failed";
    const showSentMetadata = assignment.link.status === "sent"
        || assignment.link.status === "failed"
        || assignment.link.status === "canceled";
    const expiresAt = assignment.link.token?.expiresAt ?? endDateExpiry(assignment.endDate);
    // 토큰이 발급된 적 없는 배정(발송 전)은 예상 만료일만 보여주고 만료됨 배지는 달지 않는다.
    const isExpired = assignment.link.token
        ? assignment.link.token.state === "expired" || isPastDate(expiresAt)
        : false;

    const sendLink = async () => {
        try {
            await sendLinkMutation.mutateAsync({
                scheduleId: assignment.scheduleId,
                clientId,
            });
            toast({ description: "제공기록지 링크를 발송했습니다." });
        } catch (error) {
            toast({
                description: getErrorDescription(error),
                variant: "destructive",
            });
        }
    };

    const handleSendClick = () => {
        if (isResend) {
            setResendModalOpen(true);
            return;
        }

        void sendLink();
    };

    const handleConfirmResend = async () => {
        await sendLink();
        setResendModalOpen(false);
    };

    return (
        <InfoCard title="제공기록지 작성 링크" delay={delay}>
            <InfoRow
                label="상태"
                value={<span className={LINK_STATUS_TEXT_CLASS[statusMeta.tone]}>{statusMeta.label}</span>}
            />
            <InfoRow
                label="제공인력"
                value={`${assignment.employee.name} · ${formatPhone(assignment.employee.phone)}`}
            />
            {showSentMetadata ? (
                <InfoRow
                    label="최근 발송"
                    value={assignment.link.status === "sent" ? formatDateTimeKo(assignment.link.lastSentAt) : "-"}
                    tone={assignment.link.status === "sent" ? undefined : "muted"}
                />
            ) : null}
            <InfoRow
                label="발송 이력"
                value={assignment.link.sentCount > 0 ? `${assignment.link.sentCount}회` : "-"}
                tone={assignment.link.sentCount > 0 ? undefined : "muted"}
            />
            {showSentMetadata || assignment.link.token ? (
                <InfoRow
                    label="링크 인증"
                    value={
                        assignment.link.token?.verifiedAt ? (
                            <span className="info-row-value-primary">전화번호 인증 완료</span>
                        ) : (
                            <span className="info-row-value">미인증</span>
                        )
                    }
                />
            ) : null}
            <InfoRow
                label="링크 만료"
                value={
                    <span className="status-value-with-time">
                        <span>{formatDateTimeKo(expiresAt)}</span>
                        {isExpired ? <span className="badge-mini burgundy">만료됨</span> : null}
                    </span>
                }
            />
            <div className="detail-actions card-actions">
                <button
                    type="button"
                    className={cn("btn", isResend ? "btn-secondary" : "btn-primary")}
                    data-component={isResend
                        ? "mobile-clients-service-records-resend"
                        : "mobile-clients-service-records-send"}
                    disabled={sendLinkMutation.isPending}
                    onClick={handleSendClick}
                >
                    {sendLinkMutation.isPending ? "발송 중..." : isResend ? "메시지 재전송" : "링크 수동 전송"}
                </button>
            </div>
            <div className="link-note">
                {isResend
                    ? <>메시지 재전송 시 <b>기존 링크가 그대로 전송</b>됩니다.</>
                    : "서비스 시작일 오후 3시에 자동 발송됩니다. 지금 바로 보내려면 수동 전송하세요."}
            </div>
            <ConfirmActionModal
                open={resendModalOpen}
                title="메시지를 재전송할까요?"
                description="기존 링크가 그대로 포함된 메시지를 다시 전송합니다."
                cancelLabel="취소"
                confirmLabel="메시지 재전송"
                loading={sendLinkMutation.isPending}
                onOpenChange={(open) => {
                    if (!sendLinkMutation.isPending) {
                        setResendModalOpen(open);
                    }
                }}
                onCancel={() => setResendModalOpen(false)}
                onConfirm={handleConfirmResend}
            />
        </InfoCard>
    );
}

function ServiceHeaderCard({
    assignment,
    delay,
}: {
    assignment: ServiceRecordAssignment;
    delay: number;
}) {
    const header = assignment.header;

    return (
        <InfoCard title="서비스 기본정보" delay={delay}>
            {header ? (
                <>
                    <InfoRow label="산모 성명" value={header.momName ?? "-"} />
                    <InfoRow
                        label="산모 생년월일"
                        value={header.momBirth ? formatBirthdayYYMMDD(header.momBirth) : "-"}
                    />
                    <InfoRow label="신생아 성명" value={header.babyName ?? "-"} />
                    <InfoRow label="신생아 출생일자" value={header.babyBirth ?? "-"} />
                    <InfoRow label="분만형태" value={header.deliveryType ?? "-"} />
                    <InfoRow label="신생아 몸무게" value={formatBabyWeight(header.babyWeight)} />
                </>
            ) : (
                <div
                    className="detail-empty-state"
                    data-component="mobile-clients-service-records-header-empty"
                >
                    아직 작성된 기본정보가 없습니다.<br />제공인력이 링크 접속 후 입력하면 표시됩니다.
                </div>
            )}
        </InfoCard>
    );
}

function ServiceSessionsCard({
    assignment,
    delay,
    onSelectSession,
}: {
    assignment: ServiceRecordAssignment;
    delay: number;
    onSelectSession: (sessionIndex: number) => void;
}) {
    const slots = buildSessionSlots(assignment);
    const lockedCount = assignment.sessions.filter((session) => session.locked).length;
    const draftCount = assignment.sessions.filter((session) => !session.locked).length;

    return (
        <div
            className="info-card pop-up"
            data-component="mobile-clients-service-records-session-card"
            style={{ animationDelay: `${delay}ms` }}
        >
            <div
                className="service-record-card-title-row"
                data-component="mobile-clients-service-records-session-card-header"
            >
                <div className="info-card-title">회차별 제공기록</div>
                <div className="service-record-progress-row">
                    <InfoRow
                        value={`${lockedCount}/${slots.length} 제출완료${draftCount > 0 ? ` · 임시저장 ${draftCount}` : ""}`}
                    />
                </div>
            </div>
            {slots.map((slot) => (
                <SessionRow
                    key={slot.sessionIndex}
                    slot={slot}
                    onSelect={() => onSelectSession(slot.sessionIndex)}
                />
            ))}
        </div>
    );
}

function SessionRow({
    slot,
    onSelect,
}: {
    slot: SessionSlot;
    onSelect: () => void;
}) {
    const record = slot.record;
    const tone: SessionTone = record ? (record.locked ? "green" : "orange") : "muted";
    const badge = record ? (record.locked ? "제출완료" : "임시저장") : "미작성";
    const titleDate = record ? formatShortDateKo(record.serviceDate) : null;
    const meta = record
        ? record.locked
            ? `제출 ${formatDateTimeKo(record.submittedAt ?? record.updatedAt)}`
            : `마지막 저장 ${formatDateTimeKo(record.updatedAt)} · 작성 중`
        : `예정일 ${formatDateKo(slot.expectedDate)}`;
    const interactive = Boolean(record);

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (!interactive) return;
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
        }
    };

    return (
        <div
            className={cn("doc-row", interactive && "doc-row-tappable")}
            role={interactive ? "button" : undefined}
            tabIndex={interactive ? 0 : undefined}
            data-component="mobile-clients-service-records-session-row"
            onClick={interactive ? onSelect : undefined}
            onKeyDown={handleKeyDown}
        >
            <div className={`doc-icon doc-icon-${tone}`}>{slot.sessionIndex}</div>
            <div className="doc-info">
                <div className="doc-title">
                    {record && titleDate ? `${slot.sessionIndex}회차 · ${titleDate}` : `${slot.sessionIndex}회차`}
                </div>
                <div className="doc-meta">{meta}</div>
            </div>
            <span className={cn("badge-mini", tone === "muted" ? "gray" : tone)}>{badge}</span>
        </div>
    );
}

function ServiceRecordSessionDetail({
    record,
    onBack,
}: {
    record: ServiceRecordSession;
    onBack: () => void;
}) {
    const answers = getAnswerObject(record.answers);
    const unknownEntries = Object.entries(answers)
        .filter(([key, value]) => !SERVICE_RECORD_LAYOUT_ANSWER_KEYS.has(key) && hasDisplayValue(value));
    const statusTone = record.locked ? "green" : "orange";

    return (
        <div className="message-detail pop-up" data-component="mobile-clients-service-records-session-detail">
            <button
                type="button"
                className="message-detail-back"
                data-component="mobile-clients-service-records-session-detail-back"
                onClick={onBack}
            >
                ‹ 목록으로
            </button>

            <div className="message-detail-head">
                <div className={`doc-icon doc-icon-${statusTone}`}>{record.sessionIndex}</div>
                <div className="message-detail-head-text">
                    <div className="message-detail-title">{record.sessionIndex}회차 제공기록</div>
                    <div className="message-detail-subtitle">
                        제공일 {formatDateKo(record.serviceDate)} · {record.locked
                            ? `제출 ${formatTimeKo(record.submittedAt ?? record.updatedAt)}`
                            : `마지막 저장 ${formatTimeKo(record.updatedAt)}`}
                    </div>
                </div>
                <span className={`badge-mini ${statusTone}`}>
                    {record.locked ? "제출완료" : "임시저장"}
                </span>
            </div>

            {SERVICE_RECORD_FORM_LAYOUT.map((section) => (
                <InfoCard key={section.id} title={section.title}>
                    {section.fields.map((field) => (
                        <SessionFieldRow
                            key={field.key}
                            field={field}
                            answers={answers}
                            record={record}
                        />
                    ))}
                </InfoCard>
            ))}

            {unknownEntries.length > 0 ? (
                <InfoCard title="기타 항목">
                    {unknownEntries.map(([key, value]) => (
                        <InfoRow key={key} label={key} value={formatUnknownValue(value)} />
                    ))}
                </InfoCard>
            ) : null}

            <div className="detail-empty-state service-record-snapshot-note">
                제출 시점의 양식 스냅샷 기준으로 표시됩니다. 양식에 없는 항목은 &quot;기타 항목&quot;으로 표시됩니다.
            </div>
        </div>
    );
}

function SessionFieldRow({
    field,
    answers,
    record,
}: {
    field: ServiceRecordFieldDescriptor;
    answers: Record<string, unknown>;
    record: ServiceRecordSession;
}) {
    const display = formatFieldValue(field, answers, record);

    if (field.kind === "text") {
        return (
            <div className="info-row service-record-text-row">
                <span className="info-row-label">{field.label}</span>
                <span className={cn("message-detail-body", !display.value && "info-row-value-muted")}>
                    {display.value || "미입력"}
                </span>
            </div>
        );
    }

    return (
        <InfoRow
            label={field.label}
            value={display.value || "미입력"}
            tone={display.tone}
        />
    );
}

function formatFieldValue(
    field: ServiceRecordFieldDescriptor,
    answers: Record<string, unknown>,
    record: ServiceRecordSession,
): { value: ReactNode; tone?: "green" | "burgundy" | "muted" } {
    if (field.source === "session") {
        if (field.key === "etcService") return { value: record.etcService ?? "" };
        if (field.key === "notes") return { value: record.notes ?? "" };
        if (field.key === "paymentConfirmed") {
            return record.paymentConfirmed
                ? { value: "✓ 완료", tone: "green" }
                : { value: "미확인", tone: "muted" };
        }
        if (field.key === "hasMomApproval") {
            return record.hasMomApproval
                ? { value: "✓ 서명함", tone: "green" }
                : { value: "서명 전", tone: "muted" };
        }
    }

    if (field.kind === "multi") {
        const answerValue = answers[field.key];
        const values = Array.isArray(answerValue) ? answerValue.filter(hasDisplayValue).map(String) : [];
        const value = values.join(", ");
        return { value, tone: answerTone(value, field) };
    }

    if (field.kind === "radio") {
        const value = hasDisplayValue(answers[field.key]) ? String(answers[field.key]) : "";
        const colorValue = field.key === "stool" && hasDisplayValue(answers.stool_color)
            ? String(answers.stool_color)
            : "";
        const displayValue = [value, colorValue].filter(Boolean).join(" · ");
        return { value: displayValue, tone: answerTone(displayValue, field) };
    }

    if (field.kind === "counts") {
        const parts = (field.subKeys ?? [])
            .map((subKey) => {
                const value = answers[subKey.key];
                if (!hasDisplayValue(value)) return null;
                const prefix = subKey.label === "횟수" || subKey.label === "체온" ? "" : `${subKey.label} `;
                return `${prefix}${String(value)}${subKey.unit}`;
            })
            .filter((part): part is string => Boolean(part));
        return { value: parts.join(" · ") };
    }

    return { value: "" };
}

function answerTone(
    value: string,
    field: ServiceRecordFieldDescriptor,
): "burgundy" | "muted" | undefined {
    if (!value) return "muted";
    if (value === "이상없음") return "muted";
    if (field.normalValues && !field.normalValues.some((normalValue) => value.includes(normalValue))) {
        return "burgundy";
    }
    if (["열상", "울혈", "통증", "이상변"].some((abnormalValue) => value.includes(abnormalValue))) {
        return "burgundy";
    }
    return undefined;
}

function sortAssignmentsNewestFirst(assignments: ServiceRecordAssignment[]): ServiceRecordAssignment[] {
    return [...assignments].sort((a, b) => {
        const aTime = new Date(a.startDate).getTime();
        const bTime = new Date(b.startDate).getTime();
        const aSort = Number.isFinite(aTime) ? aTime : 0;
        const bSort = Number.isFinite(bTime) ? bTime : 0;
        return bSort - aSort || b.scheduleId - a.scheduleId;
    });
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

function endDateExpiry(endDate: string): string | null {
    const datePart = datePartOf(endDate);
    return datePart ? `${datePart}T20:00:00+09:00` : null;
}

function isPastDate(value: string | null): boolean {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now();
}

function datePartOf(value: string | null): string | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match?.[0] ?? null;
}

function formatDateKo(value: string | null): string {
    return formatDateForDisplay(value);
}

function formatShortDateKo(value: string | null): string {
    return formatDateKo(value);
}

function formatTimeKo(value: string | null): string {
    const date = parseDateForDisplay(value);
    if (!date) return "-";
    return new Intl.DateTimeFormat("ko-KR", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
    }).format(date);
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

function getErrorDescription(error: unknown): string {
    if (isRecord(error)) {
        const response = error.response;
        if (isRecord(response)) {
            const data = response.data;
            if (isRecord(data)) {
                const message = data.message ?? data.error;
                if (typeof message === "string" && message.trim()) {
                    return message;
                }
            }
        }

        if (typeof error.message === "string" && error.message.trim()) {
            return error.message;
        }
    }

    return "제공기록지 링크 발송 중 오류가 발생했습니다.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function SkeletonInfoRow({
    labelClassName,
    valueClassName,
}: {
    labelClassName: string;
    valueClassName: string;
}) {
    return (
        <div className="info-row">
            <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "info-row-label h-3 rounded-md", labelClassName)} />
            <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "ml-auto h-3 rounded-md", valueClassName)} />
        </div>
    );
}

function ServiceRecordsSkeleton() {
    return (
        <div className="detail-column" data-component="mobile-clients-service-records-skeleton" aria-hidden>
            <div className="info-card pop-up">
                <Skeleton className={cn(SERVICE_RECORD_SKELETON_CLASS, "info-card-title h-3 w-28 rounded-md")} />
                <SkeletonInfoRow labelClassName="w-8" valueClassName="w-14" />
                <SkeletonInfoRow labelClassName="w-14" valueClassName="w-36" />
                <SkeletonInfoRow labelClassName="w-16" valueClassName="w-28" />
                <SkeletonInfoRow labelClassName="w-16" valueClassName="w-10" />
                <SkeletonInfoRow labelClassName="w-16" valueClassName="w-24" />
                <SkeletonInfoRow labelClassName="w-16" valueClassName="w-36" />
            </div>
        </div>
    );
}
