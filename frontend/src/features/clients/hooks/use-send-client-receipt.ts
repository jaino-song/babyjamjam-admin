"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  isCopaymentReceivedDate,
  RECEIPT_SEND_SUCCESS,
  requestStandaloneReceipt,
} from "@babyjamjam/shared";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";

import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { useToast } from "@/hooks/use-toast";
import { clientKeys } from "@/features/clients/hooks/keys";
import { isBranchContextAligned } from "@/features/system-templates/branch-context";

interface ReceiptDraft {
  scope: { branchId: string | null; clientId: number | null };
  editedDate: string | null;
  error: string | null;
  isPending: boolean;
}

export function useSendClientReceipt(branchId: string | null, clientId: number | null, savedDate?: string | null) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
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
  const canSubmit = Boolean(branchId && clientId && isCopaymentReceivedDate(date));

  const open = () => {
    if (!clientId || !isBranchContextAligned(branchId) || activeScope.current !== scope || activeDraft) return;
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
    if (!activeDraft || activeDraft.isPending || !canSubmit || !branchId || !clientId || !isBranchContextAligned(branchId)
      || activeScope.current !== scope || pendingScope.current === scope) return;

    pendingScope.current = scope;
    setDraft({ ...activeDraft, isPending: true, error: null });

    const outcome = await requestStandaloneReceipt(branchId, clientId, date);
    if (pendingScope.current === scope) pendingScope.current = null;
    const sameBranch = isBranchContextAligned(branchId);

    if (outcome.accepted) {
      const refetchType = sameBranch ? "active" : "none";
      void queryClient.invalidateQueries({ queryKey: clientKeys.detail(clientId, branchId), exact: true, refetchType });
      void queryClient.invalidateQueries({ queryKey: clientKeys.allClients(branchId), exact: true, refetchType });
      if (sameBranch) {
        void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.upcoming() });
        void queryClient.invalidateQueries({ queryKey: messageTriggerKeys.clientHistory(clientId) });
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
