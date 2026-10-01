"use client";

import { CalendarDays } from "lucide-react";

import { ContentPaper } from "@/components/app/root/content-paper";

const SOURCE_COMPONENT = "HolidayBranchRequired";
const DATA_COMPONENT = "desktop_settings_sections_holidays_branch-required";

/**
 * Shown in place of HolidaySettingsSection when the session has no selected
 * branch. The nav entry is role-gated, not branch-gated, so an owner can reach
 * the section without a branch — and holidays are edited per branch.
 */
export function HolidayBranchRequired() {
  return (
    <section data-component={DATA_COMPONENT} data-source-component={SOURCE_COMPONENT}>
      <ContentPaper variant="v3">
        <div data-component={`${DATA_COMPONENT}_header`} className="flex items-center gap-3">
          <div
            data-component={`${DATA_COMPONENT}_header_icon`}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-v3-burgundy/10"
          >
            <CalendarDays size={20} className="text-v3-burgundy" />
          </div>
          <div data-component={`${DATA_COMPONENT}_header_title-group`} className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-foreground">공휴일</h2>
            <p className="text-sm text-muted-foreground">
              공휴일은 지점별로 관리돼요. 상단에서 지점을 먼저 선택해 주세요.
            </p>
          </div>
        </div>
      </ContentPaper>
    </section>
  );
}
