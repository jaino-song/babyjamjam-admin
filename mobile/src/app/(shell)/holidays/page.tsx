"use client";

import { CalendarDays } from "lucide-react";

import { HolidayBranchRequired } from "@/components/app/holidays/HolidayBranchRequired";
import { HolidaySettingsSection } from "@/components/app/holidays/HolidaySettingsSection";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { canManageBranch } from "@/lib/auth/branch-role-policy";

/** Canonical data-component base for the /holidays route. */
const HOLIDAYS_PAGE_BASE = "mobile_holidays_page";

export default function HolidaysPage() {
  const authUserQuery = useGetAuthUser();
  const user = authUserQuery.data;

  // canManageBranchFromAuthQuery is false while a refetch is in flight, which would unmount the section
  // (and its drafts) on every background refresh; only the very first load gates the screen.
  if (authUserQuery.isPending) {
    return (
      <div data-component={`${HOLIDAYS_PAGE_BASE}_loading`} className="flex flex-1 items-center justify-center">
        <Spinner data-component={`${HOLIDAYS_PAGE_BASE}_loading_spinner`} />
      </div>
    );
  }

  if (!canManageBranch(user)) {
    return (
      <Alert
        variant="info"
        role="status"
        icon={CalendarDays}
        data-component={`${HOLIDAYS_PAGE_BASE}_manager-only`}
      >
        <AlertTitle>공휴일</AlertTitle>
        <AlertDescription>
          <p>공휴일 설정은 지점 관리자만 사용할 수 있어요.</p>
        </AlertDescription>
      </Alert>
    );
  }

  if (!user?.branchId) {
    return <HolidayBranchRequired />;
  }

  return <HolidaySettingsSection key={user.branchId} branchId={user.branchId} branchName={user.branchName} />;
}
