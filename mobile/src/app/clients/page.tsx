"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CheckCircle2, Clock3, FileCheck2, Send, UserPlus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { useClient, useDeleteClient } from "@/hooks/useClients";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { Client } from "@/lib/client/types";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { toast } from "@/hooks/use-toast";
import { ClientFormDialog } from "@/components/app/clients/ClientFormDialog";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { Badge, ListCard } from "@/components/app/mobile-redesign/primitives";
import {
  DetailTabPills,
  InfoCard,
  InfoRow,
  MobileDetailSheet,
  MobileSearchBar,
  type AvatarTone,
} from "@/components/app/mobile-redesign/detail-sheet";
import "@/components/app/mobile-redesign/redesign.css";

const ALL_FILTER = "전체";
const AVATAR_TONES: AvatarTone[] = ["primary", "green", "burgundy", "orange", "purple"];
const AVATAR_TONE_BY_INITIAL: Partial<Record<string, AvatarTone>> = {
  "[": "burgundy",
  박: "green",
  김: "primary",
  최: "burgundy",
  장: "orange",
  송: "orange",
  윤: "purple",
  이: "green",
  강: "primary",
};

function pickAvatarTone(name: string, fallback: number): AvatarTone {
  const initial = clientInitial(name);
  if (AVATAR_TONE_BY_INITIAL[initial]) {
    return AVATAR_TONE_BY_INITIAL[initial];
  }
  const code = name.charCodeAt(0) || fallback;
  return AVATAR_TONES[code % AVATAR_TONES.length];
}

function clientInitial(name: string) {
  return name.trim().charAt(0) || "?";
}

function clientMeta(c: Client) {
  const type = c.type ?? "유형 미정";
  return c.primaryEmployee?.name
    ? `${type} · ${c.primaryEmployee.name}`
    : `${type} · 제공인력 미배정`;
}

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
  if (client.careCenter) return "조리원 연계";
  if (client.voucherClient) return "바우처";
  return client.type;
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

interface ClientGroup {
  key: string;
  title: string;
  badge: string;
  badgeTone: "burgundy" | "primary" | "muted" | "green" | "orange";
  badgeMini: "burgundy" | "primary" | "muted" | "green" | "orange";
  match: (c: Client) => boolean;
  counter: string;
}

const GROUPS: ClientGroup[] = [
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
    key: "active",
    title: "진행중",
    badge: "진행중",
    badgeTone: "primary",
    badgeMini: "primary",
    match: (c) => c.serviceStatus === "active",
    counter: "명",
  },
  {
    key: "waiting",
    title: "대기",
    badge: "대기",
    badgeTone: "orange",
    badgeMini: "orange",
    match: (c) => c.serviceStatus === "waiting" || c.serviceStatus === "pending",
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
  {
    key: "expired",
    title: "종료",
    badge: "종료",
    badgeTone: "muted",
    badgeMini: "muted",
    match: (c) => c.serviceStatus === "terminated" || c.serviceStatus === "cancelled",
    counter: "명",
  },
];

type DetailTabId = "basic" | "contracts" | "alimtalk";

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
  tone: "green" | "primary" | "orange" | "muted" | "burgundy" | "purple";
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

