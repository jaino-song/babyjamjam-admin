"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { User } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { clientQueryKeys, useClient, useDeleteClient } from "@/hooks/useClients";
import { useAreaTemplates } from "@/hooks";
import { useEmployees } from "@/hooks/useEmployees";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import { api } from "@/lib/api/client";
import { Client } from "@/lib/client/types";
import { buildClientContractData } from "@/lib/contracts/client-contract-data";
import {
  CONTRACT_CREATION_PROGRESS_STEPS,
  INITIAL_HEADLESS_PROGRESS,
  createHeadlessProgressId,
  getSafeHeadlessFailureMessage,
  isHeadlessProgressStepKey,
  resolveFailedHeadlessProgress,
  resolveNextHeadlessProgress,
  type HeadlessProgressEvent,
  type HeadlessProgressState,
} from "@/lib/eformsign/headless-progress";
import { useLocale } from "@/providers/LocaleProvider";
import { eformsignApi } from "@/services/api";
import { t } from "@/lib/i18n/translations";
import { toast } from "@/hooks/use-toast";
import { ClientDetailModal } from "@/components/app/clients/ClientDetailModal";
import { HeadlessProgressModal } from "@/components/app/eformsign/HeadlessProgressModal";
import { ConfirmActionModal } from "@/components/app/ui/ConfirmActionModal";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import { eformsignQueryKeys } from "@/hooks/useEformsignDocuments";
import {
  Badge,
  ListCard,
  ListCountSkeleton,
  ListItemRow,
  ListLoadMoreButton,
  ListLoadMoreSentinel,
  ListRowsSkeleton,
} from "@/components/app/mobile-redesign/primitives";
import {
  MobileDetailSheet,
  MobileSearchBar,
} from "@/components/app/mobile-redesign/detail-sheet";
import { ClientDetailContent, GROUPS, shouldShowMissingContractBadge, type ClientGroup, type ClientNotificationLogRecord, type DetailTabId } from "@/components/app/clients/client-detail";
import "@/components/app/mobile-redesign/redesign.css";

const CLIENTS_ROUTE_BODY_CLASS = "mobile-clients-route";
const ALL_FILTER = "전체";

function defaultClientMeta(c: Client) {
  const type = c.type ?? "유형 미정";
  return c.primaryEmployee?.name
    ? `${type} · ${c.primaryEmployee.name}`
    : `${type} · 제공인력 미배정`;
}

function primaryEmployeeMeta(c: Client) {
  return c.primaryEmployee?.name ?? "제공인력 미배정";
}

function formatMonthDay(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  const dateOnlyMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dateOnlyMatch) {
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    if (Number.isFinite(month) && Number.isFinite(day)) {
      return `${month}/${day}`;
    }
  }

  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "numeric",
    day: "numeric",
  }).format(date);
}

function labeledDateMeta(label: string, dateStr: string | null | undefined, c: Client): string {
  const date = formatMonthDay(dateStr);
  return `${label} ${date ?? "-"} · ${primaryEmployeeMeta(c)}`;
}

function clientMeta(c: Client) {
  switch (c.serviceStatus) {
    case "waiting":
      return labeledDateMeta("예정일", c.dueDate, c);
    case "active":
    case "completed":
      return labeledDateMeta("종료일", c.endDate, c);
    case "terminated":
      return labeledDateMeta("중단일", c.updatedAt ?? c.endDate ?? c.createdAt, c);
    case "replacement_requested":
      return labeledDateMeta("교체 요청일", c.updatedAt ?? c.createdAt, c);
    default:
      return defaultClientMeta(c);
  }
}

// "최근 활동순" 정렬 키 — clients는 활동 timestamp가 없어 서비스 시작일(startDate) 기준, 동률은 최신 id.
function clientRecency(c: Client): number {
  const t = c.startDate ? new Date(c.startDate).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}
function groupForClient(c: Client): ClientGroup {
  return GROUPS.find((g) => g.match(c)) ?? GROUPS[GROUPS.length - 1];
}

