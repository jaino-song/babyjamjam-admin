"use client";

import { useDashboardStats } from "@/hooks/useDashboardStats";
import { useInitialUser } from "@/providers/UserProvider";
import {
  StatMini,
  SplitLayout,
  ListPanel,
  DetailPanel,
  InfoCard,
  InfoRow,
  AnimatedSlotList,
} from "@/components/app/v3";
import {
  Users,
  Calendar,
  FileSignature,
  Send,
  MessageSquare,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ChatWidget } from "@/components/app/chat/ChatWidget";
import { useState } from "react";
import { HeroBanner } from "@/components/app/dashboard/HeroBanner";
import { redirect } from "next/navigation";
import { QuickActions } from "@/components/app/v3/QuickActions";
import { Block } from "@/components/app/v3/Block";

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
  const user = useInitialUser();
  const [activeTab, setActiveTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const filteredActivities =
    activeTab === "all"
      ? DASHBOARD_ACTIVITIES
      : DASHBOARD_ACTIVITIES.filter((activity) => activity.tab === activeTab);
  const searchedActivities = searchQuery.trim()
    ? filteredActivities.filter((a) =>
      a.title.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
      a.description.toLowerCase().includes(searchQuery.trim().toLowerCase())
    )
    : filteredActivities;

  if (!user) {
    redirect("/logout");
  }

  return (
    <section
      data-component="dashboard"
      className="space-y-6"
    >
      <HeroBanner
        title={user?.name ? `${user?.name} 님` : "다시 로그인 해주세요"}
        subtitle={user?.organizationName ?? ""}
      />

      <Block
        name="dashboard-stats"
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
      </Block>

      <QuickActions
        shortcuts={[
          { href: "/contracts/creation", label: "계약 발송", icon: Send },
          { href: "/messages", label: "메시지 작성", icon: MessageSquare },
          { href: "/messages", label: "메시지 작성", icon: MessageSquare },
          { href: "/messages", label: "메시지 작성", icon: MessageSquare },
        ]}
      />

      <Block
        name="dashboard-split"
      >
        <SplitLayout>
          <Block name="dashboard-activities-panel">
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
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder="활동 검색..."
              isLoading={isLoading}
            >
              <Block
                name="dashboard-split-list"
                className="space-y-2"
              >
                {!isLoading && searchedActivities.length === 0 ? (
                  <Block
                    name="dashboard-split-list-empty"
                    className="p-8 text-center text-v3-text-muted"
                  >
                    표시할 활동이 없습니다
                  </Block>
                ) : (
                  <AnimatedSlotList
                    count={4}
                    items={searchedActivities}
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

                          <Block
                            name="dashboard-split-list-item-content"
                            className="flex-1 min-w-0"
                          >
                            <Block
                              name="dashboard-split-list-item-header"
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
                            </Block>

                            {isLoading ? (
                              <Skeleton className="h-3 w-56 bg-v3-dim-white" />
                            ) : (
                              <p className="text-[0.7rem] text-v3-text-muted truncate">
                                {activity?.description}
                              </p>
                            )}
                          </Block>
                        </>
                      );
                    }}
                  />
                )}
              </Block>
            </ListPanel>
          </Block>
        </SplitLayout>
      </Block>
    </section>
  );
}
