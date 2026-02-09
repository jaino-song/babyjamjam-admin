"use client";

import { useDashboardStats } from "@/app/hooks/useDashboardStats";
import { useInitialUser } from "@/app/(components)/providers/UserProvider";
import {
  PageHeader,
  StatMini,
  SplitLayout,
  ListPanel,
  DetailPanel,
  InfoCard,
  InfoRow,
  AnimatedSlotList,
} from "@/app/(components)/v3";
import {
  Users,
  Calendar,
  FileSignature,
  Send,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { ChatWidget } from "@/app/(components)/chat/ChatWidget";
import { useState } from "react";

const iconBackgroundColors = [
  "bg-v3-primary text-white",
  "bg-[hsl(355,36%,45%)] text-white",
  "bg-[hsl(34,100%,55%)] text-white",
  "bg-[hsl(213,15%,50%)] text-white",
];

const DASHBOARD_ACTIVITIES = [
  {
    id: "new-client",
    tab: "clients",
    title: "새 고객 등록",
    description: "오늘 등록된 고객이 있습니다",
    badge: "고객",
    icon: Users,
  },
  {
    id: "contract-signed",
    tab: "contracts",
    title: "계약 서명 완료",
    description: "서명이 완료된 계약이 있습니다",
    badge: "계약",
    icon: FileSignature,
  },
  {
    id: "schedule-reminder",
    tab: "contracts",
    title: "일정 알림",
    description: "이번 주 예정된 일정이 있습니다",
    badge: "일정",
    icon: Calendar,
  },
  {
    id: "staff-report",
    tab: "employees",
    title: "직원 업무 보고",
    description: "오늘 업무 보고가 등록되었습니다",
    badge: "직원",
    icon: Users,
  },
] as const;

const DASHBOARD_STATS = [
  { icon: Users, valueKey: "activeClients", label: "활성 고객", colorIndex: 0, counter: "명" },
  { icon: Calendar, valueKey: "upcomingThisMonth", label: "이번달 예정", colorIndex: 1, counter: "건" },
  { icon: FileSignature, valueKey: "contractsPendingSignature", label: "서명 대기", colorIndex: 2, counter: "건" },
  { icon: Send, valueKey: "contractsNotSent", label: "발송 대기", colorIndex: 3, counter: "건" },
] as const;

export default function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats();
  useInitialUser();
  const [activeTab, setActiveTab] = useState("all");
  const filteredActivities =
    activeTab === "all"
      ? DASHBOARD_ACTIVITIES
      : DASHBOARD_ACTIVITIES.filter((activity) => activity.tab === activeTab);

  return (
    <section
      data-component="dashboard"
      className="space-y-6"
    >
      <div data-component="dashboard-header">
        <PageHeader
          title="대시보드"
          subtitle="오늘의 업무 현황입니다"
          actions={
            <div data-component="dashboard-header-actions" className="flex gap-2">
              <Link href="/contracts/creation">
                <Button className="bg-v3-primary hover:bg-v3-primary-hover text-white rounded-2xl px-4 py-2 text-sm">
                  <Send className="w-4 h-4 mr-2" /> 계약 발송
                </Button>
              </Link>
              <Link href="/messages">
                <Button
                  variant="outline"
                  className="rounded-2xl px-4 py-2 text-sm border-v3-border"
                >
                  <MessageSquare className="w-4 h-4 mr-2" /> 메시지 작성
                </Button>
              </Link>
            </div>
          }
        />
      </div>

      <div
        data-component="dashboard-stats"
        // Don't animate the whole grid as one "page child"; animate each card with staggering instead.
        className="grid grid-cols-2 lg:grid-cols-4 gap-4"
      >
        {DASHBOARD_STATS.map((stat, idx) => (
          <div
            key={stat.valueKey}
            data-component="dashboard-stats-item"
          >
            <StatMini
              icon={stat.icon}
              value={stats?.[stat.valueKey] ?? 0}
              label={stat.label}
              colorIndex={stat.colorIndex}
              animationDelay={`${idx * 0.08}s`}
              isLoading={isLoading}
              counter={stat.counter}
            />
          </div>
        ))}
      </div>

      <div
        data-component="dashboard-split"
      >
        <SplitLayout>
          <div data-component="dashboard-activities-panel">
            <ListPanel
              title="최근 활동"
              tabs={[
                { label: "전체", value: "all" },
                { label: "고객", value: "clients" },
                { label: "계약", value: "contracts" },
                { label: "직원", value: "employees" },
              ]}
              activeTab={activeTab}
              onTabChange={setActiveTab}
              isLoading={isLoading}
            >
              <div
                data-component="dashboard-split-list"
                className="space-y-2"
              >
                {!isLoading && filteredActivities.length === 0 ? (
                  <div
                    data-component="dashboard-split-list-empty"
                    className="p-8 text-center text-v3-text-muted"
                  >
                    표시할 활동이 없습니다
                  </div>
                ) : (
                  <AnimatedSlotList
                    count={4}
                    items={filteredActivities}
                    isLoading={isLoading}
                    itemDataComponent="dashboard-split-list-item"
                    className="space-y-2"
                    slotClassName={({ item, isLoading }) =>
                      cn(
                        "flex items-center gap-3 p-4 rounded-[18px] transition-all duration-200 bg-white border-2 border-transparent",
                        !isLoading &&
                          item &&
                          "cursor-pointer hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                      )
                    }
                    render={({ index, item, isLoading }) => {
                      const activity = item;
                      const Icon = activity?.icon;
                      const iconBackgroundColor =
                        iconBackgroundColors[index % iconBackgroundColors.length];

                      return (
                        <>
                          <div
                            data-component="dashboard-split-list-item-icon"
                            className={cn(
                              "w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 shadow-md",
                              isLoading ? "bg-v3-dim-white" : iconBackgroundColor
                            )}
                          >
                            {isLoading ? (
                              <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                            ) : (
                              Icon && <Icon className="w-4 h-4" />
                            )}
                          </div>

                          <div
                            data-component="dashboard-split-list-item-content"
                            className="flex-1 min-w-0"
                          >
                            <div
                              data-component="dashboard-split-list-item-header"
                              className="flex items-center gap-2 mb-0.5"
                            >
                              {isLoading ? (
                                <>
                                  <Skeleton className="h-4 w-40 bg-v3-dim-white" />
                                  <Skeleton className="h-4 w-12 rounded-full bg-v3-dim-white" />
                                </>
                              ) : (
                                <>
                                  <span className="font-bold text-[0.85rem] text-v3-dark truncate">
                                    {activity?.title}
                                  </span>
                                  <Badge
                                    variant="secondary"
                                    className="bg-[hsl(214,100%,95%)] text-v3-primary border-none rounded-full px-2 py-0 text-[9px] font-bold shrink-0"
                                  >
                                    {activity?.badge}
                                  </Badge>
                                </>
                              )}
                            </div>

                            {isLoading ? (
                              <Skeleton className="h-3 w-56 bg-v3-dim-white" />
                            ) : (
                              <p className="text-[0.7rem] text-v3-text-muted truncate">
                                {activity?.description}
                              </p>
                            )}
                          </div>
                        </>
                      );
                    }}
                  />
                )}
              </div>
            </ListPanel>
          </div>

          <div
            data-component="dashboard-summary-panel"
          >
            <DetailPanel
              header={
                <h3 className="text-lg font-bold text-v3-dark">업무 요약</h3>
              }
            >
              <div data-component="dashboard-split-detail" className="space-y-4">
                <InfoCard title="이번 달 현황">
                  <InfoRow label="활성 고객" value={stats?.activeClients ?? "-"} />
                  <InfoRow
                    label="이번달 예정"
                    value={stats?.upcomingThisMonth ?? "-"}
                  />
                  <InfoRow
                    label="다음달 예정"
                    value={stats?.upcomingNextMonth ?? "-"}
                  />
                  <InfoRow
                    label="서명 대기"
                    value={stats?.contractsPendingSignature ?? "-"}
                  />
                </InfoCard>

                <div
                  data-component="dashboard-chat-widget"
                  className={cn(
                    // Mobile: chat entry is in the bottom nav (center button), so hide this bar.
                    "mt-4 hidden md:block",
                    "animate-v3-pop-in"
                  )}
                  style={{ animationDelay: "0.28s" }}
                >
                  <ChatWidget />
                </div>
              </div>
            </DetailPanel>
          </div>
        </SplitLayout>
      </div>
    </section>
  );
}
