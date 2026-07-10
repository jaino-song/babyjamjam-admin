"use client";

import { useState, type ComponentProps } from "react";

import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Client } from "@/lib/client/types";

type ContractClientSelectorProps = Omit<
  ComponentProps<typeof ClientAutocomplete>,
  "onChange"
> & {
  onChange: (clientId: number | null, client: Client | null) => void;
};

interface PendingClientSelection {
  clientId: number;
  client: Client;
}

export function hasExistingContractDocument(client: Client): boolean {
  return Boolean(client.eDocId || client.documentStatus);
}

export function ContractClientSelector({
  onChange,
  ...autocompleteProps
}: ContractClientSelectorProps) {
  const [pendingSelection, setPendingSelection] =
    useState<PendingClientSelection | null>(null);

  const handleChange = (clientId: number | null, client: Client | null) => {
    if (clientId !== null && client && hasExistingContractDocument(client)) {
      setPendingSelection({ clientId, client });
      return;
    }

    onChange(clientId, client);
  };

  const handleContinue = () => {
    if (!pendingSelection) return;

    const selection = pendingSelection;
    setPendingSelection(null);
    onChange(selection.clientId, selection.client);
  };

  return (
    <>
      <ClientAutocomplete {...autocompleteProps} onChange={handleChange} />

      <Dialog
        open={pendingSelection !== null}
        onOpenChange={(open) => {
          if (!open) setPendingSelection(null);
        }}
      >
        <DialogContent
          data-component="contract-existing-document-confirmation"
          className="flex aspect-[5/3] flex-col sm:max-w-[300px]"
        >
          <DialogHeader className="flex-1 justify-center pb-0 text-center sm:text-center">
            <DialogTitle
              aria-label="이미 계약서를 전송한 기록이 있습니다. 새로 생성하시겠어요?"
              className="text-[calc(14px*var(--v3-ui-scale,1))] leading-5"
            >
              <span className="block">이미 계약서를 전송한 기록이 있습니다.</span>
              <span className="block">새로 생성하시겠어요?</span>
            </DialogTitle>
            <DialogDescription className="sr-only">
              계속하면 선택한 고객 정보로 새 계약서 작성을 진행합니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-row pt-0 sm:justify-stretch">
            <Button
              type="button"
              variant="neutral"
              className="w-1/2"
              onClick={() => setPendingSelection(null)}
            >
              취소
            </Button>
            <Button type="button" className="w-1/2" onClick={handleContinue}>
              계속
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
