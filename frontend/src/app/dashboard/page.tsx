import AssessmentIcon from "@mui/icons-material/Assessment";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { Box, Stack } from "@mui/material";
import { HeroBanner } from "../(components)/dashboard/HeroBanner";
import { StatsGrid, StatItem } from "../(components)/dashboard/StatsGrid";
import { ChatWidget } from "../(components)/chat/ChatWidget";
import { getCurrentUser } from "../lib/auth/cookies";
import { t, Locale } from "../lib/i18n/translations";
import { getLocale } from "../actions/locale";
import { PerformanceMetric } from "../(components)/dashboard/PerformanceOverview";
import { ActivityItem } from "../(components)/dashboard/RecentActivity";
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
      icon: PeopleOutlineIcon,
    },
    {
      title: t(locale, "dashboard.contracts.sending_pending"),
      firstDataValue: backendStats?.contractsNotSent?.toLocaleString() ?? "0",
      icon: TrendingUpIcon,
    },
    {
      title: t(locale, "dashboard.contracts.completion_pending"),
      firstDataValue: backendStats?.contractsPendingSignature?.toLocaleString() ?? "0",
      icon: AssessmentIcon,
    },
    {
      title: t(locale, "dashboard.pending_clients.title"),
      firstDataLabel: thisMonth,
      secondDataLabel: nextMonth,
      firstDataValue: `${backendStats?.upcomingThisMonth?.toLocaleString() ?? "0"} 명`,
      secondDataValue: `${backendStats?.upcomingNextMonth?.toLocaleString() ?? "0"} 명`,
    },
  ];
};

const performanceMetrics: PerformanceMetric[] = [
  { label: "Mon", conversion: 75, progress: 70 },
  { label: "Tue", conversion: 80, progress: 76 },
  { label: "Wed", conversion: 85, progress: 82 },
  { label: "Thu", conversion: 90, progress: 88 },
  { label: "Fri", conversion: 95, progress: 93 },
];

const quickActions = ["Add User", "Review Requests", "Create Report", "Schedule Meeting"];

const activity: ActivityItem[] = [
  { primary: "New partner onboarded", secondary: "Today · Kelly Park" },
  { primary: "Invoice #3481 approved", secondary: "1 hr ago · Finance" },
  { primary: "Policy update published", secondary: "Yesterday · Compliance" },
  { primary: "System maintenance complete", secondary: "2 days ago · IT" },
];

export default async function Dashboard() {
  const locale = await getLocale();
  const user = await getCurrentUser();
  const backendStats = await fetchDashboardStats();
  const stats = getStats(locale, backendStats);

  return (
    <Box sx={{ bgcolor: "background.paper" }}>
      <Box
        component="section"
        data-component="dashboard"
        sx={{
          px: { xs: 2, sm: 3, md: 6 },
          py: { xs: 3, sm: 4 },
          mx: "auto",
        }}
      >
        <Stack spacing={3} sx={{ width: "100%" }}>
          <HeroBanner
            data-component="hero-banner"
            subtitle={t(locale, "dashboard.welcome_back")}
            title={`${user?.name} ${t(locale, "dashboard.suffix")}`}
            primaryActionLabel={t(locale, "actions.send_contract")}
            secondaryActionLabel={t(locale, "actions.write_message")}
            primaryActionHref="/contracts/creation"
            secondaryActionHref="/messages"
          />

          <ChatWidget />

          <StatsGrid stats={stats} />
        </Stack>
      </Box>
    </Box>
  );
}
