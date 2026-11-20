"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MESSAGE_RECORD_STATUS_FILTER_LABELS, type MessageRecordStatusFilter } from "@babyjamjam/shared";
import { Ban, CalendarClock, FilePlus2, FileText, History } from "lucide-react";
import { PageSection, SectionNav, StatsBar } from "@/components/app/v3";
import type { SectionNavItem } from "@/components/app/v3/SectionNav";
import type { StatsBarItem } from "@/components/app/v3/StatsBar";
import type { useMessageHistoryListState } from "./useMessageHistoryListState";

export const MESSAGE_RECORD_STATUS_FILTER_TABS: { value: MessageRecordStatusFilter; label: string }[] = (
  ["all", "upcoming", "sent", "failed", "canceled"] as const
).map((value) => ({ value, label: MESSAGE_RECORD_STATUS_FILTER_LABELS[value] }));

interface MessagesSectionChromeProps {
  "data-component": string;
  historyState: Pick<ReturnType<typeof useMessageHistoryListState>, "isPanelLoading" | "statusCounts">;
  sections: readonly SectionNavItem[];
  activeId: string;
  onSelect?: (id: string) => void;
  branchTemplates?: { count: number | string; isLoading: boolean };
  children: ReactNode;
}

/** Shared messages statistics and navigation, with the page supplying its content. */
export function MessagesSectionChrome({
  "data-component": dataComponent,
  historyState,
  sections,
  activeId,
  onSelect,
  branchTemplates,
  children,
}: MessagesSectionChromeProps) {
  const router = useRouter();
  const items: StatsBarItem[] = MESSAGE_RECORD_STATUS_FILTER_TABS.map((tab, colorIndex) => ({
    icon: tab.value === "upcoming" ? CalendarClock : tab.value === "canceled" ? Ban : History,
    value: historyState.statusCounts[tab.value],
    label: tab.label,
    counter: "건",
    colorIndex,
  }));
  if (branchTemplates) {
    items.push({
      icon: FileText,
      value: branchTemplates.count,
      label: "지점 템플릿",
      counter: "개",
      isLoading: branchTemplates.isLoading,
    });
  }
  const navItems = sections.flatMap((section) => [
    ...(section.id === "settings" ? [{ id: "template-create", label: "템플릿 만들기", icon: FilePlus2 }] : []),
    section,
  ]);

  return (
    <PageSection name={dataComponent}>
      <div data-slot="page-scroll-region" data-source-component="MessagesSectionChrome" className="contents max-md:flex max-md:min-h-0 max-md:flex-1 max-md:flex-col max-md:gap-[calc(24px*var(--glint-ui-scale,1))] max-md:overflow-y-auto">
        <StatsBar
          name={dataComponent}
          showDocumentJobs="whenActive"
          isLoading={historyState.isPanelLoading}
          items={items}
        />
        <div data-slot="page-sections" className="flex flex-1 min-h-0 flex-col gap-4 max-md:min-h-[calc(100vh-calc(160px*var(--glint-ui-scale,1)))] lg:flex-row lg:items-stretch">
          <SectionNav
            data-component={`${dataComponent}_section-nav`}
            ariaLabel="메시지 기능"
            items={navItems}
            activeId={activeId}
            onSelect={(id) => {
              if (id === "template-create") {
                router.push("/messages/templates/new");
              } else if (onSelect) {
                onSelect(id);
              } else {
                router.push(`/messages?section=${id}`);
              }
            }}
          />
          {children}
        </div>
      </div>
    </PageSection>
  );
}
