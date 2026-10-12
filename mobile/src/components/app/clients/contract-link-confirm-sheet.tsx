"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Button } from "@/components/ui/button";
import { clientQueryKeys, useUpdateClient } from "@/hooks/useClients";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { eformsignApi, type EformsignLinkConfirmation } from "@/services/api";
import { buildContractLinkUpdate, canConfirmContractLink, contractLinkRows, type ContractLinkChoices } from "./contract-link-confirm";

interface ContractLinkConfirmSheetProps {
  "data-component": string;
  entry: EformsignLinkConfirmation;
  onClose: () => void;
  onConfirmed?: () => void;
  refetchConfirmations: () => Promise<{ data?: EformsignLinkConfirmation[]; isError?: boolean }>;
}

export function ContractLinkConfirmSheet({ "data-component": dataComponent, entry, onClose, onConfirmed, refetchConfirmations }: ContractLinkConfirmSheetProps) {
  const queryClient = useQueryClient();
  const updateClient = useUpdateClient();
  const [choices, setChoices] = useState<ContractLinkChoices>({});
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const clientUpdated = useRef(false);
  const clientId = entry.client.id;

  const succeed = () => {
    void queryClient.invalidateQueries({ queryKey: clientQueryKeys.all });
    void queryClient.invalidateQueries({ queryKey: clientQueryKeys.detail(clientId) });
    void queryClient.invalidateQueries({ queryKey: ["eformsign-docs", "document"] });
    void queryClient.invalidateQueries({ queryKey: ["eformsign-docs", "link-confirmations", clientId] });
    onConfirmed?.();
    onClose();
  };

  const confirm = async () => {
    if (inFlight.current || !canConfirmContractLink(entry, choices)) return;
    inFlight.current = true;
    setIsPending(true);
    setError(null);
    try {
      const dto = buildContractLinkUpdate(entry, choices);
      if (!clientUpdated.current && Object.keys(dto).length > 0) {
        try {
          await updateClient.mutateAsync({ id: clientId, dto });
          clientUpdated.current = true;
        } catch {
          setError("고객 정보를 수정하지 못했습니다. 다시 시도해 주세요.");
          return;
        }
      }
      try {
        await eformsignApi.adoptDocument(entry.documentId, clientId);
        succeed();
      } catch {
        // 고객 수정이 자동 연결을 완료했을 수 있으므로 서버 상태를 먼저 확인한다.
        try {
          const refreshed = await refetchConfirmations();
          if (!refreshed.isError && refreshed.data && !refreshed.data.some(item => item.documentId === entry.documentId)) {
            succeed();
            return;
          }
        } catch { /* A failed reconciliation is not evidence of successful linking. */ }
        setError(clientUpdated.current
          ? "고객 정보는 수정했지만 계약서를 연결하지 못했습니다. 다시 시도해 주세요."
          : "계약서를 연결하지 못했습니다. 다시 시도해 주세요.");
      }
    } finally {
      inFlight.current = false;
      setIsPending(false);
    }
  };

  return (
    <Dialog open onOpenChange={open => { if (!open && !inFlight.current) onClose(); }}>
      <DialogContent data-component={dataComponent} showCloseButton={false}
        onEscapeKeyDown={event => { if (inFlight.current) event.preventDefault(); }}
        onInteractOutside={event => { if (inFlight.current) event.preventDefault(); }}>
        <DialogHeader data-component={`${dataComponent}_header`}>
          <DialogTitle data-component={`${dataComponent}_header_title`}>계약서 연결 확인</DialogTitle>
          <DialogDescription data-component={`${dataComponent}_header_description`}>전화번호는 같지만 아래 내용이 달라 자동으로 연결하지 않았습니다. 항목마다 맞는 값을 고른 뒤 확정하세요.</DialogDescription>
        </DialogHeader>
        <p data-component={`${dataComponent}_phone`}>전화번호: {formatKoreanPhoneNumber(entry.document.phone)}</p>
        {contractLinkRows(entry).map(row => (
          <fieldset key={row.field} disabled={isPending || clientUpdated.current} data-component={`${dataComponent}_${row.field}`} className="space-y-2">
            <legend>{row.label}</legend>
            {row.needsChoice ? (
              <RadioGroup aria-label={row.label} value={choices[row.field] ?? ""} disabled={isPending || clientUpdated.current}
                onValueChange={value => setChoices(current => ({ ...current, [row.field]: value }))} data-component={`${dataComponent}_${row.field}_choices`}>
                {(["document", "client"] as const).map(side => {
                  const value = side === "document" ? row.documentValue : row.clientValue;
                  const id = `${dataComponent}-${row.field}-${side}`;
                  return <label key={side} htmlFor={id} className="flex min-h-11 items-center gap-2" data-component={`${dataComponent}_${row.field}_choices_${side}`}>
                    <RadioGroupItem id={id} value={side} disabled={!value || isPending || clientUpdated.current} data-component={`${dataComponent}_${row.field}_choices_${side}_radio`} />
                    {side === "document" ? "계약서" : "고객 정보"}: {value ?? "없음"}
                  </label>;
                })}
              </RadioGroup>
            ) : <p>양쪽 모두 정보가 없습니다</p>}
          </fieldset>
        ))}
        <p data-component={`${dataComponent}_guidance`}>{"'계약서' 값을 고르면 고객 정보가 그 값으로 수정됩니다."}</p>
        {error && <p role="alert" data-component={`${dataComponent}_error`}>{error}</p>}
        <DialogFooter data-component={`${dataComponent}_footer`}>
          <Button variant="v3-outline" disabled={isPending} onClick={onClose} data-component={`${dataComponent}_footer_cancel`}>취소</Button>
          <Button variant="v3" disabled={isPending || !canConfirmContractLink(entry, choices)} onClick={() => { void confirm(); }} data-component={`${dataComponent}_footer_confirm`}>확정</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
