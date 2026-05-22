"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useClient, useDeleteClient } from "@/hooks/useClients";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { Client, SERVICE_STATUS_OPTIONS } from "@/lib/client/types";
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

function pickAvatarTone(name: string, fallback: number): AvatarTone {
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

function serviceStatusLabel(status: string | null) {
  const opt = SERVICE_STATUS_OPTIONS.find((o) => o.value === status);
  return opt?.label ?? "-";
}

interface ClientGroup {
  key: string;
  title: string;
  badge: string;
  badgeTone: "burgundy" | "primary" | "muted" | "green";
  badgeMini: "burgundy" | "primary" | "muted" | "green";
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
    counter: "건",
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
    badgeTone: "muted",
    badgeMini: "muted",
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

type DetailTabId = "basic" | "service" | "contact";

function ClientDetailContent({
  client,
  activeTab,
  onTabChange,
  onOpenFullDetail,
  onEdit,
}: {
  client: Client;
  activeTab: DetailTabId;
  onTabChange: (id: DetailTabId) => void;
  onOpenFullDetail: () => void;
  onEdit: () => void;
}) {
  const [actionStatus, setActionStatus] = useState("");
  const group = GROUPS.find((g) => g.match(client)) ?? GROUPS[1];

  return (
    <div className="detail-body detail-column" data-component="mobile-clients-detail">
      <div className="client-detail-header pop-up">
        <div className={`client-detail-avatar-lg av-${pickAvatarTone(client.name, client.id)}`}>
          {clientInitial(client.name)}
        </div>
        <div className="client-detail-title">
          <div className="client-detail-name">{client.name}</div>
          <div className="client-detail-badges">
            <span className={`badge-mini ${group.badgeMini}`}>{group.badge}</span>
            {client.type && <span className="badge-mini muted">{client.type}</span>}
          </div>
        </div>
      </div>

      <div className="detail-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={onEdit}
          data-component="mobile-clients-edit"
        >
          편집
        </button>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => {
            onOpenFullDetail();
            setActionStatus("전체 상세 정보를 엽니다.");
          }}
          data-component="mobile-clients-detail-full"
        >
          전체 정보
        </button>
      </div>
      {actionStatus && (
        <div className="action-feedback" role="status">
          {actionStatus}
        </div>
      )}

      <DetailTabPills
        tabs={[
          { id: "basic", label: "기본 정보" },
          { id: "service", label: "서비스" },
          { id: "contact", label: "연락처" },
        ]}
        activeTab={activeTab}
        onTabChange={(id) => onTabChange(id as DetailTabId)}
      />

      <div
        className={`tab-content ${activeTab === "basic" ? "active" : ""}`}
        data-tab-content="basic"
      >
        <InfoCard title="기본 정보">
          <InfoRow label="이름" value={client.name} />
          <InfoRow label="유형" value={client.type ?? "-"} />
          <InfoRow label="현재 상태" value={serviceStatusLabel(client.serviceStatus)} tone={group.badgeMini as never} />
        </InfoCard>
        <InfoCard title="배정 정보" delay={60}>
          <InfoRow label="주 담당 매니저" value={client.primaryEmployee?.name ?? "미배정"} />
          {client.secondaryEmployee?.name && (
            <InfoRow label="보조 담당 매니저" value={client.secondaryEmployee.name} />
          )}
        </InfoCard>
      </div>

      <div
        className={`tab-content ${activeTab === "service" ? "active" : ""}`}
        data-tab-content="service"
      >
        <InfoCard title="서비스 정보">
          <InfoRow label="유형" value={client.type ?? "-"} />
          <InfoRow label="상태" value={serviceStatusLabel(client.serviceStatus)} />
        </InfoCard>
      </div>

      <div
        className={`tab-content ${activeTab === "contact" ? "active" : ""}`}
        data-tab-content="contact"
      >
        <InfoCard title="연락처">
          <InfoRow label="휴대전화" value={client.phone ?? "-"} />
          {client.address && <InfoRow label="주소" value={client.address} />}
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

  useEffect(() => {
    if (clientIdParam && clientFromParam) {
      setSelectedClient(clientFromParam);
      setDetailSheetTab("basic");
    }
  }, [clientIdParam, clientFromParam]);

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

  const handleOpenFullDetail = () => {
    setDetailModalOpen(true);
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setFormDialogOpen(true);
    setDetailModalOpen(false);
  };

  const handleDeleteRequest = (id: number) => {
    setDeleteTargetClientId(id);
  };

  const handleDeleteConfirm = async () => {
    if (deleteTargetClientId == null) return;
    try {
      await deleteClient.mutateAsync(deleteTargetClientId);
      if (selectedClient?.id === deleteTargetClientId) {
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
      { label: ALL_FILTER, count: String(allClients.length) },
    ];
    for (const g of GROUPS) {
      if (grouped.counts[g.key] > 0) {
        items.push({ label: g.title, count: String(grouped.counts[g.key]) });
      }
    }
    return items;
  }, [allClients.length, grouped.counts]);

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
        isOpen={Boolean(selectedClient)}
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
                  <div className="section-block" key={section.key}>
                    <div className="section-header">{section.title}</div>
                    {section.rows.map((c, idx) => (
                      <button
                        key={c.id}
                        type="button"
                        className="list-item"
                        data-component="mobile-clients-row"
                        onClick={() => handleSelectClient(c)}
                      >
                        <div className={`list-avatar av-${pickAvatarTone(c.name, c.id + idx)}`}>
                          {clientInitial(c.name)}
                        </div>
                        <div className="list-info">
                          <div className="list-name">{c.name}</div>
                          <div className="list-meta">{clientMeta(c)}</div>
                        </div>
                        <div className="list-right">
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
          selectedClient ? (
            <ClientDetailContent
              client={selectedClient}
              activeTab={detailSheetTab}
              onTabChange={setDetailSheetTab}
              onOpenFullDetail={handleOpenFullDetail}
              onEdit={() => handleEdit(selectedClient)}
            />
          ) : (
            <div className="detail-body" />
          )
        }
      />

      <ClientDetailModal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        client={selectedClient}
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
