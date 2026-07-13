"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";

import { MessageSenderApprovalModal } from "@/components/app/messages/MessageSenderApprovalModal";
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
  const isSenderApprovalRoute = pathname?.startsWith("/messages/sender-approval") ?? false;

  const { data: senderApproval, isLoading } = useQuery({
    queryKey: MESSAGE_SENDER_APPROVAL_QUERY_KEY,
    queryFn: settingsApi.getMessageSenderApproval,
    enabled: !isSenderApprovalRoute,
  });

  const needsSenderApproval = Boolean(senderApproval && !senderApproval.isApproved);
  const isApprovalPending = senderApproval?.approvalStatus === "pending";
  const needsRequestPermission = Boolean(
    senderApproval && !senderApproval.isApproved && !senderApproval.canRequest,
  );
  const shouldShowApprovalModal = !isSenderApprovalRoute && needsSenderApproval;

  const handleApprovalModalCancel = () => {
    router.replace("/all");
  };

  const handleApprovalRequest = () => {
    if (needsRequestPermission) {
      handleApprovalModalCancel();
      return;
    }

    router.push("/messages/sender-approval");
  };

  return (
    <MessagesPermissionGuardContext.Provider
      value={{
        isLoading: !isSenderApprovalRoute && isLoading,
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
