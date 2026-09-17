"use client";
import { useEffect, useMemo, useState } from "react";
import { User, Users, Workflow } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { useClientDetailController } from "@/components/app/clients/client-detail-controller";
import { useInfiniteClients } from "@/hooks/useInfiniteClients";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import { Client } from "@/lib/client/types";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";
import { getMobileClientBadges } from "@/lib/client/badges";
import {
  buildAllClientRowsForList,
  groupForClient,
} from "@/lib/client/list-helpers";
import { parsePositiveIntQueryParam } from "@/lib/query-params";
import { matchesKoreanSearch } from "@/lib/search/korean-search";
import {
  ListCard,
  ListCountSkeleton,
  ListItemRow,
  ListLoadMoreSentinel,
  ListRowBadges,
  ListRowsSkeleton,
  MobileSectionNav,
} from "@/components/app/mobile-redesign/primitives";
import { ClientRegistrationPolicySettings } from "@/components/app/mobile-redesign/ClientRegistrationPolicySettings";
import {
  MobileDetailSheet,
  MobileSearchBar,
} from "@/components/app/mobile-redesign/detail-sheet";
import { GROUPS, type ClientGroup } from "@/components/app/clients/client-detail";
import "@/components/app/mobile-redesign/redesign.css";

const ALL_FILTER = "전체";
const CONTRACT_REQUIRED_FILTER = "계약서 필요";
const CLIENT_SECTIONS = [
  { id: "list", label: "고객 목록", icon: Users },
  { id: "automation", label: "자동화", icon: Workflow },
] as const;

type ClientSectionId = (typeof CLIENT_SECTIONS)[number]["id"];

function defaultClientMeta(c: Client) {
  const type = c.type ?? "유형 미정";
  return c.primaryEmployee?.name
    ? `${type} · ${c.primaryEmployee.name}`
    : `${type} · 제공인력 미배정`;
}

function primaryEmployeeMeta(c: Client) {
  return c.primaryEmployee?.name ?? "제공인력 미배정";
}

function formatKoreanDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;

  const dateOnlyMatch = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (dateOnlyMatch) {
    const year = dateOnlyMatch[1];
    const month = dateOnlyMatch[2].padStart(2, "0");
    const day = dateOnlyMatch[3].padStart(2, "0");
    return `${year}.${month}.${day}`;
  }

  const digits = dateStr.replace(/\D/g, "");
  const normalized = digits.length >= 8
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : digits.length === 6
      ? `${Number(digits.slice(0, 2)) >= 70 ? 1900 + Number(digits.slice(0, 2)) : 2000 + Number(digits.slice(0, 2))}-${digits.slice(2, 4)}-${digits.slice(4, 6)}`
      : dateStr;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return formatDateForDisplay(date, "");
}

function labeledDateMeta(label: string, dateStr: string | null | undefined, c: Client): string {
  const date = formatKoreanDate(dateStr);
  return `${label} ${date ?? "-"} · ${primaryEmployeeMeta(c)}`;
}

