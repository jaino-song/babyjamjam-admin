"use client";

import { type ReactNode } from "react";
import { CheckCircle2, CircleAlert, FileCheck2, MessageCircle, MoreVertical, SquarePen, Trash2, User } from "lucide-react";

import { Client } from "@/lib/client/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailActions,
  MobileDetailHeader,
  MobileDetailPage,
  MobileDetailTabPanel,
} from "@/components/app/mobile-redesign/detail-sheet";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return date.toLocaleDateString("ko-KR");
}

function formatPrice(price: string | null): string {
  if (!price) return "-";
  const amount = Number(price.replace(/,/g, ""));
  if (Number.isNaN(amount)) return price;
  return `${amount.toLocaleString("ko-KR")}원`;
}

function clientFeatureLabel(client: Client): string | null {
  if (client.breastPump) return "유축기 대여";
  if (client.careCenter) return "조리원 이용";
  if (client.voucherClient) return "바우처";
  return client.type;
}

function clientFeatureLabelTone(client: Client): "green" | "burgundy" {
  if (client.voucherClient) return "green";
  return "burgundy";
}

function documentStatusLabel(status: Client["documentStatus"]): string {
  switch (status) {
    case "completed":
      return "완료";
    case "opened":
    case "requested":
      return "검토 필요";
    case "created":
      return "발송 대기";
    case "rejected":
    case "revoked":
    case "deleted":
      return "확인 필요";
    default:
      return "미발급";
  }
}

function documentStatusTone(status: Client["documentStatus"]): "green" | "primary" | "orange" | "muted" | "burgundy" {
  switch (status) {
    case "completed":
      return "green";
    case "opened":
    case "requested":
      return "primary";
    case "created":
      return "orange";
    case "rejected":
    case "revoked":
    case "deleted":
      return "burgundy";
    default:
      return "muted";
  }
}

export interface ClientGroup {
  key: string;
  title: string;
  badge: string;
  badgeTone: "burgundy" | "primary" | "muted" | "green" | "orange";
  badgeMini: "burgundy" | "primary" | "muted" | "green" | "orange";
  match: (c: Client) => boolean;
  counter: string;
}

export const GROUPS: ClientGroup[] = [
  {
    key: "active",
    title: "진행중",
    badge: "진행중",
    badgeTone: "primary",
    badgeMini: "primary",
    match: (c) => c.serviceStatus === "active",
    counter: "명",
  },
  {
    key: "replacement_requested",
    title: "교체 요청",
    badge: "교체 요청",
    badgeTone: "burgundy",
    badgeMini: "burgundy",
    match: (c) => c.serviceStatus === "replacement_requested",
    counter: "명",
  },
  {
    key: "waiting",
    title: "대기",
    badge: "대기",
    badgeTone: "orange",
    badgeMini: "orange",
    match: (c) => c.serviceStatus === "waiting",
    counter: "명",
  },
  {
    key: "terminated",
    title: "중단",
    badge: "중단",
    badgeTone: "muted",
    badgeMini: "muted",
    match: (c) => c.serviceStatus === "terminated",
    counter: "명",
  },
  {
    key: "completed",
    title: "완료",
    badge: "완료",
    badgeTone: "green",
    badgeMini: "green",
    match: (c) => c.serviceStatus === "completed",
    counter: "명",
  },
];

export function shouldShowMissingContractBadge(client: Client): boolean {
  return client.serviceStatus === "active" && client.documentStatus !== "completed";
}

export type DetailTabId = "basic" | "contracts" | "alimtalk";

export interface ClientNotificationLogRecord {
  id: number;
  provider: string;
  templateKey: string;
  receiver: string | null;
  clientId: number | null;
  status: "pending" | "sent" | "failed" | string;
  createdAt: string;
  ruleName: string | null;
}

type DetailRowTone = "green" | "primary" | "orange" | "muted" | "burgundy" | "purple";

function DetailDocRow({
  icon,
  title,
  meta,
  badge,
  tone,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  badge: string;
  tone: DetailRowTone;
}) {
  return (
    <div className="doc-row" data-component="mobile-clients-doc-row">
      <div className={`doc-icon doc-icon-${tone}`} data-component="mobile-clients-doc-icon">
        {icon}
      </div>
      <div className="doc-info" data-component="mobile-clients-doc-info">
        <div className="doc-title" data-component="mobile-clients-doc-title">
          {title}
        </div>
        <div className="doc-meta" data-component="mobile-clients-doc-meta">
          {meta}
        </div>
      </div>
      <span className={`badge-mini ${tone}`}>{badge}</span>
    </div>
  );
}

