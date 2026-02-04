import { Users, TrendingUp, FileCheck, CalendarClock } from "lucide-react";
import { HeroBanner } from "../(components)/dashboard/HeroBanner";
import { StatsGrid, StatItem } from "../(components)/dashboard/StatsGrid";
import { ChatWidget } from "../(components)/chat/ChatWidget";
import { QuickActions } from "../(components)/dashboard/QuickActions";
import { TodayScheduleList } from "../(components)/dashboard/TodayScheduleList";
import { PendingClientsTable } from "../(components)/dashboard/PendingClientsTable";
import { ServiceDistributionChart } from "../(components)/dashboard/ServiceDistributionChart";
import { getCurrentUser } from "../lib/auth/cookies";
import { t, Locale } from "../lib/i18n/translations";
import { getLocale } from "../actions/locale";
import { cookies } from "next/headers";

interface DashboardStats {
  activeClients: number;
  contractsNotSent: number;
  contractsPendingSignature: number;
  upcomingThisMonth: number;
  upcomingNextMonth: number;
}

async function fetchDashboardStats(): Promise<DashboardStats | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return null;

    const baseUrl = process.env.DEVELOPMENT_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
    const response = await fetch(`${baseUrl}/clients/stats`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return response.json();
  } catch (error) {
    console.error("[Dashboard] Failed to fetch stats:", error);
    return null;
  }
}

const getStats = (locale: Locale, backendStats?: DashboardStats | null): StatItem[] => {
  const now = new Date();
  const thisMonth = `${now.getMonth() + 1}월`;
  const nextMonth = `${((now.getMonth() + 1) % 12) + 1}월`;

  return [
    {
      title: t(locale, "dashboard.active_clients"),
      firstDataValue: backendStats?.activeClients?.toLocaleString() ?? "0",
      icon: Users,
    },
    {
      title: t(locale, "dashboard.contracts.sending_pending"),
      firstDataValue: backendStats?.contractsNotSent?.toLocaleString() ?? "0",
      icon: TrendingUp,
    },
    {
      title: t(locale, "dashboard.contracts.status"),
      variant: "pill",
      firstTitle: t(locale, "dashboard.contracts.sending_pending"),
      firstDataValue: backendStats?.contractsNotSent?.toLocaleString() ?? "0",
      secondTitle: t(locale, "dashboard.contracts.completion_pending"),
      secondDataValue: backendStats?.contractsPendingSignature?.toLocaleString() ?? "0",
    },
    {
      title: t(locale, "dashboard.pending_clients.title"),
      firstDataLabel: thisMonth,
      secondDataLabel: nextMonth,
      firstDataValue: `${backendStats?.upcomingThisMonth?.toLocaleString() ?? "0"} 명`,
      secondDataValue: `${backendStats?.upcomingNextMonth?.toLocaleString() ?? "0"} 명`,
      icon: CalendarClock,
    },
  ];
};

export default async function Dashboard() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  const backendStats = await fetchDashboardStats();
  const stats = getStats(locale, backendStats);

  return (
    <div data-component="dashboard-page" className="bg-background">
      <section
        data-component="dashboard-content"
        className="px-4 sm:px-6 md:px-8 lg:px-12 py-6 sm:py-8 mx-auto max-w-7xl"
      >
        <div data-component="dashboard-layout" className="space-y-6 w-full">
          <HeroBanner
            data-component="hero-banner"
            subtitle={t(locale, "dashboard.welcome_back")}
            title={`${user?.name} ${t(locale, "dashboard.suffix")}`}
            primaryActionLabel={t(locale, "actions.send_contract")}
            secondaryActionLabel={t(locale, "actions.write_message")}
            primaryActionHref="/contracts/creation"
            secondaryActionHref="/messages"
          />

          <div data-component="chat-widget-container">
            <ChatWidget />
          </div>

          <div data-component="stats-grid-container">
            <StatsGrid stats={stats} />
          </div>

          <div data-component="quick-actions-container">
            <QuickActions />
          </div>

          <div data-component="service-chart-container" className="grid gap-4 min-w-0">
            <ServiceDistributionChart />
          </div>

          <div data-component="dashboard-tables" className="grid gap-4 lg:grid-cols-3">
            <div data-component="pending-clients-container" className="lg:col-span-2 min-w-0">
              <PendingClientsTable />
            </div>
            <div data-component="today-schedule-container">
              <TodayScheduleList />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
