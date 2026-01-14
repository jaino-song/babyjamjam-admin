import AssessmentIcon from "@mui/icons-material/Assessment";
import PeopleOutlineIcon from "@mui/icons-material/PeopleOutline";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import { Box, Stack } from "@mui/material";
import { HeroBanner } from "../(components)/dashboard/HeroBanner";
import { StatsGrid, StatItem } from "../(components)/dashboard/StatsGrid";
import { getCurrentUser } from "../lib/auth/cookies";
import { t, Locale } from "../lib/i18n/translations";
import { getLocale } from "../actions/locale";
import { PerformanceMetric } from "../(components)/dashboard/PerformanceOverview";
import { ActivityItem } from "../(components)/dashboard/RecentActivity";

const getStats = (locale: Locale): StatItem[] => [
  {
    title: t(locale, "dashboard.active_clients"),
    firstDataValue: "1,248",
    icon: PeopleOutlineIcon,
  },
  {
    title: t(locale, "dashboard.contracts.sending_pending"),
    firstDataValue: "14",
    icon: TrendingUpIcon,
  },
  {
    title: t(locale, "dashboard.contracts.completion_pending"),
    firstDataValue: "14",
    icon: AssessmentIcon,
  },
  {
    title: t(locale, "dashboard.pending_clients.title"),
    firstDataLabel: "10월",
    secondDataLabel: "11월",
    firstDataValue: "32 명",
    secondDataValue: "10 명",
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

// NOTE: 인증 체크는 dashboard/layout.tsx에서 처리
// layout에서 이미 getCurrentUser()를 호출하므로 여기서는 중복 호출하지 않음
export default async function Dashboard() {
  const locale = await getLocale();
  // layout에서 인증된 사용자만 접근 가능하므로 user는 항상 존재
  const user = await getCurrentUser();

  const stats = getStats(locale);

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

          <StatsGrid stats={stats} disabled={true} />
        </Stack>
      </Box>
    </Box>
  );
}
