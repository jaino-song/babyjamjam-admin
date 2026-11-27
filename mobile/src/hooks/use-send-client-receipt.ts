"use client";

import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { parse } from "cookie";
import {
  isCopaymentReceivedDate,
  RECEIPT_SEND_SUCCESS,
  requestStandaloneReceipt,
} from "@babyjamjam/shared";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";

import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { useToast } from "@/hooks/use-toast";
import { clientQueryKeys, fetchClient } from "@/hooks/useClients";

function getActiveBranchId(): string | null {
  return typeof document === "undefined" ? null : parse(document.cookie).selected_branch_id || null;
}

function isBranchContextAligned(branchId: string | null): boolean {
  return Boolean(branchId && branchId === getActiveBranchId());
}

function subscribeToBranchContext(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  window.addEventListener("pageshow", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("pageshow", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

const getServerBranchId = (): null => null;

function receiptDetailKey(clientId: number, branchId: string | null) {
  return [...clientQueryKeys.detail(clientId), { branchId }] as const;
}

interface ReceiptDraft {
  scope: { branchId: string | null; clientId: number | null };
  editedDate: string | null;
  error: string | null;
  isPending: boolean;
}

export function useSendClientReceipt(clientId: number) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const branchId = useSyncExternalStore(subscribeToBranchContext, getActiveBranchId, getServerBranchId);
  const { data: detail } = useQuery({
    queryKey: receiptDetailKey(clientId, branchId),
    queryFn: () => {
      if (!isBranchContextAligned(branchId)) throw new Error("Branch selection changed");
      return fetchClient(clientId);
    },
    enabled: clientId > 0 && branchId !== null,
  });
  const savedDate = detail?.id === clientId ? detail.copaymentReceivedDate : null;
  const scope = useMemo(() => ({ branchId, clientId }), [branchId, clientId]);
  const activeScope = useRef<typeof scope | null>(null);
  const pendingScope = useRef<typeof scope | null>(null);
  const [draft, setDraft] = useState<ReceiptDraft | null>(null);

  useLayoutEffect(() => {
    activeScope.current = scope;
    return () => { activeScope.current = null; };
  }, [scope]);

  if (draft && draft.scope !== scope) setDraft(null);
  const activeDraft = draft?.scope === scope ? draft : null;
  const date = activeDraft?.editedDate ?? savedDate ?? "";
  const canSubmit = Boolean(branchId && clientId > 0 && isCopaymentReceivedDate(date));

  const open = () => {
    if (clientId <= 0 || !isBranchContextAligned(branchId) || activeScope.current !== scope || activeDraft) return;
    setDraft({ scope, editedDate: null, error: null, isPending: false });
  };

  const dismiss = () => {
    if (activeScope.current !== scope || pendingScope.current === scope) return;
    setDraft(null);
  };

  const editDate = (value: string) => {
    if (!activeDraft || activeDraft.isPending || activeScope.current !== scope || pendingScope.current === scope) return;
    setDraft({ ...activeDraft, editedDate: formatIsoDateInput(value), error: null });
  };

  const submit = async (): Promise<void> => {
    if (!activeDraft || activeDraft.isPending || !canSubmit || !branchId || !isBranchContextAligned(branchId)
      || activeScope.current !== scope || pendingScope.current === scope) return;

    pendingScope.current = scope;
    setDraft({ ...activeDraft, isPending: true, error: null });

    const outcome = await requestStandaloneReceipt(branchId, clientId, date);
    if (pendingScope.current === scope) pendingScope.current = null;
    const sameBranch = isBranchContextAligned(branchId);

    if (outcome.accepted) {
      void queryClient.invalidateQueries({
        queryKey: receiptDetailKey(clientId, branchId),
        exact: true,
        refetchType: sameBranch ? "active" : "none",
      });
      if (sameBranch) {
        void queryClient.invalidateQueries({ queryKey: clientQueryKeys.detail(clientId), exact: true });
        void queryClient.invalidateQueries({ queryKey: clientQueryKeys.lists() });
        void queryClient.invalidateQueries({ queryKey: clientQueryKeys.all, exact: true });
        void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        void queryClient.invalidateQueries({ queryKey: ["messages", "logs", "client", clientId] });
      }
    }

    if (activeScope.current !== scope) return;
    if (!sameBranch) {
      setDraft(null);
      return;
    }
    if (outcome.accepted) {
      setDraft(null);
      toast({ variant: "success", title: RECEIPT_SEND_SUCCESS });
    } else {
      setDraft({ ...activeDraft, editedDate: date, isPending: false, error: outcome.message });
    }
  };

  return {
    open,
    dialog: activeDraft ? {
      date,
      canSubmit,
      error: activeDraft.error,
      isPending: activeDraft.isPending,
      editDate,
      dismiss,
      submit,
    } : null,
  };
}
