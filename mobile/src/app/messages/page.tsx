"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { MessageCircle, ThumbsUp } from "lucide-react";

import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { api } from "@/lib/api/client";
import {
  Avatar,
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailSheet,
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

const BUILTIN_TEMPLATE_COUNT = 7;

const MESSAGE_FILTERS: MessageFilter[] = ["전체", "알림톡", "SMS", "실패"];
const MESSAGE_SECTION_ORDER: MessageSection[] = ["오늘", "어제", "이전"];
const DETAIL_TABS: DetailTab[] = [
  { id: "content", label: "메시지" },
  { id: "recipient", label: "수신자" },
  { id: "template", label: "템플릿 정보" },
];

const MOCKUP_MESSAGE_ROWS: MessageThreadRow[] = [
  {
    id: "mock-park-seoyeon",
    recipient: "박서연",
    initial: "박",
    avatarTone: "orange",
    channel: "kakao",
    title: "서비스 안내",
    timeLabel: "방금",
    section: "오늘",
    status: "sent",
    statusLabel: "발송 성공",
    receiver: "010-1234-5678",
    messageBody:
      "안녕하세요 박서연 고객님,\n\n오늘 오전 9시 김민지 매니저가 방문 예정입니다. 준비물은 별도로 안내드린 사항을 참고해 주세요.\n\n문의사항이 있으시면 언제든지 연락 주세요.\n\n아가잼잼 인천점",
    templateName: "서비스 시작 리마인드",
    trigger: "자동 (서비스 시작)",
    employeeName: "김민지",
    serviceStartDate: "2025-05-10",
    clientId: null,
    sentAt: "2025. 5. 10. 오전 8:32",
  },
  {
    id: "mock-kim-doyoon",
    recipient: "김도윤",
    initial: "김",
    avatarTone: "primary",
    channel: "kakao",
    title: "제공인력 배정 안내",
    timeLabel: "2시간 전",
    section: "오늘",
    status: "sent",
    statusLabel: "발송 성공",
    receiver: "010-2345-6789",
    messageBody: "김도윤 고객님, 담당 제공인력 배정이 완료되었습니다. 방문 일정은 별도 안내드리겠습니다.",
    templateName: "제공인력 배정 안내",
    trigger: "자동 (제공인력 배정)",
    employeeName: "이하은",
    serviceStartDate: "2025-05-12",
    clientId: null,
    sentAt: "2025. 5. 10. 오전 6:41",
  },
  {
    id: "mock-jung-yujin",
    recipient: "[더미] 정유진",
    initial: "정",
    avatarTone: "burgundy",
    channel: "kakao",
    title: "서비스 안내",
    timeLabel: "방금",
    section: "오늘",
    status: "failed",
    statusLabel: "실패",
    receiver: "010-3456-7890",
    messageBody: "정유진 고객님, 서비스 안내 메시지 발송에 실패했습니다. 연락처를 확인해 주세요.",
    templateName: "서비스 안내",
    trigger: "자동 (서비스 시작)",
    employeeName: "김민지",
    serviceStartDate: "2025-05-10",
    clientId: null,
    sentAt: "2025. 5. 10. 오전 8:34",
  },
  {
    id: "mock-jang-haneul",
    recipient: "장하늘",
    initial: "장",
    avatarTone: "green",
    channel: "kakao",
    title: "서비스 종료 안내",
    timeLabel: "5/9",
    section: "어제",
    status: "sent",
    statusLabel: "발송 성공",
    receiver: "010-4567-8901",
    messageBody: "장하늘 고객님, 예정된 서비스 종료 일정을 안내드립니다. 이용해 주셔서 감사합니다.",
    templateName: "서비스 종료 안내",
    trigger: "자동 (서비스 종료)",
    employeeName: "오서윤",
    serviceStartDate: "2025-04-09",
    clientId: null,
    sentAt: "2025. 5. 9. 오후 6:20",
  },
  {
    id: "mock-yoon-jia",
    recipient: "윤지아",
    initial: "윤",
    avatarTone: "purple",
    channel: "sms",
    title: "고객 등록 환영",
    timeLabel: "5/9",
    section: "어제",
    status: "sent",
    statusLabel: "발송 성공",
    receiver: "010-5678-9012",
    messageBody: "윤지아 고객님, 아가잼잼 인천점 등록이 완료되었습니다.",
    templateName: "고객 등록 환영",
    trigger: "수동 발송",
    employeeName: "미배정",
    serviceStartDate: "미정",
    clientId: null,
    sentAt: "2025. 5. 9. 오후 2:15",
  },
  {
    id: "mock-choi-yerin",
    recipient: "최예린",
    initial: "최",
    avatarTone: "orange",
    channel: "kakao",
    title: "서비스 시작 D-1 안내",
    timeLabel: "5/9",
    section: "어제",
    status: "sent",
    statusLabel: "발송 성공",
    receiver: "010-6789-0123",
    messageBody: "최예린 고객님, 내일 서비스가 시작됩니다. 방문 전 준비 사항을 확인해 주세요.",
    templateName: "서비스 시작 D-1 안내",
    trigger: "자동 (D-1)",
    employeeName: "한유나",
    serviceStartDate: "2025-05-10",
    clientId: null,
    sentAt: "2025. 5. 9. 오전 9:00",
  },
  {
    id: "mock-lee-suhyun",
    recipient: "이수현",
    initial: "이",
    avatarTone: "primary",
    channel: "kakao",
    title: "서비스 종료 안내",
    timeLabel: "4/22",
    section: "이전",
    status: "sent",
    statusLabel: "발송 성공",
    receiver: "010-7890-1234",
    messageBody: "이수현 고객님, 서비스 종료 안내드립니다. 추가 상담이 필요하시면 지점으로 연락해 주세요.",
    templateName: "서비스 종료 안내",
    trigger: "자동 (서비스 종료)",
    employeeName: "정다은",
    serviceStartDate: "2025-03-22",
    clientId: null,
    sentAt: "2025. 4. 22. 오전 10:12",
  },
];

const AVATAR_TONES: AvatarTone[] = ["orange", "primary", "burgundy", "green", "purple"];

function getInitial(name: string): string {
  const trimmed = name.replace("[더미]", "").trim();
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
  return {
    id: `log-${log.id}`,
    recipient,
    initial: getInitial(recipient),
    avatarTone: log.status === "failed" ? "burgundy" : AVATAR_TONES[index % AVATAR_TONES.length],
    channel: getChannel(log.provider),
    title: log.ruleName ?? log.templateKey,
    timeLabel: formatRelativeTime(log.createdAt),
    section: getDateSection(log.createdAt),
    status: log.status,
    statusLabel: getStatusLabel(log.status),
    receiver: log.receiver,
    messageBody: log.messageBody || "메시지 본문을 불러오지 못했습니다.",
    templateName: log.ruleName ?? log.templateKey,
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

function buildSections(rows: MessageThreadRow[]): Array<{ title: MessageSection; rows: MessageThreadRow[] }> {
  return MESSAGE_SECTION_ORDER.map((title) => ({
    title,
    rows: rows.filter((row) => row.section === title),
  })).filter((section) => section.rows.length > 0);
}

function getFilterCount(rows: MessageThreadRow[], filter: MessageFilter, hasLiveRows: boolean): string {
  if (!hasLiveRows) {
    if (filter === "전체") return "36";
    if (filter === "알림톡") return "28";
    if (filter === "SMS") return "5";
    return "3";
  }
  return String(filterRows(rows, filter).length);
}

export default function MessagesPage() {
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

  const { data: historyLogsData } = useQuery<AlimtalkLogRecord[]>({
    queryKey: ["alimtalk", "logs", 200],
    queryFn: async () => {
      const res = await api.get<AlimtalkLogRecord[]>("/alimtalk-logs", { params: { limit: 200 } });
      return res.data;
    },
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
  const hasLiveRows = liveRows.length > 0;
  const rows = hasLiveRows ? liveRows : MOCKUP_MESSAGE_ROWS;
  const filteredRows = useMemo(() => filterRows(rows, activeFilter), [activeFilter, rows]);
  const sections = useMemo(() => buildSections(filteredRows), [filteredRows]);
  const detailMessage = selectedMessage ?? filteredRows[0] ?? rows[0];
  const templateCount = Math.max(BUILTIN_TEMPLATE_COUNT + userTemplates.length, 12);
  const automationSubLabel = upcomingJobs.length > 0 ? `${upcomingJobs.length}건 예정` : "자동 발송 4종";

  const openDetail = (message: MessageThreadRow) => {
    setSelectedMessage(message);
    setActiveDetailTab("content");
    setIsDetailOpen(true);
  };

  return (
    <MobileDetailSheet
      name="messages"
      isOpen={isDetailOpen}
      onClose={() => setIsDetailOpen(false)}
      list={
        <div className="shell-content" data-component="mobile-messages-content">
          <div className="list-card pop-up" data-component="mobile-messages-list-card">
            <div className="list-title" data-component="mobile-messages-title">
              <span className="list-title-text">메시지</span>
              <Link href="/messages/new" className="list-action" data-component="mobile-messages-new">
                + 새 메시지
              </Link>
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
              {MESSAGE_FILTERS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  className={`filter-pill ${activeFilter === filter ? "active" : ""}`}
                  aria-pressed={activeFilter === filter}
                  onClick={() => setActiveFilter(filter)}
                >
                  {filter}
                  <span className={`count ${filter === "실패" ? "messages-filter-count-danger" : ""}`}>
                    {getFilterCount(rows, filter, hasLiveRows)}
                  </span>
                </button>
              ))}
            </div>

            <div className="list-card-scroll" data-component="mobile-messages-scroll">
              {sections.map((section) => (
                <div className="section-block" key={section.title} data-component="mobile-messages-section">
                  <div className="section-header" data-component="mobile-messages-section-header">{section.title}</div>
                  {section.rows.map((row) => (
                    <button
                      key={row.id}
                      type="button"
                      className="list-item"
                      data-component="mobile-messages-row"
                      onClick={() => openDetail(row)}
                    >
                      <Avatar initial={row.initial} tone={row.avatarTone} />
                      <span className="list-info">
                        <span className="list-name">
                          {row.recipient}
                          <span className={`thread-channel ${row.channel}`}>
                            {row.channel === "kakao" ? "알림톡" : "SMS"}
                          </span>
                        </span>
                        <span className="list-meta">{row.title}</span>
                      </span>
                      <span className="list-right">
                        {row.status === "failed" ? (
                          <span className="badge badge-burgundy">실패</span>
                        ) : (
                          <span className="dday-sub">{row.timeLabel}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      }
      detail={
        detailMessage ? (
          <div className="detail-body" data-component="mobile-messages-detail-body">
            <div className="client-detail-header pop-up" data-component="mobile-messages-detail-header">
              <Avatar initial={detailMessage.initial} tone={detailMessage.avatarTone} large />
              <div className="client-detail-title" data-component="mobile-messages-detail-title">
                <div className="client-detail-name" data-component="mobile-messages-detail-name">{detailMessage.recipient}</div>
                <div className="client-detail-badges" data-component="mobile-messages-detail-badges">
                  <span className={`badge-mini ${detailMessage.channel === "kakao" ? "kakao" : "primary"}`}>
                    {detailMessage.channel === "kakao" ? "알림톡" : "SMS"}
                  </span>
                  <span className={`badge-mini ${getStatusTone(detailMessage.status)}`}>
                    {detailMessage.statusLabel}
                  </span>
                </div>
              </div>
            </div>

            <div className="detail-actions" data-component="mobile-messages-detail-actions">
              <button type="button" className="btn btn-secondary">
                재발송
              </button>
              <Link
                href={detailMessage.clientId ? `/clients/${detailMessage.clientId}` : "/clients"}
                className="btn btn-primary messages-detail-link"
              >
                고객 보기
              </Link>
            </div>

            <DetailTabPills
              tabs={DETAIL_TABS}
              activeTab={activeDetailTab}
              onTabChange={(tab) => setActiveDetailTab(tab as MessageDetailTab)}
            />

            <div
              className={`tab-content ${activeDetailTab === "content" ? "active" : ""}`}
              data-component="mobile-messages-detail-content-tab"
            >
              <InfoCard title="메시지 본문" padded>
                <div className="messages-body-text" data-component="mobile-messages-detail-message-body">
                  {detailMessage.messageBody}
                </div>
              </InfoCard>
            </div>

            <div
              className={`tab-content ${activeDetailTab === "recipient" ? "active" : ""}`}
              data-component="mobile-messages-detail-recipient-tab"
            >
              <InfoCard title="수신자 정보">
                <InfoRow label="수신자" value={detailMessage.recipient} />
                <InfoRow label="유형" value="고객" />
                <InfoRow label="연락처" value={detailMessage.receiver} />
                <InfoRow label="채널 ID" value={detailMessage.channel === "kakao" ? "@babyjamjam_kakao" : "SMS"} />
              </InfoCard>
            </div>

            <div
              className={`tab-content ${activeDetailTab === "template" ? "active" : ""}`}
              data-component="mobile-messages-detail-template-tab"
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
            </div>
          </div>
        ) : null
      }
    />
  );
}