function notificationChannelLabel(log: ClientNotificationLogRecord): "알림톡" | "메시지" {
  return log.provider.toLowerCase().includes("sms") ? "메시지" : "알림톡";
}

function notificationTitle(log: ClientNotificationLogRecord): string {
  if (log.ruleName?.trim()) return log.ruleName;
  if (log.templateKey === "manual_sms") return "수동 메시지";
  return log.templateKey || "발송 내역";
}

function notificationStatusLabel(status: string): string {
  switch (status) {
    case "failed":
      return "실패";
    case "pending":
      return "대기";
    case "sent":
      return "완료";
    default:
      return status || "-";
  }
}

function notificationStatusTone(status: string): DetailRowTone {
  switch (status) {
    case "failed":
      return "burgundy";
    case "pending":
      return "orange";
    case "sent":
      return "green";
    default:
      return "muted";
  }
}

function formatNotificationTime(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return createdAt || "-";

  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function notificationReceiverLabel(receiver: string | null): string {
  return receiver?.trim() || "수신자 미확인";
}

export function ClientDetailContent({
  client,
  activeTab,
  notificationLogs = [],
  isNotificationLogsLoading = false,
  isIssuingContract = false,
  onTabChange,
  onMessage,
  onIssueContract,
  onEdit,
  onDelete,
}: {
  client: Client;
  activeTab: DetailTabId;
  notificationLogs?: ClientNotificationLogRecord[];
  isNotificationLogsLoading?: boolean;
  isIssuingContract?: boolean;
  onTabChange: (id: DetailTabId) => void;
  onMessage: () => void;
  onIssueContract: (client: Client) => void;
  onEdit: (client: Client) => void;
  onDelete: (id: number) => void;
}) {
  const group = GROUPS.find((g) => g.match(client)) ?? GROUPS[1];
  const featureLabel = clientFeatureLabel(client);
  const featureLabelTone = clientFeatureLabelTone(client);
  const docTone = documentStatusTone(client.documentStatus);
  const hasContractDocument = Boolean(client.eDocId);
  const showMissingContractBadge = shouldShowMissingContractBadge(client);

  return (
    <MobileDetailPage name="clients">
      <MobileDetailHeader
        name="clients"
        avatar={<User size={22} strokeWidth={2} />}
        avatarTone={group.badgeTone}
        title={client.name}
        badges={[
          { label: group.badge, tone: group.badgeMini },
          ...(featureLabel ? [{ label: featureLabel, tone: featureLabelTone }] : []),
          ...(showMissingContractBadge ? [{ label: "계약서 없음", tone: "burgundy" as const }] : []),
        ]}
        menu={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-v3-text-muted transition-colors hover:bg-v3-dim-white"
                aria-label="고객 옵션"
                data-component="mobile-clients-detail-menu-trigger"
              >
                <MoreVertical size={20} strokeWidth={2} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={4}
              className="z-[200] w-max min-w-[5.5rem] rounded-md p-0"
              data-component="mobile-clients-detail-menu"
            >
              <DropdownMenuItem
                onClick={() => onEdit(client)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-clients-detail-menu-edit"
              >
                <SquarePen className="size-[15px]" strokeWidth={2} />
                수정
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => onDelete(client.id)}
                className="min-h-[44px] gap-2 rounded-md px-3 py-2 text-[0.82rem] leading-none"
                data-component="mobile-clients-detail-menu-delete"
              >
                <Trash2 className="size-[15px]" strokeWidth={2} />
                삭제
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <MobileDetailActions
        name="clients"
        actions={[
          {
            label: "메시지",
            variant: "secondary",
            onClick: onMessage,
            dataComponent: "mobile-clients-message",
          },
          {
            label: isIssuingContract ? "발급 중..." : "계약서 발급",
            variant: "primary",
            onClick: () => onIssueContract(client),
            disabled: isIssuingContract,
            busy: isIssuingContract,
            dataComponent: "mobile-clients-contract-create",
          },
        ]}
      />

      <DetailTabPills
        tabs={[
          { id: "basic", label: "기본 정보" },
          { id: "contracts", label: "계약서 정보" },
          { id: "alimtalk", label: "알림 발송" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <MobileDetailTabPanel name="clients" tabId="basic" activeTab={activeTab}>
        <InfoCard title="고객 정보">
          <InfoRow label="이름" value={client.name} />
          <InfoRow label="생년월일" value={client.birthday ?? "-"} />
          <InfoRow label="출산 예정일" value={formatDate(client.dueDate)} />
          <InfoRow label="연락처" value={client.phone ?? "-"} />
          <InfoRow label="주소" value={client.address ?? "-"} />
        </InfoCard>
        <InfoCard title="제공인력" delay={60}>
          <InfoRow label="제공인력 1" value={client.primaryEmployee?.name ?? "-"} />
          <InfoRow label="제공인력 2" value={client.secondaryEmployee?.name ?? "-"} />
        </InfoCard>
        <InfoCard title="서비스 정보" delay={120}>
          <InfoRow label="바우처 유형" value={client.type ?? "-"} />
          <InfoRow label="서비스 기간" value={client.duration ? `${client.duration}일` : "-"} />
          <InfoRow label="시작일" value={formatDate(client.startDate)} />
          <InfoRow label="종료일" value={formatDate(client.endDate)} />
          <InfoRow label="총 서비스 금액" value={formatPrice(client.fullPrice)} />
          <InfoRow label="정부지원금" value={formatPrice(client.grant)} />
          <InfoRow label="본인부담금" value={formatPrice(client.actualPrice)} />
        </InfoCard>
      </MobileDetailTabPanel>

      <MobileDetailTabPanel name="clients" tabId="contracts" activeTab={activeTab}>
        {hasContractDocument ? (
          <>
            <InfoCard title="계약서">
              <DetailDocRow
                icon={<FileCheck2 size={16} strokeWidth={2.5} />}
                title={`${client.type ?? "산모 서비스"} 계약서`}
                meta={`${client.eDocId} · ${formatDate(client.startDate)} 작성`}
                badge={documentStatusLabel(client.documentStatus)}
                tone={docTone}
              />
              <DetailDocRow
                icon={<CheckCircle2 size={16} strokeWidth={2.5} />}
                title="개인정보 동의서"
                meta={`${client.eDocId} · ${formatDate(client.dueDate)} 완료`}
                badge={client.hasSigned ? "완료" : "대기"}
                tone={client.hasSigned ? "green" : "muted"}
              />
            </InfoCard>
            <InfoCard title="최근 진행 상황" delay={60}>
              <InfoRow label="현재 단계" value={documentStatusLabel(client.documentStatus)} tone={docTone as never} />
              <InfoRow label="서명 대기자" value={client.hasSigned ? "-" : `고객 (${client.name})`} />
              <InfoRow label="발송일" value={formatDate(client.startDate)} />
              <InfoRow label="마감일" value={formatDate(client.endDate)} tone={"orange" as never} />
            </InfoCard>
          </>
        ) : (
          <InfoCard title="계약서">
            <div className="detail-empty-state" data-component="mobile-clients-contracts-empty">
              계약서 정보가 없습니다.
            </div>
          </InfoCard>
        )}
      </MobileDetailTabPanel>

      <MobileDetailTabPanel name="clients" tabId="alimtalk" activeTab={activeTab}>
        <InfoCard title="발송 내역">
          {isNotificationLogsLoading ? (
            <div className="detail-empty-state" data-component="mobile-clients-alimtalk-loading">
              발송 내역을 불러오는 중입니다.
            </div>
          ) : notificationLogs.length > 0 ? (
            notificationLogs.map((log) => {
              const tone = notificationStatusTone(log.status);
              const channel = notificationChannelLabel(log);
              return (
                <DetailDocRow
                  key={`${channel}-${log.id}`}
                  icon={
                    tone === "burgundy" ? (
                      <CircleAlert size={16} strokeWidth={2.5} />
                    ) : (
                      <MessageCircle size={16} strokeWidth={2.5} />
                    )
                  }
                  title={`${channel} · ${notificationTitle(log)}`}
                  meta={`${formatNotificationTime(log.createdAt)} · ${notificationReceiverLabel(log.receiver)}`}
                  badge={notificationStatusLabel(log.status)}
                  tone={tone}
                />
              );
            })
          ) : (
            <div className="detail-empty-state" data-component="mobile-clients-alimtalk-empty">
              발송 내역이 없습니다.
            </div>
          )}
        </InfoCard>
      </MobileDetailTabPanel>
    </MobileDetailPage>
  );
}
