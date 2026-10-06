"use client";

import { HolidayPageShell } from "./HolidayPageShell";

const DATA_COMPONENT = "mobile_holidays_settings_branch-required";

/**
 * Shown in place of HolidaySettingsSection when the session has no selected
 * branch. A branch manager can reach the route without an active branch — and
 * holidays are edited per branch.
 */
export function HolidayBranchRequired() {
  return (
    <HolidayPageShell
      dataComponent={DATA_COMPONENT}
      title="공휴일"
      description="공휴일은 지점별로 관리돼요. 상단에서 지점을 먼저 선택해 주세요."
    />
  );
}
