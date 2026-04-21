"use client";

import { useMemo, useState } from "react";
import { CalendarClock, Headset, MapPin, Phone, Search, UserRound } from "lucide-react";

import {
    AnimatedSlotList,
    DetailPanel,
    EmptyState,
    InfoCard,
    InfoRow,
    ListEmptyState,
    ListPanel,
    PageSection,
    SplitLayout,
    StatsBar,
} from "@/components/app/v3";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useConsultationInquiries, useMarkConsultationInquiryRead } from "@/hooks/useConsultationInquiries";
import { cn } from "@/lib/utils";
import type { ConsultationInquiry } from "@/services/api";

const STATUS_TABS = [
    { label: "전체", value: "all" },
    { label: "신규", value: "new" },
    { label: "연락 완료", value: "contacted" },
    { label: "종료", value: "closed" },
];

const STATUS_LABEL: Record<string, string> = {
    new: "신규",
    contacted: "연락 완료",
    closed: "종료",
};

const STATUS_VARIANT: Record<string, "warning" | "success" | "neutral"> = {
    new: "warning",
    contacted: "success",
    closed: "neutral",
};

function formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    });
}

function formatDateTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "-";

    return date.toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function getStatusLabel(status: string): string {
    return STATUS_LABEL[status] ?? status;
}

function getStatusVariant(status: string): "warning" | "success" | "neutral" {
    return STATUS_VARIANT[status] ?? "neutral";
}

function getReadLabel(readAt: string | null): string {
    return readAt ? "읽음" : "읽지 않음";
}

function getReadVariant(readAt: string | null): "neutral" | "warning" {
    return readAt ? "neutral" : "warning";
}

