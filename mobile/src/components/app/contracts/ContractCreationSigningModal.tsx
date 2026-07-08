"use client";

import { X } from "lucide-react";

import { Block, HeaderActionButton } from "@/components/app/v3";

interface ContractCreationSigningModalProps {
  open: boolean;
  onClose: () => void;
}

export function ContractCreationSigningModal({ open, onClose }: ContractCreationSigningModalProps) {
  if (!open) return null;

  return (
    <Block
      name="contracts-new-signing-modal"
      className="fixed inset-0 z-[200] flex flex-col bg-v3-dim-white"
    >
      <Block
        name="contracts-new-signing-header"
        className="flex h-14 items-center justify-between border-b border-v3-border bg-white px-3.5"
      >
        <span className="text-base font-bold text-v3-dark">계약서 서명</span>
        <HeaderActionButton
          icon={X}
          label="닫기"
          onClick={onClose}
          variant="muted"
          data-component="contracts-new-signing-close"
        />
      </Block>
      <iframe
        id="eformsign_iframe"
        data-component="contracts-new-signing-iframe"
        className="min-h-0 flex-1 border-0 bg-white"
        title="eformsign"
      />
    </Block>
  );
}
