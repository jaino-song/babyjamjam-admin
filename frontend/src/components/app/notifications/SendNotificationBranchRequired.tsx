"use client";

import { Send } from "lucide-react";

import { ContentPaper } from "@/components/app/root/content-paper";

const SOURCE_COMPONENT = "SendNotificationBranchRequired";
const DATA_COMPONENT = "desktop_settings_sections_send-notification_branch-required";

/**
 * Shown in place of SendNotificationSection when the session has no selected
 * branch: notifications go to one branch's staff, so there is no one to pick yet.
 */
export function SendNotificationBranchRequired() {
  return (
    <section data-component={DATA_COMPONENT} data-source-component={SOURCE_COMPONENT}>
      <ContentPaper variant="v3">
        <div data-component={`${DATA_COMPONENT}_header`} className="flex items-center gap-3">
          <div
            data-component={`${DATA_COMPONENT}_header_icon`}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-[hsl(var(--v3-primary))]/10"
          >
            <Send size={20} className="text-[hsl(var(--v3-primary))]" />
          </div>
          <div data-component={`${DATA_COMPONENT}_header_title-group`} className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-foreground">알림 보내기</h2>
            <p className="text-sm text-muted-foreground">
              알림은 지점 직원에게 보내집니다. 상단에서 지점을 먼저 선택해 주세요.
            </p>
          </div>
        </div>
      </ContentPaper>
    </section>
  );
}
