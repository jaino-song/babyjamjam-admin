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
} from "@/app/(components)/v3";
import {
  Users,
  Calendar,
  FileSignature,
  Send,
  MessageSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ChatWidget } from "@/app/(components)/chat/ChatWidget";
import { useState } from "react";

export default function DashboardPage() {
  const { data: stats, isLoading } = useDashboardStats();
  const user = useInitialUser();
  const [activeTab, setActiveTab] = useState("all");

  return (
    <div className="space-y-6">
      <PageHeader
        title="대시보드"
        subtitle="오늘의 업무 현황입니다"
        actions={
          <>
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
          </>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatMini
          icon={Users}
          value={stats?.activeClients ?? 0}
          label="활성 고객"
          colorIndex={0}
        />
        <StatMini
          icon={Calendar}
          value={stats?.upcomingThisMonth ?? 0}
          label="이번달 예정"
          colorIndex={1}
        />
        <StatMini
          icon={FileSignature}
          value={stats?.contractsPendingSignature ?? 0}
          label="서명 대기"
          colorIndex={2}
        />
        <StatMini
          icon={Send}
          value={stats?.contractsNotSent ?? 0}
          label="발송 대기"
          colorIndex={3}
        />
      </div>

      <SplitLayout>
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
        >
          {isLoading ? (
            <div className="p-8 text-center text-v3-text-muted">
              로딩 중...
            </div>
          ) : (
            <div className="divide-y divide-v3-border">
              <div className="p-4 hover:bg-v3-primary-light rounded-xl cursor-pointer transition-colors">
                <p className="text-sm font-medium text-v3-dark">
                  새 고객 등록
                </p>
                <p className="text-xs text-v3-text-muted mt-1">
                  오늘 등록된 고객이 있습니다
                </p>
              </div>
              <div className="p-4 hover:bg-v3-primary-light rounded-xl cursor-pointer transition-colors">
                <p className="text-sm font-medium text-v3-dark">
                  계약 서명 완료
                </p>
                <p className="text-xs text-v3-text-muted mt-1">
                  서명이 완료된 계약이 있습니다
                </p>
              </div>
              <div className="p-4 hover:bg-v3-primary-light rounded-xl cursor-pointer transition-colors">
                <p className="text-sm font-medium text-v3-dark">일정 알림</p>
                <p className="text-xs text-v3-text-muted mt-1">
                  이번 주 예정된 일정이 있습니다
                </p>
              </div>
            </div>
          )}
        </ListPanel>

        <DetailPanel
          header={
            <h3 className="text-lg font-bold text-v3-dark">업무 요약</h3>
          }
        >
          <div className="space-y-4">
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

            <div className="mt-4">
              <ChatWidget />
            </div>
          </div>
        </DetailPanel>
      </SplitLayout>
    </div>
  );
}
