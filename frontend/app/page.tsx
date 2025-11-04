import AssessmentIcon from "@mui/icons-material/Assessment";
import ChecklistIcon from "@mui/icons-material/Checklist";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { Box, Stack } from "@mui/material";
import { HeroBanner } from "./(components)/dashboard/HeroBanner";
import { StatsGrid, StatItem } from "./(components)/dashboard/StatsGrid";
import { PerformanceOverview, PerformanceMetric } from "./(components)/dashboard/PerformanceOverview";
import { QuickActions } from "./(components)/dashboard/QuickActions";
import { ActivityItem, RecentActivity } from "./(components)/dashboard/RecentActivity";
import { getCurrentUser } from "./lib/auth/cookies";
import { getLanguageForServerComp } from "./lib/i18n/getLanguageForServerComp";

const stats: StatItem[] = [
  {
    label: "Active Users",
    value: "1,248",
    helper: "+18% vs last week",
    icon: PeopleOutlineIcon,
  },
  {
    label: "Pending Approvals",
    value: "32",
    helper: "5 require follow-up",
    icon: ChecklistIcon,
  },
  {
    label: "Revenue",
    value: "$42.8k",
    helper: "+6.2% growth",
    icon: TrendingUpIcon,
  },
  {
    label: "Reports",
    value: "14",
    helper: "Updated today",
    icon: AssessmentIcon,
  },
];

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

export default async function Home() {
  const user = await getCurrentUser();
  const language = await getLanguageForServerComp();

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <Box
        component="main"
        sx={{
          px: { xs: 2, sm: 3, md: 6 },
          py: { xs: 3, sm: 4 },
          maxWidth: 1200,
          mx: "auto",
        }}
      >
        <Stack spacing={3}>
          <HeroBanner
            subtitle={language === "ko" ? "환영합니다 😀" : "Welcome back 😀"}
            title={language === "ko" ? `${user?.name} 님` : `${user?.name} 👋` || "Stranger"} 
            primaryActionLabel={language === "ko" ? "요금 계산기" : "Price Calculator"}
            secondaryActionLabel={language === "ko" ? "메시지 작성" : "Write Message"}
          />

          <StatsGrid stats={stats} />

          <Stack direction={{ xs: "column", md: "row" }} spacing={2}>
            <PerformanceOverview
              title="Weekly Performance"
              subtitle="Total conversion rate compared to the previous period."
              metrics={performanceMetrics}
            />
            <QuickActions
              title="Quick Actions"
              subtitle="Stay ahead of today's priorities."
              actions={quickActions}
            />
          </Stack>

          <RecentActivity items={activity} title="Recent Activity" actionLabel="View all" />
        </Stack>
      </Box>
    </Box>
  );
}
