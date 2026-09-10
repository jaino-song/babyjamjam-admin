"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import type { EformsignDocClientSummary, EformsignDocument } from "@babyjamjam/shared/types/eformsign";

import { useToast } from "@/hooks/use-toast";
import { contractCandidateToClientPrefill } from "@/lib/client/contract-client-prefill";
import { eformsignApi } from "@/services/api";
import { useClientDialogStore } from "@/stores/client-dialog-store";

/**
 * Opens the client registration wizard from a contract detail action.
 * Existing client links bypass the candidate request and go straight to edit.
 */
export function useContractClientRegistration() {
  const router = useRouter();
  const { toast } = useToast();
  const setPrefillClient = useClientDialogStore((state) => state.setPrefillClient);
  const clearPrefillName = useClientDialogStore((state) => state.clearPrefillName);
  const clearPrefillClient = useClientDialogStore((state) => state.clearPrefillClient);
  const [isClientRegistrationPending, setIsClientRegistrationPending] = useState(false);
  const inFlightRef = useRef(false);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const clearRegistrationPrefill = useCallback(() => {
    clearPrefillName();
    clearPrefillClient();
  }, [clearPrefillClient, clearPrefillName]);

  const handleOpenClientFromContract = useCallback(async (
    doc: EformsignDocument,
    metadata?: EformsignDocClientSummary,
  ): Promise<void> => {
    if (!isMountedRef.current) return;

    // An existing local client is authoritative. Invalidate any in-flight
    // create request before navigating so a late candidate response cannot
    // redirect back to a stale registration form.
    if (metadata?.clientId != null) {
      requestIdRef.current += 1;
      inFlightRef.current = false;
      clearRegistrationPrefill();
      setIsClientRegistrationPending(false);
      router.push(`/clients/new?clientId=${metadata.clientId}`);
      return;
    }

    if (inFlightRef.current) return;

    inFlightRef.current = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsClientRegistrationPending(true);
    clearRegistrationPrefill();

    try {
      const candidate = await eformsignApi.getDocumentClientCandidate(doc.id);
      if (!isMountedRef.current || requestIdRef.current !== requestId) return;

      setPrefillClient(contractCandidateToClientPrefill(candidate));
      router.push("/clients/new");
    } catch {
      if (!isMountedRef.current || requestIdRef.current !== requestId) return;

      clearRegistrationPrefill();
      toast({
        variant: "destructive",
        title: "계약 정보를 불러오지 못했어요",
        description: "고객 정보를 직접 입력해 주세요",
      });
      router.push("/clients/new");
    } finally {
      if (requestIdRef.current === requestId) {
        inFlightRef.current = false;
        if (isMountedRef.current) setIsClientRegistrationPending(false);
      }
    }
  }, [clearRegistrationPrefill, router, setPrefillClient, toast]);

  return {
    handleOpenClientFromContract,
    isClientRegistrationPending,
  };
}