function ClientDetailContent({
  client,
  activeTab,
  onTabChange,
  onMessage,
  onIssueContract,
}: {
  client: Client;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
  onMessage: () => void;
  onIssueContract: () => void;
}) {
  const group = GROUPS.find((g) => g.match(client)) ?? GROUPS[1];
  const featureLabel = clientFeatureLabel(client);
  const docTone = documentStatusTone(client.documentStatus);
  const contractCode = client.eDocId ?? `C-${String(client.id).padStart(4, "0")}`;

  return (
    <div className="detail-body detail-column" data-component="mobile-clients-detail">
      <div className="client-detail-header pop-up" data-component="mobile-clients-detail-header">
        <div
          className={`client-detail-avatar-lg av-${pickAvatarTone(client.name, client.id)}`}
          data-component="mobile-clients-detail-avatar"
        >
          {clientInitial(client.name)}
        </div>
        <div className="client-detail-title" data-component="mobile-clients-detail-title">
          <div className="client-detail-name" data-component="mobile-clients-detail-name">
            {client.name}
          </div>
          <div className="client-detail-badges" data-component="mobile-clients-detail-badges">
            <span className={`badge-mini ${group.badgeMini}`}>{group.badge}</span>
            {featureLabel && <span className="badge-mini burgundy">{featureLabel}</span>}
          </div>
        </div>
      </div>

      <div className="detail-actions" data-component="mobile-clients-detail-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onMessage}
          data-component="mobile-clients-message"
        >
          메시지
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={onIssueContract}
          data-component="mobile-clients-contract-create"
        >
          계약서 발급
        </button>
      </div>

      <DetailTabPills
        tabs={[
          { id: "basic", label: "기본 정보" },
          { id: "contracts", label: "계약서 정보" },
          { id: "alimtalk", label: "알림톡 발송 현황" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <div
        className={`tab-content ${activeTab === "basic" ? "active" : ""}`}
        data-tab-content="basic"
        data-component="mobile-clients-basic-tab"
      >
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
      </div>

      <div
        className={`tab-content ${activeTab === "contracts" ? "active" : ""}`}
        data-tab-content="contracts"
        data-component="mobile-clients-contracts-tab"
      >
        <InfoCard title={client.eDocId ? "계약서 · 2건" : "계약서 · 1건"}>
          <DetailDocRow
            icon={<FileCheck2 size={16} strokeWidth={2.5} />}
            title={`${client.type ?? "산모 서비스"} 계약서`}
            meta={`${contractCode} · ${formatDate(client.startDate)} 작성`}
            badge={documentStatusLabel(client.documentStatus)}
            tone={docTone}
          />
          {client.eDocId && (
            <DetailDocRow
              icon={<CheckCircle2 size={16} strokeWidth={2.5} />}
              title="개인정보 동의서"
              meta={`${client.eDocId} · ${formatDate(client.dueDate)} 완료`}
              badge={client.hasSigned ? "완료" : "대기"}
              tone={client.hasSigned ? "green" : "muted"}
            />
          )}
        </InfoCard>
        <InfoCard title="최근 진행 상황" delay={60}>
          <InfoRow label="현재 단계" value={documentStatusLabel(client.documentStatus)} tone={docTone as never} />
          <InfoRow label="서명 대기자" value={client.hasSigned ? "-" : `고객 (${client.name})`} />
          <InfoRow label="발송일" value={formatDate(client.startDate)} />
          <InfoRow label="마감일" value={formatDate(client.endDate)} tone={"orange" as never} />
        </InfoCard>
      </div>

      <div
        className={`tab-content ${activeTab === "alimtalk" ? "active" : ""}`}
        data-tab-content="alimtalk"
        data-component="mobile-clients-alimtalk-tab"
      >
        <InfoCard title="알림톡 · 4건">
          <DetailDocRow
            icon={<UserPlus size={16} strokeWidth={2.5} />}
            title="고객 등록 환영"
            meta={`${formatDate(client.dueDate)} 오전 10:14`}
            badge="완료"
            tone="green"
          />
          <DetailDocRow
            icon={<CheckCircle2 size={16} strokeWidth={2.5} />}
            title="제공인력 배정 안내"
            meta={`${formatDate(client.startDate)} · ${client.primaryEmployee?.name ?? "미배정"}`}
            badge={client.primaryEmployee ? "완료" : "대기"}
            tone={client.primaryEmployee ? "green" : "muted"}
          />
          <DetailDocRow
            icon={<Send size={16} strokeWidth={2.5} />}
            title="서비스 시작 D-1 안내"
            meta={formatDate(client.startDate)}
            badge="완료"
            tone="green"
          />
          <DetailDocRow
            icon={<Clock3 size={16} strokeWidth={2.5} />}
            title="서비스 종료 안내"
            meta={`${formatDate(client.endDate)} · 발송 예정`}
            badge="대기"
            tone="muted"
          />
        </InfoCard>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("id");

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailSheetTab, setDetailSheetTab] = useState<DetailTabId>("basic");
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [formDialogOpen, setFormDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);

  const { allClients, total } = useInfiniteClients({
    filter: "all",
    search: searchQuery,
    filterFn: () => true,
    searchFn: (c, query) => matchesKoreanSearch(c.name, query),
  });

  const deleteClient = useDeleteClient();
  const { data: clientFromParam } = useClient(clientIdParam ? Number(clientIdParam) : 0);
  const detailClient = selectedClient ?? (clientIdParam ? clientFromParam ?? null : null);

  const handleSelectClient = (client: Client) => {
    setSelectedClient(client);
    setDetailSheetTab("basic");
  };

  const handleCloseDetailSheet = () => {
    setSelectedClient(null);
    if (clientIdParam) {
      router.replace("/clients");
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setFormDialogOpen(true);
    setDetailModalOpen(false);
  };

  const handleMessage = (client: Client) => {
    router.push(`/messages?clientId=${client.id}`);
  };

  const handleIssueContract = () => {
    router.push("/contracts/creation");
  };

  const handleDeleteRequest = (id: number) => {
    setDeleteTargetClientId(id);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetClientId == null) return;
    try {
      await deleteClient.mutateAsync(deleteTargetClientId);
      if (detailClient?.id === deleteTargetClientId) {
        setSelectedClient(null);
        setDetailModalOpen(false);
      }
      setDeleteTargetClientId(null);
      toast({
        title: t(locale, "clients.delete-success"),
        description: t(locale, "clients.delete-success-description"),
      });
    } catch {
      toast({
        title: t(locale, "clients.delete-fail"),
        description: t(locale, "clients.delete-fail-description"),
        variant: "destructive",
      });
    }
  };

  const grouped = useMemo(() => {
    const counts: Record<string, number> = {};
    const map: Record<string, Client[]> = {};
    for (const g of GROUPS) {
      const matched = allClients.filter(g.match);
      counts[g.key] = matched.length;
      map[g.key] = matched;
    }
    return { counts, map };
  }, [allClients]);

  const filterItems = useMemo(() => {
    const items: Array<{ label: string; count: string }> = [
      { label: ALL_FILTER, count: String(total ?? allClients.length) },
    ];
    for (const g of GROUPS) {
      if (grouped.counts[g.key] > 0) {
        items.push({ label: g.title, count: String(grouped.counts[g.key]) });
      }
    }
    return items;
  }, [allClients.length, grouped.counts, total]);

  const visibleSections = useMemo(() => {
    const sections: Array<{ key: string; title: string; group: ClientGroup; rows: Client[] }> = [];
    for (const g of GROUPS) {
      if (activeFilter !== ALL_FILTER && g.title !== activeFilter) continue;
      const docs = grouped.map[g.key];
      if (!docs || docs.length === 0) continue;
      sections.push({
        key: g.key,
        title: `${g.title} · ${docs.length}${g.counter}`,
        group: g,
        rows: docs,
      });
    }
    return sections;
  }, [activeFilter, grouped.map]);

  return (
    <>
      <MobileDetailSheet
        name="clients"
        isOpen={Boolean(detailClient)}
        onClose={handleCloseDetailSheet}
        list={
          <div className="shell-content" data-component="mobile-clients-content">
            <ListCard
              title="고객"
              count={`${total ?? allClients.length}명`}
              actionLabel="+ 추가"
              actionHref="/clients/new"
              filters={filterItems}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              beforeFilters={
                <MobileSearchBar
                  placeholder="고객 이름, 매니저 검색"
                  label="clients"
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              }
            >
              {visibleSections.length === 0 ? (
                <div
                  style={{
                    padding: "32px 16px",
                    textAlign: "center",
                    fontSize: "0.82rem",
                    color: "hsl(var(--v3-text-muted))",
                  }}
                  data-component="mobile-clients-empty"
                >
                  {searchQuery.trim() || activeFilter !== ALL_FILTER
                    ? "조건에 맞는 고객이 없습니다."
                    : "등록된 고객이 없습니다."}
                </div>
              ) : (
                visibleSections.map((section) => (
                  <div
                    className="section-block"
                    key={section.key}
                    data-component="mobile-clients-section"
                  >
                    <div className="section-header" data-component="mobile-clients-section-header">
                      {section.title}
                    </div>
                    {section.rows.map((c, idx) => (
                      <button
                        key={c.id}
                        type="button"
                        className="list-item"
                        data-component="mobile-clients-row"
                        onClick={() => handleSelectClient(c)}
                      >
                        <div
                          className={`list-avatar av-${pickAvatarTone(c.name, c.id + idx)}`}
                          data-component="mobile-clients-avatar"
                        >
                          {clientInitial(c.name)}
                        </div>
                        <div className="list-info" data-component="mobile-clients-list-info">
                          <div className="list-name" data-component="mobile-clients-list-name">
                            {c.name}
                          </div>
                          <div className="list-meta" data-component="mobile-clients-list-meta">
                            {clientMeta(c)}
                          </div>
                        </div>
                        <div className="list-right" data-component="mobile-clients-list-right">
                          <Badge label={section.group.badge} tone={section.group.badgeTone} />
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </ListCard>
          </div>
        }
        detail={
          detailClient ? (
            <ClientDetailContent
              client={detailClient}
              activeTab={detailSheetTab}
              onTabChange={setDetailSheetTab}
              onMessage={() => handleMessage(detailClient)}
              onIssueContract={handleIssueContract}
            />
          ) : (
            <div className="detail-body" data-component="mobile-clients-detail-empty" />
          )
        }
      />

      <ClientDetailModal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        client={detailClient}
        onEdit={handleEdit}
        onDelete={handleDeleteRequest}
      />

      <ConfirmActionModal
        open={deleteTargetClientId != null}
        title={t(locale, "common.delete")}
        description={t(locale, "clients.delete-confirm")}
        cancelLabel={t(locale, "common.cancel")}
        confirmLabel={t(locale, "common.delete")}
        loading={deleteClient.isPending}
        onOpenChange={(open) => {
          if (!open && !deleteClient.isPending) {
            setDeleteTargetClientId(null);
          }
        }}
        onCancel={() => setDeleteTargetClientId(null)}
        onConfirm={handleDeleteConfirm}
      />

      <ClientFormDialog
        open={formDialogOpen}
        onClose={() => {
          setFormDialogOpen(false);
          setEditingClient(null);
        }}
        client={editingClient}
      />
    </>
  );
}