function normalizePhone(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

export default function ClientsPage() {
  const locale = useLocale();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const clientIdParam = searchParams.get("id");

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [detailSheetTab, setDetailSheetTab] = useState<DetailTabId>("basic");
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [deleteTargetClientId, setDeleteTargetClientId] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [isIssuingContract, setIsIssuingContract] = useState(false);
  const [isIssueProgressOpen, setIsIssueProgressOpen] = useState(false);
  const [issueProgress, setIssueProgress] = useState<HeadlessProgressState>(INITIAL_HEADLESS_PROGRESS);
  const [issueProgressErrorHint, setIssueProgressErrorHint] = useState<string | null>(null);
  const issueProgressSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    document.body.classList.add(CLIENTS_ROUTE_BODY_CLASS);
    return () => {
      document.body.classList.remove(CLIENTS_ROUTE_BODY_CLASS);
    };
  }, []);

  useEffect(() => () => {
    issueProgressSourceRef.current?.close();
  }, []);

  const { allClients, allFilteredClients, total, isLoading, isFetching } = useInfiniteClients({
    filter: "all",
    search: searchQuery,
    filterFn: () => true,
    searchFn: (c, query) =>
      matchesKoreanSearch(c.name, query) ||
      (c.primaryEmployee?.name
        ? matchesKoreanSearch(c.primaryEmployee.name, query)
        : false),
  });
  const isClientsFetching = isLoading || (isFetching && allClients.length === 0);

  const deleteClient = useDeleteClient();
  const { data: employees = [] } = useEmployees();
  const { data: areaTemplates = [] } = useAreaTemplates();
  const { data: clientFromParam } = useClient(clientIdParam ? Number(clientIdParam) : 0);
  const detailClient = selectedClient ?? (clientIdParam ? clientFromParam ?? null : null);
  const { data: notificationLogsData = [], isLoading: isNotificationLogsLoading } = useQuery<ClientNotificationLogRecord[]>({
    queryKey: ["alimtalk", "logs", 200],
    queryFn: async () => {
      const res = await api.get<ClientNotificationLogRecord[]>("/alimtalk-logs", {
        params: { limit: 200 },
      });
      return res.data;
    },
    enabled: Boolean(detailClient),
    staleTime: 1000 * 60,
  });

  const detailNotificationLogs = useMemo(() => {
    if (!detailClient || !Array.isArray(notificationLogsData)) return [];

    const clientPhone = normalizePhone(detailClient.phone);
    return notificationLogsData
      .filter((log) => {
        if (log.clientId === detailClient.id) return true;
        if (!clientPhone) return false;
        return normalizePhone(log.receiver) === clientPhone;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [detailClient, notificationLogsData]);

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
    // 기존 ClientFormDialog(데스크탑 폼) 대신 mockup 디자인의 wizard로 라우팅 — `?clientId`로 편집 모드 진입.
    setDetailModalOpen(false);
    router.push(`/clients/new?clientId=${client.id}`);
  };

  const handleMessage = (client: Client) => {
    router.push(`/messages?clientId=${client.id}`);
  };

  const handleIssueContract = async (client: Client) => {
    if (isIssuingContract) return;

    setIsIssuingContract(true);
    setIssueProgressErrorHint(null);

    let progressSource: EventSource | null = null;
    try {
      const { contractData } = buildClientContractData({
        client,
        employees,
        areaTemplates,
      });

      const authResult = await eformsignApi.authenticate(Date.now());
      if (!authResult.success) {
        throw new Error("eformsign 인증에 실패했습니다.");
      }

      const progressId = createHeadlessProgressId("client-contract");
      setIssueProgress({ step: "client-started", completed: false, failed: false });
      setIsIssueProgressOpen(true);

      progressSource = new EventSource(
        `/api/eformsign-docs/dispatch-headless/progress?progressId=${encodeURIComponent(progressId)}`,
      );
      issueProgressSourceRef.current = progressSource;
      progressSource.addEventListener("progress", (event) => {
        let data: HeadlessProgressEvent;
        try {
          data = JSON.parse((event as MessageEvent).data) as HeadlessProgressEvent;
        } catch {
          return;
        }

        if (data.step === "failed") {
          const errorHint = getSafeHeadlessFailureMessage(data.reason);
          setIssueProgress((current) => {
            const next = resolveFailedHeadlessProgress(
              current,
              data.failedStep,
              CONTRACT_CREATION_PROGRESS_STEPS,
            );
            if (next !== current) {
              setIssueProgressErrorHint(errorHint);
            }
            return next;
          });
          return;
        }

        if (!isHeadlessProgressStepKey(data.step, CONTRACT_CREATION_PROGRESS_STEPS)) return;
        const nextStep = data.step;
        setIssueProgress((current) =>
          resolveNextHeadlessProgress(current, nextStep, CONTRACT_CREATION_PROGRESS_STEPS),
        );
      });

      const headless = await eformsignApi.dispatchHeadless(contractData, client.id, progressId);

      if (!headless.ok) {
        const errorHint = getSafeHeadlessFailureMessage(headless.reason);
        setIssueProgress((current) => {
          const next = resolveFailedHeadlessProgress(
            current,
            headless.failedStep,
            CONTRACT_CREATION_PROGRESS_STEPS,
          );
          if (next !== current) {
            setIssueProgressErrorHint(errorHint);
          }
          return next;
        });
        toast({
          title: "계약서 자동 발급 실패",
          description: errorHint,
          variant: "destructive",
        });
        return;
      }

      setIssueProgress({ step: "sent", completed: true, failed: false });
      if (headless.documentId) {
        setSelectedClient((current) =>
          current?.id === client.id
            ? { ...current, eDocId: headless.documentId ?? current.eDocId, documentStatus: "created" }
            : current,
        );
      }
      queryClient.invalidateQueries({ queryKey: eformsignQueryKeys.allDocuments() });
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
      queryClient.invalidateQueries({ queryKey: clientQueryKeys.detail(client.id) });
      toast({
        title: "계약서 자동 발급 완료",
        description: `${client.name}님 계약서가 발송되었습니다.`,
      });
      setTimeout(() => {
        setIsIssueProgressOpen(false);
      }, 800);
    } catch (error) {
      const message = error instanceof Error ? error.message : "계약서 자동 발급 중 오류가 발생했습니다.";
      setIsIssueProgressOpen(false);
      setIssueProgress(INITIAL_HEADLESS_PROGRESS);
      toast({
        title: "계약서 자동 발급 실패",
        description: message,
        variant: "destructive",
      });
    } finally {
      progressSource?.close();
      issueProgressSourceRef.current = null;
      setIsIssuingContract(false);
    }
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
      const matched = allFilteredClients.filter(g.match);
      counts[g.key] = matched.length;
      map[g.key] = matched;
    }
    return { counts, map };
  }, [allFilteredClients]);

  const filterItems = useMemo(() => {
    if (isClientsFetching) {
      return [
        { label: ALL_FILTER, count: "", skeleton: true },
        ...GROUPS.map((g) => ({ label: g.title, count: "", skeleton: true })),
      ];
    }

    const items = [
      {
        label: ALL_FILTER,
        count: String(total ?? allClients.length),
      },
    ];
    for (const g of GROUPS) {
      items.push({
        label: g.title,
        count: String(grouped.counts[g.key] ?? 0),
      });
    }
    return items;
  }, [allClients.length, grouped.counts, isClientsFetching, total]);

  const sectionsFull = useMemo(() => {
    type Section = {
      key: string;
      title: string;
      group: ClientGroup;
      fullRows: Client[];
      fullCount: number;
    };

    // 전체: 카테고리 grouping 없이 최근 활동순 단일 리스트 (총 8개부터 teaser → 무한 스크롤).
    if (activeFilter === ALL_FILTER) {
      const flat = allFilteredClients
        .filter((c) => GROUPS.some((g) => g.match(c)))
        .sort((a, b) => clientRecency(b) - clientRecency(a) || b.id - a.id);
      return flat.length > 0
        ? [{ key: "all", title: "", group: GROUPS[0], fullRows: flat, fullCount: flat.length }]
        : [];
    }

    // 개별 필터: 해당 상태 그룹 단일 섹션.
    const sections: Section[] = [];
    for (const g of GROUPS) {
      if (g.title !== activeFilter) continue;
      const docs = grouped.map[g.key];
      if (!docs || docs.length === 0) continue;
      sections.push({
        key: g.key,
        title: `${g.title} · ${docs.length}${g.counter}`,
        group: g,
        fullRows: docs,
        fullCount: docs.length,
      });
    }
    return sections;
  }, [activeFilter, grouped.map, allFilteredClients]);

  const maxFullCount = useMemo(
    () => sectionsFull.reduce((m, s) => Math.max(m, s.fullCount), 0),
    [sectionsFull],
  );

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}::${searchQuery}`,
      totalItems: maxFullCount,
    });

  const visibleSections = useMemo(
    () =>
      sectionsFull
        .map((s) => ({ ...s, rows: s.fullRows.slice(0, visibleCount) }))
        .filter((s) => s.rows.length > 0),
    [sectionsFull, visibleCount],
  );

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
              count={
                isClientsFetching
                  ? <ListCountSkeleton dataComponentPrefix="mobile-clients" />
                  : `${total ?? allClients.length}명`
              }
              actionLabel="+ 추가"
              actionHref="/clients/new"
              filters={filterItems}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              scrollRef={scrollContainerRef}
              loadMoreFooter={
                isInitialLoad && hasMore ? (
                  <ListLoadMoreButton
                    onLoadMore={loadMore}
                    dataComponentPrefix="mobile-clients"
                  />
                ) : null
              }
              beforeFilters={
                <MobileSearchBar
                  placeholder="고객 이름, 매니저 검색"
                  label="clients"
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              }
            >
              {isClientsFetching ? (
                <ListRowsSkeleton dataComponentPrefix="mobile-clients" />
              ) : visibleSections.length === 0 ? (
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
                <>
                {visibleSections.map((section) => (
                  <div
                    className="section-block"
                    key={section.key}
                    data-component="mobile-clients-section"
                  >
                    {section.rows.map((c, idx) => {
                      const g = groupForClient(c);
                      return (
                      <ListItemRow
                        key={c.id}
                        style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
	                        dataComponent="mobile-clients-row"
	                        left={
	                          <div className={`list-avatar av-${g.badgeTone}`} data-component="mobile-clients-row-avatar">
	                            <User size={16} strokeWidth={2} />
	                          </div>
	                        }
                        name={c.name}
                        meta={clientMeta(c)}
                        right={
                          <div
                            className="list-row-badges mobile-clients-row-badges"
                            data-component="mobile-clients-row-badges"
                          >
                            <Badge label={g.badge} tone={g.badgeTone} />
                            {shouldShowMissingContractBadge(c) && (
                              <Badge label="계약서 없음" tone="burgundy" />
                            )}
                          </div>
                        }
                        onClick={() => handleSelectClient(c)}
                      />
                      );
                    })}
                  </div>
                ))}
                {!isInitialLoad && hasMore && (
                  <ListLoadMoreSentinel
                    sentinelRef={sentinelRef}
                    dataComponentPrefix="mobile-clients"
                  />
                )}
                </>
              )}
            </ListCard>
          </div>
        }
        detail={
          detailClient ? (
            <ClientDetailContent
              client={detailClient}
              activeTab={detailSheetTab}
              notificationLogs={detailNotificationLogs}
              isNotificationLogsLoading={isNotificationLogsLoading}
              isIssuingContract={isIssuingContract}
              onTabChange={setDetailSheetTab}
              onMessage={() => handleMessage(detailClient)}
              onIssueContract={handleIssueContract}
              onEdit={handleEdit}
              onDelete={handleDeleteRequest}
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

      <HeadlessProgressModal
        open={isIssueProgressOpen}
        title="계약서 자동 발급 중"
        subtitle={
          issueProgress.failed
            ? "자동 발급에 실패했습니다. 고객 정보와 계약서 유형을 확인해 주세요."
            : undefined
        }
        steps={CONTRACT_CREATION_PROGRESS_STEPS}
        progress={issueProgress}
        errorHint={issueProgressErrorHint}
        dataComponentPrefix="mobile-clients-contract-issue-progress"
      />

    </>
  );
}
