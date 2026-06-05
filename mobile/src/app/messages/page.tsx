"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessageCircle, ThumbsUp } from "lucide-react";

import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { api } from "@/lib/api/client";
import { fetchAllAlimtalkLogs } from "@/lib/alimtalk/logs";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import { ListItemRow, ListLoadMoreButton, ListLoadMoreSentinel } from "@/components/app/mobile-redesign/primitives";
import {
  Avatar,
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailActions,
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailSheet,
  MobileDetailTabPanel,
  type AvatarTone,
  type DetailTab,
  type InfoTone,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

interface AlimtalkLogRecord {
  id: number;
  provider: string;
  templateKey: string;
  receiver: string;
  clientId: number | null;
  messageBody: string;
  status: "pending" | "sent" | "failed";
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  ruleName: string | null;
  eventType: string | null;
  recipientName: string | null;
  clientName: string | null;
  employeeName: string | null;
}

interface UpcomingAlimtalkJob {
  id: string;
  ruleId: string;
  ruleName: string;
  eventType: string | null;
  recipientType: string;
  recipientPhone: string | null;
  templateKey: string;
  status: string;
  scheduledFor: string;
  clientId: number | null;
  employeeScheduleId: number | null;
  payload: Record<string, unknown> | null;
}

type MessageChannel = "kakao" | "sms";
type MessageStatus = "pending" | "sent" | "failed";
type MessageFilter = "전체" | "알림톡" | "SMS" | "실패";
type MessageSection = "오늘" | "어제" | "이전";
type MessageDetailTab = "content" | "recipient" | "template";

interface MessageThreadRow {
  id: string;
  recipient: string;
  initial: string;
  avatarTone: AvatarTone;
  channel: MessageChannel;
  title: string;
  timeLabel: string;
  section: MessageSection;
  status: MessageStatus;
  statusLabel: string;
  receiver: string;
  messageBody: string;
  templateName: string;
  trigger: string;
  employeeName: string;
  serviceStartDate: string;
  clientId: number | null;
  sentAt: string;
}

const MESSAGE_FILTERS: MessageFilter[] = ["전체", "알림톡", "SMS", "실패"];
const MESSAGE_SECTION_ORDER: MessageSection[] = ["오늘", "어제", "이전"];
const DETAIL_TABS: DetailTab[] = [
  { id: "content", label: "메시지" },
  { id: "recipient", label: "수신자" },
  { id: "template", label: "템플릿 정보" },
];

const AVATAR_TONES: AvatarTone[] = ["orange", "primary", "burgundy", "green", "purple"];
const MESSAGE_TEMPLATE_DISPLAY_NAMES: Record<string, string> = {
  client_greeting_sms: "인사 메시지",
  GREETING: "인사 메시지",
  PRICE_INFO: "비용 안내",
  SERVICE_INFO: "서비스 안내",
};

function getInitial(name: string): string {
  const trimmed = name.trim();
  return trimmed.charAt(0) || "?";
}

function getChannel(provider: string): MessageChannel {
  return provider.toLowerCase().includes("sms") ? "sms" : "kakao";
}

function getStatusLabel(status: MessageStatus): string {
  if (status === "failed") return "실패";
  if (status === "pending") return "대기";
  return "발송 성공";
}

function getStatusTone(status: MessageStatus): InfoTone {
  if (status === "failed") return "burgundy";
  if (status === "pending") return "orange";
  return "green";
}

function getTemplateDisplayName(log: AlimtalkLogRecord): string {
  const templateKey = log.templateKey.trim();
  const ruleName = log.ruleName?.trim();

  if (templateKey in MESSAGE_TEMPLATE_DISPLAY_NAMES) {
    return MESSAGE_TEMPLATE_DISPLAY_NAMES[templateKey];
  }

  return ruleName || templateKey;
}

function getDateSection(iso: string): MessageSection {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "이전";

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  if (target.getTime() >= today.getTime()) return "오늘";
  if (target.getTime() >= yesterday.getTime()) return "어제";
  return "이전";
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "방금";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMinutes < 1) return "방금";
  if (diffMinutes < 60) return `${diffMinutes}분 전`;
  if (diffMinutes < 24 * 60 && getDateSection(iso) === "오늘") {
    return `${Math.floor(diffMinutes / 60)}시간 전`;
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatSentAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function mapLogToThread(log: AlimtalkLogRecord, index: number): MessageThreadRow {
  const recipient = log.recipientName ?? log.clientName ?? log.employeeName ?? log.receiver;
  const templateDisplayName = getTemplateDisplayName(log);
  return {
    id: `log-${log.id}`,
    recipient,
    initial: getInitial(recipient),
    avatarTone: log.status === "failed" ? "burgundy" : AVATAR_TONES[index % AVATAR_TONES.length],
    channel: getChannel(log.provider),
    title: templateDisplayName,
    timeLabel: formatRelativeTime(log.createdAt),
    section: getDateSection(log.createdAt),
    status: log.status,
    statusLabel: getStatusLabel(log.status),
    receiver: log.receiver,
    messageBody: log.messageBody || "메시지 본문을 불러오지 못했습니다.",
    templateName: templateDisplayName,
    trigger: log.eventType ?? "수동 발송",
    employeeName: log.employeeName ?? "미배정",
    serviceStartDate: "-",
    clientId: log.clientId,
    sentAt: formatSentAt(log.createdAt),
  };
}

function filterRows(rows: MessageThreadRow[], filter: MessageFilter): MessageThreadRow[] {
  if (filter === "알림톡") return rows.filter((row) => row.channel === "kakao");
  if (filter === "SMS") return rows.filter((row) => row.channel === "sms");
  if (filter === "실패") return rows.filter((row) => row.status === "failed");
  return rows;
}

function buildSections(
  rows: MessageThreadRow[],
): Array<{ title: MessageSection; fullRows: MessageThreadRow[]; fullCount: number }> {
  return MESSAGE_SECTION_ORDER.map((title) => {
    const filtered = rows.filter((row) => row.section === title);
    return { title, fullRows: filtered, fullCount: filtered.length };
  }).filter((section) => section.fullRows.length > 0);
}

function getFilterCount(rows: MessageThreadRow[], filter: MessageFilter): string {
  return String(filterRows(rows, filter).length);
}

export default function MessagesPage() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<MessageFilter>("전체");
  const [selectedMessage, setSelectedMessage] = useState<MessageThreadRow | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activeDetailTab, setActiveDetailTab] = useState<MessageDetailTab>("content");

  const { data: userTemplatesData } = useMessageTemplates(1, 100);
  const userTemplates = Array.isArray(userTemplatesData?.data) ? userTemplatesData.data : [];

  const { data: upcomingJobsData } = useQuery<UpcomingAlimtalkJob[]>({
    queryKey: ["alimtalk", "upcoming", 100],
    queryFn: async () => {
      const res = await api.get<UpcomingAlimtalkJob[]>("/alimtalk-trigger-jobs/upcoming", { params: { limit: 100 } });
      return res.data;
    },
  });

  const { data: historyLogsData, isLoading: isHistoryLogsLoading } = useQuery<AlimtalkLogRecord[]>({
    queryKey: ["alimtalk", "logs", "all"],
    queryFn: () => fetchAllAlimtalkLogs<AlimtalkLogRecord>(),
  });

  const upcomingJobs = useMemo(
    () => (Array.isArray(upcomingJobsData) ? upcomingJobsData : []),
    [upcomingJobsData],
  );
  const historyLogs = useMemo(
    () => (Array.isArray(historyLogsData) ? historyLogsData : []),
    [historyLogsData],
  );
  const liveRows = useMemo(
    () => historyLogs.map((log, index) => mapLogToThread(log, index)),
    [historyLogs],
  );
  const rows = liveRows;
  const isFilterPillLoading = isHistoryLogsLoading && historyLogsData === undefined;
  const filteredRows = useMemo(() => filterRows(rows, activeFilter), [activeFilter, rows]);
  const sectionsFull = useMemo(() => buildSections(filteredRows), [filteredRows]);

  const maxFullCount = useMemo(
    () => sectionsFull.reduce((m, s) => Math.max(m, s.fullCount), 0),
    [sectionsFull],
  );

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: activeFilter,
      totalItems: maxFullCount,
    });

  const sections = useMemo(
    () =>
      sectionsFull
        .map((s) => ({ ...s, rows: s.fullRows.slice(0, visibleCount) }))
        .filter((s) => s.rows.length > 0),
    [sectionsFull, visibleCount],
  );
  const detailMessage = selectedMessage ?? filteredRows[0] ?? rows[0];
  const templateCount = userTemplates.length;
  const automationSubLabel = upcomingJobs.length > 0 ? `${upcomingJobs.length}건 예정` : "예정 없음";

  const openDetail = (message: MessageThreadRow) => {
    setSelectedMessage(message);
    setActiveDetailTab("content");
    setIsDetailOpen(true);
  };

  const handleNewMessageClick = () => {
    router.push("/messages/new");
  };

  return (
    <>
      <MobileDetailSheet
        name="messages"
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        list={
        <div className="shell-content" data-component="mobile-messages-content">
          <div className="list-card pop-up" data-component="mobile-messages-list-card">
            <div className="list-title" data-component="mobile-messages-title">
              <span className="list-title-text">메시지</span>
              <button
                type="button"
                className="list-action"
                data-component="mobile-messages-new"
                onClick={handleNewMessageClick}
              >
                + 새 메시지
              </button>
            </div>

            <div className="messages-hub-wrap" data-component="mobile-messages-hub-wrap">
              <div className="hub-tiles" data-component="mobile-messages-hub-tiles">
                <button type="button" className="hub-tile" onClick={() => setActiveFilter("알림톡")}>
                  <span className="hub-tile-icon hub-tile-icon-kakao">
                    <MessageCircle size={16} strokeWidth={2.5} />
                  </span>
                  <span className="hub-tile-text">
                    <span className="hub-tile-label">알림톡</span>
                    <span className="hub-tile-sub">{automationSubLabel}</span>
                  </span>
                </button>
                <Link href="/messages/templates" className="hub-tile" data-component="mobile-messages-templates">
                  <span className="hub-tile-icon hub-tile-icon-primary">
                    <ThumbsUp size={16} strokeWidth={2.5} />
                  </span>
                  <span className="hub-tile-text">
                    <span className="hub-tile-label">템플릿</span>
                    <span className="hub-tile-sub">{templateCount}개 등록</span>
                  </span>
                </Link>
              </div>
            </div>

            <div className="filter-row" data-component="mobile-messages-filter-row">
              {isFilterPillLoading
                ? MESSAGE_FILTERS.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className="filter-pill filter-pill-skeleton"
                      data-component="mobile-redesign-filter-pill"
                      data-loading="true"
                      aria-hidden="true"
                      disabled
                      tabIndex={-1}
                    >
                      <span className="filter-pill-skeleton-content">
                        {filter}
                        <span className="filter-pill-skeleton-count">00</span>
                      </span>
                    </button>
                  ))
                : MESSAGE_FILTERS.map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      className={`filter-pill ${activeFilter === filter ? "active" : ""}`}
                      data-component="mobile-redesign-filter-pill"
                      aria-pressed={activeFilter === filter}
                      onClick={() => setActiveFilter(filter)}
                    >
                      {filter}
                      <span className={`count ${filter === "실패" ? "messages-filter-count-danger" : ""}`}>
                        {getFilterCount(rows, filter)}
                      </span>
                    </button>
                  ))}
            </div>

            <div ref={scrollContainerRef} className="list-card-scroll" data-component="mobile-messages-scroll">
              {sections.length > 0 ? (
                sections.map((section) => (
                  <div className="section-block" key={section.title} data-component="mobile-messages-section">
                    <div className="section-header" data-component="mobile-messages-section-header">{section.title}</div>
                    {section.rows.map((row: MessageThreadRow, idx) => (
                      <ListItemRow
                        key={row.id}
                        dataComponent="mobile-messages-row"
                        left={<Avatar initial={row.initial} tone={row.avatarTone} />}
                        style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
                        name={
                          <>
                            {row.recipient}
                            <span className={`thread-channel ${row.channel}`}>
                              {row.channel === "kakao" ? "알림톡" : "SMS"}
                            </span>
                          </>
                        }
                        meta={row.title}
                        right={
                          row.status === "failed" ? (
                            <span className="message-row-status" data-component="mobile-messages-row-status">
                              <span className="badge badge-burgundy">실패</span>
                              <span
                                className="dday-sub"
                                data-component="mobile-messages-row-failed-time"
                              >
                                {row.timeLabel}
                              </span>
                            </span>
                          ) : row.status === "sent" ? (
                            <span className="message-row-status" data-component="mobile-messages-row-status">
                              <span className="badge badge-green">완료</span>
                              <span
                                className="dday-sub"
                                data-component="mobile-messages-row-sent-time"
                              >
                                {row.timeLabel}
                              </span>
                            </span>
                          ) : (
                            <span className="dday-sub">{row.timeLabel}</span>
                          )
                        }
                        onClick={() => openDetail(row)}
                      />
                    ))}
                  </div>
                ))
              ) : (
                <div
                  data-component="mobile-messages-empty"
                  className="px-4 py-12 text-center text-[0.78rem] text-v3-text-muted"
                >
                  발송 내역이 없습니다.
                </div>
              )}
              {!isInitialLoad && hasMore && (
                <ListLoadMoreSentinel
                  sentinelRef={sentinelRef}
                  dataComponentPrefix="mobile-messages"
                />
              )}
            </div>
            {isInitialLoad && hasMore && (
              <div className="list-card-footer" data-component="mobile-messages-footer">
                <ListLoadMoreButton
                  onLoadMore={loadMore}
                  dataComponentPrefix="mobile-messages"
                />
              </div>
            )}
          </div>
        </div>
        }
        detail={
        detailMessage ? (
          <MobileDetailPage name="messages" dataComponent="mobile-messages-detail-body">
            <MobileDetailHeader
              name="messages"
              avatar={detailMessage.initial}
              avatarTone={detailMessage.avatarTone}
              title={detailMessage.recipient}
              badges={[
                {
                  label: detailMessage.channel === "kakao" ? "알림톡" : "SMS",
                  tone: detailMessage.channel === "kakao" ? "kakao" : "primary",
                },
                { label: detailMessage.statusLabel, tone: getStatusTone(detailMessage.status) },
              ]}
            />

            <MobileDetailActions
              name="messages"
              actions={[
                {
                  label: "재발송 준비 중",
                  variant: "secondary",
                  disabled: true,
                  ariaLabel: "재발송 기능은 준비 중입니다.",
                  dataComponent: "mobile-messages-resend-disabled",
                },
                {
                  label: "고객 보기",
                  variant: "primary",
                  href: detailMessage.clientId ? `/clients/${detailMessage.clientId}` : "/clients",
                  className: "messages-detail-link",
                },
              ]}
            />

            <DetailTabPills
              tabs={DETAIL_TABS}
              activeTab={activeDetailTab}
              onTabChange={(tab) => setActiveDetailTab(tab as MessageDetailTab)}
            />

            <MobileDetailTabPanel
              name="messages"
              tabId="content"
              activeTab={activeDetailTab}
              dataComponent="mobile-messages-detail-content-tab"
            >
              <InfoCard title="메시지 본문" padded>
                <div className="messages-body-text" data-component="mobile-messages-detail-message-body">
                  {detailMessage.messageBody}
                </div>
              </InfoCard>
            </MobileDetailTabPanel>

            <MobileDetailTabPanel
              name="messages"
              tabId="recipient"
              activeTab={activeDetailTab}
              dataComponent="mobile-messages-detail-recipient-tab"
            >
              <InfoCard title="수신자 정보">
                <InfoRow label="수신자" value={detailMessage.recipient} />
                <InfoRow label="유형" value="고객" />
                <InfoRow label="연락처" value={detailMessage.receiver} />
                <InfoRow label="채널 ID" value={detailMessage.channel === "kakao" ? "@babyjamjam_kakao" : "SMS"} />
              </InfoCard>
            </MobileDetailTabPanel>

            <MobileDetailTabPanel
              name="messages"
              tabId="template"
              activeTab={activeDetailTab}
              dataComponent="mobile-messages-detail-template-tab"
            >
              <InfoCard title="템플릿 정보">
                <InfoRow label="템플릿" value={detailMessage.templateName} />
                <InfoRow label="트리거" value={detailMessage.trigger} />
                <InfoRow label="채널" value={detailMessage.channel === "kakao" ? "알림톡 (Kakao)" : "SMS"} />
              </InfoCard>

              <InfoCard title="발송 정보" delay={60}>
                <InfoRow label="상태" value={detailMessage.statusLabel} tone={getStatusTone(detailMessage.status)} />
                <InfoRow label="발송 시각" value={detailMessage.sentAt} />
                <InfoRow label="트리거" value={detailMessage.trigger} />
                <InfoRow label="발송 ID" value={detailMessage.id.replace("log-", "M-")} />
              </InfoCard>

              <InfoCard title="변수" delay={120}>
                <InfoRow label="clientName" value={detailMessage.recipient} />
                <InfoRow label="employeeName" value={detailMessage.employeeName} />
                <InfoRow label="serviceStartDate" value={detailMessage.serviceStartDate} />
              </InfoCard>
            </MobileDetailTabPanel>
          </MobileDetailPage>
        ) : null
        }
      />

    </>
  );
}
