"use client";

import { useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import "@/components/app/mobile-redesign/redesign.css";
import { useSystemTemplates } from "@/features/system-templates/hooks";
import { useMessageTemplates } from "@/hooks/use-message-templates";
import { useListInfiniteScroll } from "@/hooks/useListInfiniteScroll";
import { ListLoadMoreButton, ListLoadMoreSentinel } from "@/components/app/mobile-redesign/primitives";
import { Switch } from "@/components/ui/switch";

import styles from "./page.module.css";

type TemplateKind = "system" | "user";
type TemplateChannel = "kakao" | "sms";
type TemplateFilter = "전체" | "시스템 자동" | "사용자 작성" | "사용 안 함";
type TemplateIconName =
  | "message"
  | "send"
  | "check"
  | "userCheck"
  | "thumbsUp"
  | "checkCircle"
  | "calendar";

interface TemplateRow {
  id: string;
  displayId: string;
  kind: TemplateKind;
  name: string;
  channel: TemplateChannel;
  eventLabel: string;
  sendLabel: string;
  enabled: boolean;
  icon: TemplateIconName;
}

const TEMPLATE_FILTERS: TemplateFilter[] = [
  "전체",
  "시스템 자동",
  "사용자 작성",
  "사용 안 함",
];

const MOCKUP_TEMPLATE_ROWS: TemplateRow[] = [
  {
    id: "system-client-welcome",
    displayId: "CLIENT_WELCOME",
    kind: "system",
    name: "고객 등록 환영",
    channel: "kakao",
    eventLabel: "고객 등록",
    sendLabel: "5월 12건 발송",
    enabled: true,
    icon: "message",
  },
  {
    id: "system-service-start-d1",
    displayId: "SERVICE_START_D1",
    kind: "system",
    name: "서비스 시작 D-1 안내",
    channel: "kakao",
    eventLabel: "서비스 시작 (D-1)",
    sendLabel: "5월 8건 발송",
    enabled: true,
    icon: "send",
  },
  {
    id: "system-service-end",
    displayId: "SERVICE_END",
    kind: "system",
    name: "서비스 종료 안내",
    channel: "kakao",
    eventLabel: "서비스 종료",
    sendLabel: "5월 6건 발송",
    enabled: true,
    icon: "check",
  },
  {
    id: "system-employee-assigned",
    displayId: "EMPLOYEE_ASSIGNED",
    kind: "system",
    name: "제공인력 배정 안내",
    channel: "kakao",
    eventLabel: "직원 배정",
    sendLabel: "5월 7건 발송",
    enabled: false,
    icon: "userCheck",
  },
  {
    id: "user-visit-change",
    displayId: "mock-visit-change",
    kind: "user",
    name: "방문 일정 변경 안내",
    channel: "kakao",
    eventLabel: "사용자 작성",
    sendLabel: "4월 23건 발송",
    enabled: true,
    icon: "thumbsUp",
  },
  {
    id: "user-consultation-confirmed",
    displayId: "mock-consultation-confirmed",
    kind: "user",
    name: "상담 예약 확정",
    channel: "sms",
    eventLabel: "사용자 작성",
    sendLabel: "5월 4건 발송",
    enabled: true,
    icon: "message",
  },
  {
    id: "user-satisfaction",
    displayId: "mock-satisfaction",
    kind: "user",
    name: "서비스 만족도 조사",
    channel: "kakao",
    eventLabel: "사용자 작성",
    sendLabel: "5월 11건 발송",
    enabled: true,
    icon: "checkCircle",
  },
  {
    id: "user-monthly-billing",
    displayId: "mock-monthly-billing",
    kind: "user",
    name: "월별 정산 안내",
    channel: "kakao",
    eventLabel: "사용자 작성",
    sendLabel: "4월 1건 발송",
    enabled: false,
    icon: "calendar",
  },
];

const MOCKUP_FILTER_COUNTS: Record<TemplateFilter, string> = {
  "전체": "12",
  "시스템 자동": "4",
  "사용자 작성": "8",
  "사용 안 함": "2",
};

const getTemplateDestination = (template: TemplateRow): string => {
  if (template.kind === "system") {
    return `/messages/system-templates/${template.displayId}`;
  }

  return `/messages/new?template=${encodeURIComponent(template.displayId)}`;
};

const getFilterCount = (
  rows: TemplateRow[],
  filter: TemplateFilter,
  useMockupCounts: boolean,
): string => {
  if (useMockupCounts) {
    return MOCKUP_FILTER_COUNTS[filter];
  }

  if (filter === "전체") return String(rows.length);
  if (filter === "시스템 자동") return String(rows.filter((row) => row.kind === "system").length);
  if (filter === "사용자 작성") return String(rows.filter((row) => row.kind === "user").length);
  return String(rows.filter((row) => !row.enabled).length);
};

const matchesFilter = (row: TemplateRow, filter: TemplateFilter): boolean => {
  if (filter === "전체") return true;
  if (filter === "시스템 자동") return row.kind === "system";
  if (filter === "사용자 작성") return row.kind === "user";
  return !row.enabled;
};

const normalizeSearch = (value: string): string => value.trim().toLocaleLowerCase("ko-KR");

export default function TemplatesPage() {
  const router = useRouter();
  const [activeFilter, setActiveFilter] = useState<TemplateFilter>("전체");
  const [searchQuery, setSearchQuery] = useState("");
  const [enabledOverrides, setEnabledOverrides] = useState<Record<string, boolean>>({});

  const { data: systemTemplates } = useSystemTemplates();
  const { data: userTemplates } = useMessageTemplates();

  const liveRows = useMemo<TemplateRow[]>(() => {
    const systemRows = (systemTemplates || []).map<TemplateRow>((template, index) => ({
      id: `system-${template.templateKey}`,
      displayId: template.templateKey,
      kind: "system",
      name: template.name,
      channel: "kakao",
      eventLabel: template.description || "시스템 자동",
      sendLabel: `${index + 1}건 발송`,
      enabled: true,
      icon: MOCKUP_TEMPLATE_ROWS[index % 4]?.icon ?? "message",
    }));

    const userRows = (userTemplates || []).map<TemplateRow>((template, index) => ({
      id: `user-${template.id}`,
      displayId: template.id,
      kind: "user",
      name: template.name,
      channel: "kakao",
      eventLabel: "사용자 작성",
      sendLabel: `${index + 1}건 발송`,
      enabled: true,
      icon: MOCKUP_TEMPLATE_ROWS[(index % 4) + 4]?.icon ?? "thumbsUp",
    }));

    return [...systemRows, ...userRows];
  }, [systemTemplates, userTemplates]);

  const usesMockupRows = liveRows.length === 0;
  const rows = usesMockupRows ? MOCKUP_TEMPLATE_ROWS : liveRows;

  const visibleRows = useMemo(() => {
    const query = normalizeSearch(searchQuery);
    return rows
      .map((row) => ({ ...row, enabled: enabledOverrides[row.id] ?? row.enabled }))
      .filter((row) => matchesFilter(row, activeFilter))
      .filter((row) => {
        if (!query) return true;
        return `${row.name} ${row.eventLabel} ${row.channel}`
          .toLocaleLowerCase("ko-KR")
          .includes(query);
      });
  }, [activeFilter, enabledOverrides, rows, searchQuery]);

  const systemRowsFull = visibleRows.filter((row) => row.kind === "system");
  const userRowsFull = visibleRows.filter((row) => row.kind === "user");
  const systemTitle = usesMockupRows ? "시스템 자동 · 4개" : `시스템 자동 · ${systemRowsFull.length}개`;
  const userTitle = usesMockupRows ? "사용자 작성 · 8개" : `사용자 작성 · ${userRowsFull.length}개`;

  const maxFullCount = Math.max(systemRowsFull.length, userRowsFull.length);
  const { visibleCount, isInitialLoad, hasMore, sentinelRef, scrollContainerRef, loadMore } =
    useListInfiniteScroll({
      resetKey: `${activeFilter}::${searchQuery}`,
      totalItems: maxFullCount,
    });

  const systemRows = systemRowsFull.slice(0, visibleCount);
  const userRows = userRowsFull.slice(0, visibleCount);

  const openTemplate = (row: TemplateRow) => {
    router.push(getTemplateDestination(row));
  };

  const handleRowKeyDown = (event: KeyboardEvent<HTMLDivElement>, row: TemplateRow) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openTemplate(row);
    }
  };

  const toggleTemplate = (row: TemplateRow) => {
    setEnabledOverrides((current) => ({
      ...current,
      [row.id]: !(current[row.id] ?? row.enabled),
    }));
  };

  return (
    <div data-component="messages-templates" className={styles.page}>
      <div className={styles.header} data-component="messages-templates-header">
        <Link href="/messages" className={styles.backLink}>
          <MockupIcon name="chevronLeft" size={22} />
          <span>메시지</span>
        </Link>
        <div className={styles.headerTitle} data-component="messages-templates-header-title">
          템플릿 관리
        </div>
        <div className={styles.headerRight} data-component="messages-templates-header-right">
          <Link href="/messages/templates/new" className={styles.headerAction}>
            + 새 템플릿
          </Link>
        </div>
      </div>

      <div className="shell-content" data-component="messages-templates-content">
        <div className="list-card pop-up" data-component="messages-templates-card">
          <label className={`search-bar ${styles.searchBar}`} data-component="messages-templates-search">
            <MockupIcon name="search" size={14} />
            <input
              type="text"
              value={searchQuery}
              placeholder="템플릿명, 이벤트 검색"
              aria-label="템플릿명, 이벤트 검색"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>

          <div className="filter-row" data-component="messages-templates-filters">
            {TEMPLATE_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                className={`filter-pill ${activeFilter === filter ? "active" : ""}`}
                aria-pressed={activeFilter === filter}
                onClick={() => setActiveFilter(filter)}
              >
                {filter} <span className="count">{getFilterCount(rows, filter, usesMockupRows)}</span>
              </button>
            ))}
          </div>

          <div ref={scrollContainerRef} className="list-card-scroll" data-component="messages-templates-scroll">
            {systemRows.length > 0 && (
              <TemplateSection
                title={systemTitle}
                rows={systemRows}
                onOpen={openTemplate}
                onKeyDown={handleRowKeyDown}
                onToggle={toggleTemplate}
              />
            )}
            {userRows.length > 0 && (
              <TemplateSection
                title={userTitle}
                rows={userRows}
                onOpen={openTemplate}
                onKeyDown={handleRowKeyDown}
                onToggle={toggleTemplate}
              />
            )}
            {!isInitialLoad && hasMore && (
              <ListLoadMoreSentinel
                sentinelRef={sentinelRef}
                dataComponentPrefix="messages-templates"
              />
            )}
          </div>
          {isInitialLoad && hasMore && (
            <div className="list-card-footer" data-component="messages-templates-footer">
              <ListLoadMoreButton
                onLoadMore={loadMore}
                dataComponentPrefix="messages-templates"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateSection({
  title,
  rows,
  onOpen,
  onKeyDown,
  onToggle,
}: {
  title: string;
  rows: TemplateRow[];
  onOpen: (row: TemplateRow) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: TemplateRow) => void;
  onToggle: (row: TemplateRow) => void;
}) {
  return (
    <div className="section-block" data-component="messages-templates-section">
      <div className="section-header" data-component="messages-templates-section-header">
        {title}
      </div>
      {rows.map((row) => (
        <TemplateListRow
          key={row.id}
          row={row}
          onOpen={onOpen}
          onKeyDown={onKeyDown}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

function TemplateListRow({
  row,
  onOpen,
  onKeyDown,
  onToggle,
}: {
  row: TemplateRow;
  onOpen: (row: TemplateRow) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>, row: TemplateRow) => void;
  onToggle: (row: TemplateRow) => void;
}) {
  const channelLabel = row.channel === "kakao" ? "알림톡" : "SMS";

  return (
    <div
      className="list-item"
      data-component="messages-templates-row"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(row)}
      onKeyDown={(event) => onKeyDown(event, row)}
    >
      <div
        className={`${styles.templateIcon} ${
          row.channel === "kakao" ? styles.templateIconKakao : styles.templateIconSms
        }`}
        data-component="messages-templates-row-icon"
      >
        <MockupIcon name={row.icon} size={18} />
      </div>
      <div className="list-info" data-component="messages-templates-row-info">
        <div className="list-name" data-component="messages-templates-row-name">
          {row.name}
          <span
            className={`${styles.channel} ${
              row.channel === "kakao" ? styles.channelKakao : styles.channelSms
            }`}
          >
            {channelLabel}
          </span>
        </div>
        <div className={styles.templateMeta} data-component="messages-templates-row-meta">
          {row.eventLabel} <span className={styles.metaSeparator}>·</span> {row.sendLabel}
        </div>
      </div>
      <Switch
        data-component="messages-templates-row-switch"
        aria-label={`${row.name} 자동 발송`}
        checked={row.enabled}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={() => onToggle(row)}
      />
    </div>
  );
}

function MockupIcon({
  name,
  size,
}: {
  name: TemplateIconName | "chevronLeft" | "search";
  size: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      {name === "chevronLeft" && <polyline points="15 18 9 12 15 6" />}
      {name === "search" && (
        <>
          <circle cx="11" cy="11" r="8" />
          <path d="m21 21-4.3-4.3" />
        </>
      )}
      {name === "message" && (
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      )}
      {name === "send" && (
        <>
          <path d="m22 2-7 20-4-9-9-4Z" />
          <path d="M22 2 11 13" />
        </>
      )}
      {name === "check" && <path d="M20 6 9 17l-5-5" />}
      {name === "userCheck" && (
        <>
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <polyline points="17 11 19 13 23 9" />
        </>
      )}
      {name === "thumbsUp" && (
        <path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" />
      )}
      {name === "checkCircle" && (
        <>
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </>
      )}
      {name === "calendar" && (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M8 2v4M16 2v4M3 10h18" />
        </>
      )}
    </svg>
  );
}
