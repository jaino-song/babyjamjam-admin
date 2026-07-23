"use client";

import { CheckCircle2, Eye } from "lucide-react";

import { Button } from "@/components/ui/button";

export type ContractReviewAction = "finalize" | "preview";

interface ContractReviewActionButtonProps {
  action: ContractReviewAction;
  onFinalize: () => void;
  onPreview: () => void;
}

export function ContractReviewActionButton({
  action,
  onFinalize,
  onPreview,
}: ContractReviewActionButtonProps) {
  const opensPreview = action === "preview";

  return (
    <Button
      variant="positive"
      size="sm"
      data-component="contracts-detail-finalize-trigger"
      data-review-action={action}
      className="w-[calc(176px*var(--glint-ui-scale,1))]"
      onClick={opensPreview ? onPreview : onFinalize}
    >
      {opensPreview ? (
        <Eye className="h-4 w-4" />
      ) : (
        <CheckCircle2 className="h-4 w-4" />
      )}
      검토하기
    </Button>
  );
}
