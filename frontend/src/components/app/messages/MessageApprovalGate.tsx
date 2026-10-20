"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "@/services/api";
import { MessageApprovalRequiredNotice } from "@/components/app/messages/MessageApprovalRequiredNotice";
import { QueryErrorState } from "@/components/app/ui/QueryErrorState";

export const MESSAGE_SENDER_APPROVAL_QUERY_KEY = [
  "settings",
  "message-sender-approval",
] as const;

export function useMessageSenderApproval() {
  return useQuery({
    queryKey: MESSAGE_SENDER_APPROVAL_QUERY_KEY,
    queryFn: settingsApi.getMessageSenderApproval,
  });
}

export function MessageApprovalGate({
  children,
  dataComponent,
  enabled = true,
}: {
  children: ReactNode;
  dataComponent: string;
  enabled?: boolean;
}) {
  const { data: senderApproval, isLoading, isPaused, isError, isFetching, refetch } =
    useMessageSenderApproval();

  if (!enabled || isLoading || (isPaused && senderApproval === undefined) || senderApproval?.isApproved) {
    return <>{children}</>;
  }

  // A failed load with no earlier answer says nothing about approval, so it must
  // not read as "approval required".
  if (isError && senderApproval === undefined) {
    return (
      <div
        data-component={dataComponent}
        className="flex h-full min-h-0 flex-1 items-center justify-center"
      >
        <QueryErrorState
          dataComponent={`${dataComponent}_load-error`}
          size="panel"
          title="발신 승인 상태를 불러오지 못했습니다"
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </div>
    );
  }

  return (
    <div
      data-component={dataComponent}
      className="flex h-full min-h-0 flex-1 items-center justify-center"
    >
      <MessageApprovalRequiredNotice dataComponent={`${dataComponent}_notice`} />
    </div>
  );
}
