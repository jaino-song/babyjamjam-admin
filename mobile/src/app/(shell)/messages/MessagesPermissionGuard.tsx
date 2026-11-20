"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";

import { MessageSenderApprovalModal } from "@/components/app/messages/MessageSenderApprovalModal";
import { PwaLaunchScreen } from "@/components/app/root/pwa-launch-screen";
import { settingsApi } from "@/services/api";

const MESSAGE_SENDER_APPROVAL_QUERY_KEY = ["settings", "message-sender-approval"] as const;

interface MessagesPermissionGuardState {
  isLoading: boolean;
  needsSenderApproval: boolean;
}

const MessagesPermissionGuardContext = createContext<MessagesPermissionGuardState>({
  isLoading: false,
  needsSenderApproval: false,
});

export function useMessagesPermissionGuard() {
  return useContext(MessagesPermissionGuardContext);
}

export function MessagesPermissionGuard({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isSettingsRoute = pathname?.startsWith("/messages/settings") ?? false;
  const isLegacySenderApprovalRoute =
    pathname?.startsWith("/messages/sender-approval") ?? false;
  const isImmediateRenderRoute =
    pathname === "/messages/new" || pathname === "/messages/compose";
  // /messages/history (the merged 발송 예정/발송 기록 screen) is intentionally NOT
  // exempt: it requires the same sending approval as every other message
  // screen. It used to be read-only-exempt back when it only showed past
  // sends; now it also surfaces upcoming sends and a cancel action, so it
  // needs the same gate as send/templates/triggers.
  const isPermissionExemptRoute =
    isSettingsRoute || isLegacySenderApprovalRoute;

  const { data: senderApproval, isLoading } = useQuery({
    queryKey: MESSAGE_SENDER_APPROVAL_QUERY_KEY,
    queryFn: settingsApi.getMessageSenderApproval,
    enabled: !isPermissionExemptRoute,
  });

  const needsSenderApproval = !isLoading && senderApproval?.isApproved !== true;
  const isApprovalPending = senderApproval?.approvalStatus === "pending";
  const needsRequestPermission = Boolean(
    senderApproval && !senderApproval.isApproved && !senderApproval.canRequest,
  );
  const shouldShowApprovalModal =
    !isPermissionExemptRoute && !isImmediateRenderRoute && needsSenderApproval;
  const isPermissionCheckLoading = !isPermissionExemptRoute && isLoading;

  const handleApprovalModalCancel = () => {
    router.replace("/all");
  };

  const handleApprovalRequest = () => {
    if (needsRequestPermission) {
      handleApprovalModalCancel();
      return;
    }

    router.push("/messages/settings");
  };

  // Maker and send render immediately. Their navigation and send action use
  // the active approval context, while local composition stays available.
  // Other protected routes retain the full-screen approval check.
  if (isPermissionCheckLoading && !isImmediateRenderRoute) {
    return <PwaLaunchScreen data-component="mobile_messages_permission-guard_loading" />;
  }

  return (
    <MessagesPermissionGuardContext.Provider
      value={{
        isLoading,
        needsSenderApproval,
      }}
    >
      {children}
      <MessageSenderApprovalModal
        open={shouldShowApprovalModal}
        isApprovalPending={isApprovalPending}
        onOpenChange={(open) => {
          if (!open) handleApprovalModalCancel();
        }}
        needsRequestPermission={needsRequestPermission}
        onCancel={handleApprovalModalCancel}
        onRequest={handleApprovalRequest}
      />
    </MessagesPermissionGuardContext.Provider>
  );
}