export default function ConsultationsPage() {
    const [activeStatus, setActiveStatus] = useState("all");
    const [search, setSearch] = useState("");
    const [selectedInquiry, setSelectedInquiry] = useState<ConsultationInquiry | null>(null);

    const queryParams = useMemo(
        () => ({
            page: 1,
            limit: 50,
            status: activeStatus,
            search: search.trim() || undefined,
        }),
        [activeStatus, search],
    );

    const { data, isLoading } = useConsultationInquiries(queryParams);
    const markRead = useMarkConsultationInquiryRead();
    const inquiries = useMemo(() => data?.data ?? [], [data?.data]);
    const activeInquiry = selectedInquiry
        ? inquiries.find((item) => item.id === selectedInquiry.id) ?? selectedInquiry
        : null;

    const stats = useMemo(() => {
        return {
            total: data?.total ?? 0,
            unreadCount: inquiries.filter((item) => !item.readAt).length,
            newCount: inquiries.filter((item) => item.status === "new").length,
            contactedCount: inquiries.filter((item) => item.status === "contacted").length,
            closedCount: inquiries.filter((item) => item.status === "closed").length,
        };
    }, [data?.total, inquiries]);

    return (
        <PageSection name="consultations">
            <StatsBar
                name="consultations"
                isLoading={isLoading}
                items={[
                    { icon: Headset, value: stats.total, label: "전체 상담", counter: "건" },
                    { icon: CalendarClock, value: stats.unreadCount, label: "읽지 않음", counter: "건", colorIndex: 1 },
                    { icon: Phone, value: stats.contactedCount, label: "연락 완료", counter: "건", colorIndex: 2 },
                    { icon: Search, value: stats.closedCount, label: "종료", counter: "건", colorIndex: 3 },
                ]}
            />

            <SplitLayout hasSelection={!!activeInquiry} onBack={() => setSelectedInquiry(null)}>
                <ListPanel
                    title="상담 문의"
                    subtitle="babyjamjam.com 상담 신청 내역"
                    tabs={STATUS_TABS}
                    activeTab={activeStatus}
                    onTabChange={(value) => {
                        setActiveStatus(value);
                        setSelectedInquiry(null);
                    }}
                    searchValue={search}
                    onSearchChange={setSearch}
                    searchPlaceholder="이름, 연락처, 주소 검색..."
                    isLoading={isLoading}
                >
                    {!isLoading && inquiries.length === 0 ? (
                        <ListEmptyState
                            name="consultations-empty"
                            message={search ? "검색 결과가 없습니다" : "상담 문의가 없습니다"}
                        />
                    ) : (
                        <AnimatedSlotList<ConsultationInquiry>
                            items={inquiries}
                            isLoading={isLoading}
                            loadingCount={6}
                            className="space-y-2"
                            getItemKey={(item) => item.id}
                            slotClassName={({ item, isLoading: slotLoading }) => {
                                const isActive = !slotLoading && item?.id === activeInquiry?.id;

                                return cn(
                                    "flex items-center gap-3 rounded-[18px] border-2 border-transparent p-4 transition-all duration-200",
                                    !slotLoading && "cursor-pointer",
                                    isActive
                                        ? "bg-v3-primary-light border-v3-primary"
                                        : !slotLoading && "hover:bg-v3-primary-light/50 hover:border-v3-primary/30",
                                );
                            }}
                            onSlotClick={(inquiry) => {
                                setSelectedInquiry(inquiry);
                                if (!inquiry.readAt) {
                                    markRead.mutate(inquiry.id);
                                }
                            }}
                            render={({ item, isLoading: slotLoading }) => {
                                if (slotLoading) {
                                    return (
                                        <>
                                            <Skeleton className="h-11 w-11 shrink-0 rounded-[14px] bg-v3-dim-white" />
                                            <div className="min-w-0 flex-1">
                                                <Skeleton className="mb-2 h-4 w-28 bg-v3-dim-white" />
                                                <Skeleton className="h-3 w-44 bg-v3-dim-white" />
                                            </div>
                                            <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white" />
                                        </>
                                    );
                                }

                                if (!item) return null;

                                return (
                                    <>
                                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-v3-primary text-white shadow-md">
                                            <Headset className="h-5 w-5" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <div className="mb-1 flex items-center gap-2">
                                                <span className="truncate text-[0.86rem] font-bold text-v3-dark">
                                                    {item.motherName}
                                                </span>
                                                <StatusPill variant={getStatusVariant(item.status)} size="sm">
                                                    {getStatusLabel(item.status)}
                                                </StatusPill>
                                                <StatusPill variant={getReadVariant(item.readAt)} size="sm">
                                                    {getReadLabel(item.readAt)}
                                                </StatusPill>
                                            </div>
                                            <div className="flex min-w-0 items-center gap-2 text-[0.72rem] text-v3-text-muted">
                                                <Phone className="h-3.5 w-3.5 shrink-0" />
                                                <span className="shrink-0">{item.phone}</span>
                                                <span className="truncate">{item.address}</span>
                                            </div>
                                        </div>
                                    </>
                                );
                            }}
                        />
                    )}
                </ListPanel>

                {activeInquiry ? (
                    <DetailPanel
                        avatar={
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[20px] bg-v3-primary text-white shadow-lg">
                                <UserRound className="h-7 w-7" />
                            </div>
                        }
                        title={activeInquiry.motherName}
                        subtitle={`${activeInquiry.branchName ?? "현재 지점"} · ${formatDateTime(activeInquiry.createdAt)}`}
                        badges={
                            <>
                                <StatusPill variant={getStatusVariant(activeInquiry.status)} size="sm">
                                    {getStatusLabel(activeInquiry.status)}
                                </StatusPill>
                                <StatusPill variant={getReadVariant(activeInquiry.readAt)} size="sm">
                                    {getReadLabel(activeInquiry.readAt)}
                                </StatusPill>
                            </>
                        }
                    >
                        <div data-component="consultations-detail" className="space-y-4">
                            <InfoCard title="상담 정보">
                                <InfoRow label="연락처" value={activeInquiry.phone} />
                                <InfoRow label="주소" value={activeInquiry.address} />
                                <InfoRow label="출산 예정일" value={formatDate(activeInquiry.dueDate)} />
                                <InfoRow label="출산 경험" value={activeInquiry.birthExperience} />
                                <InfoRow label="유입 경로" value={activeInquiry.referralSource} />
                            </InfoCard>

                            <InfoCard title="희망 사항">
                                <InfoRow label="바우처 유형" value={activeInquiry.voucherType || "-"} />
                                <InfoRow label="희망 관리사" value={activeInquiry.preferredCaregiverName || "-"} />
                                <InfoRow label="신청 경로" value={activeInquiry.source} />
                                <InfoRow label="개인정보 동의" value={formatDateTime(activeInquiry.privacyAcceptedAt)} />
                                <InfoRow label="읽음 상태" value={getReadLabel(activeInquiry.readAt)} />
                            </InfoCard>

                            <InfoCard title="지점">
                                <InfoRow label="담당 지점" value={activeInquiry.branchName ?? "-"} />
                                <InfoRow label="공개 지점 ID" value={activeInquiry.publicBranchSlug} />
                            </InfoCard>
                        </div>
                    </DetailPanel>
                ) : (
                    <EmptyState
                        name="consultations-empty-detail"
                        icon={MapPin}
                        message="상담 문의를 선택하면 상세 정보가 표시됩니다"
                    />
                )}
            </SplitLayout>
        </PageSection>
    );
}