function clientMeta(c: Client) {
  switch (c.serviceStatus) {
    case "pre_booking":
      return labeledDateMeta("상담 등록일", c.createdAt, c);
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

function hasContractRequiredBadge(c: Client): boolean {
  return getMobileClientBadges(c).some((badge) => badge.key === "contract_required");
}

export default function ClientsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedClientIdFromParam = parsePositiveIntQueryParam(searchParams.get("id"));

  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<string>(ALL_FILTER);
  const [activeSection, setActiveSection] = useState<ClientSectionId>("list");

  useEffect(() => {
    document.body.classList.add("mobile-clients-route");
    return () => {
      document.body.classList.remove("mobile-clients-route");
    };
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

  const handleCloseDetailSheet = () => {
    setSelectedClient(null);
    if (selectedClientIdFromParam !== null) {
      router.replace("/clients");
    }
  };

  const handleClientUpdated = (updatedClient: Client) => {
    if (selectedClientIdFromParam !== null && updatedClient.id !== selectedClientIdFromParam) return;
    setSelectedClient(updatedClient);
  };

  const detailController = useClientDetailController({
    client: selectedClient,
    clientId: selectedClientIdFromParam,
    dataComponent: "mobile_clients_detail-sheet_stack_detail-page_content",
    onClientUpdated: handleClientUpdated,
    onClientDeleted: handleCloseDetailSheet,
  });
  const detailClient = detailController.detailClient;

  const handleSelectClient = (client: Client) => {
    setSelectedClient(client);
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
  const contractRequiredClients = useMemo(
    () => allFilteredClients.filter(hasContractRequiredBadge),
    [allFilteredClients],
  );

  const filterItems = useMemo(() => {
    if (isClientsFetching) {
      return [
        { label: ALL_FILTER, count: "", skeleton: true },
        { label: CONTRACT_REQUIRED_FILTER, count: "", skeleton: true },
        ...GROUPS.map((g) => ({ label: g.title, count: "", skeleton: true })),
      ];
    }

    const items = [
      {
        label: ALL_FILTER,
        count: String(total ?? allClients.length),
      },
      {
        label: CONTRACT_REQUIRED_FILTER,
        count: String(contractRequiredClients.length),
      },
    ];
    for (const g of GROUPS) {
      items.push({
        label: g.title,
        count: String(grouped.counts[g.key] ?? 0),
      });
    }
    return items;
  }, [allClients.length, contractRequiredClients.length, grouped.counts, isClientsFetching, total]);

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
      const flat = buildAllClientRowsForList(allFilteredClients);
      return flat.length > 0
        ? [{ key: "all", title: "", group: GROUPS[0], fullRows: flat, fullCount: flat.length }]
        : [];
    }

    if (activeFilter === CONTRACT_REQUIRED_FILTER) {
      return contractRequiredClients.length > 0
        ? [{
            key: "contract_required",
            title: `${CONTRACT_REQUIRED_FILTER} · ${contractRequiredClients.length}명`,
            group: GROUPS[0],
            fullRows: contractRequiredClients,
            fullCount: contractRequiredClients.length,
          }]
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
  }, [activeFilter, contractRequiredClients, grouped.map, allFilteredClients]);

  const maxFullCount = useMemo(
    () => sectionsFull.reduce((m, s) => Math.max(m, s.fullCount), 0),
    [sectionsFull],
  );

  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}::${searchQuery}`,
      totalItems: maxFullCount,
    });

  // The client list expands past the first screen on its own instead of parking
  // on the tap-to-load-more footer, so the reveal never ends on a button here.
  useEffect(() => {
    if (isInitialLoad && hasMore) loadMore();
  }, [isInitialLoad, hasMore, loadMore]);

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
        data-component="mobile_clients_detail-sheet"
        name="clients"
        sheetTitle={detailClient?.name}
        isOpen={Boolean(detailClient || selectedClientIdFromParam !== null || detailController.isDetailRefreshing || detailController.detailRefreshError)}
        onClose={handleCloseDetailSheet}
        list={
          <div
            className="shell-content flex-col gap-[calc(8px*var(--glint-ui-scale,1))]"
            data-component="mobile_clients_detail-sheet_stack_list-page_content"
            data-slot="clients-content"
          >
            <MobileSectionNav
              data-component="mobile_clients_detail-sheet_stack_list-page_content_section-nav"
              ariaLabel="고객 섹션"
              items={CLIENT_SECTIONS}
              activeId={activeSection}
              onSelect={setActiveSection}
            />
            {activeSection === "list" ? (
              <ListCard
              data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card"
              title="고객"
              count={
                isClientsFetching
                  ? (
                    <ListCountSkeleton
                      data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_header_count-skeleton"
                    />
                  )
                  : `${total ?? allClients.length}명`
              }
              actionLabel="+ 추가"
              actionHref="/clients/new"
              filters={filterItems}
              activeFilter={activeFilter}
              onFilterChange={setActiveFilter}
              scrollRef={scrollContainerRef}
              loadMore={false}
              beforeFilters={
                <MobileSearchBar
                  data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_search"
                  placeholder="고객 이름, 매니저 검색"
                  label="clients"
                  value={searchQuery}
                  onChange={setSearchQuery}
                />
              }
            >
              {isClientsFetching ? (
                <ListRowsSkeleton
                  data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_body_rows-skeleton"
                />
              ) : visibleSections.length === 0 ? (
                <div
                  style={{
                    padding: "32px 16px",
                    textAlign: "center",
                    fontSize: "0.82rem",
                    color: "hsl(var(--v3-text-muted))",
                  }}
                  data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_body_empty"
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
                    data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_body_section"
                  >
                    {section.rows.map((c, idx) => {
                      const g = groupForClient(c);
                      const badges = getMobileClientBadges(c);
                      const avatarTone = badges[0]?.tone ?? g.badgeTone;
                      return (
                      <ListItemRow
                        key={c.id}
                        style={{ animationDelay: `${Math.min(idx, 4) * 40}ms` }}
                        data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_body_section_row"
                        left={
                          <div
                            className={`list-avatar av-${avatarTone}`}
                            data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_body_section_row_avatar"
                          >
                            <User size={16} strokeWidth={2} />
                          </div>
                        }
                        name={c.name}
                        meta={clientMeta(c)}
                        right={
                          <ListRowBadges
                            data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_body_section_row_badges"
                            badges={badges}
                          />
                        }
                        onClick={() => handleSelectClient(c)}
                      />
                      );
                    })}
                  </div>
                ))}
                {!isInitialLoad && hasMore && (
                  <ListLoadMoreSentinel
                    data-component="mobile_clients_detail-sheet_stack_list-page_content_list-card_body_load-sentinel"
                    sentinelRef={sentinelRef}
                  />
                )}
                </>
              )}
              </ListCard>
            ) : (
              <ListCard
                data-component="mobile_clients_detail-sheet_stack_list-page_content_automation-card"
                title="고객 자동화"
                filters={[]}
                loadMore={false}
              >
                <ClientRegistrationPolicySettings data-component="mobile_clients_detail-sheet_stack_list-page_content_automation-card_body_client-registration-policy" />
              </ListCard>
            )}
          </div>
        }
        detail={
          detailClient || selectedClientIdFromParam !== null || detailController.isDetailRefreshing || detailController.detailRefreshError
            ? detailController.detail
            : <div className="detail-body" data-component="mobile_clients_detail-sheet_stack_detail-page_empty" />
        }
      />

      {detailController.deleteModal}

    </>
  );
}
