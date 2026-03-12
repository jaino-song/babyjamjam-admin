"use client";

import { memo } from "react";
import { Calendar, CircleCheck, FileSignature } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, type StatusType } from "@/components/app/v3";
import { cn } from "@/lib/utils";
import { getStatusCategory, mapStatusToLabel } from "@/lib/eformsign/status-codes";
import type { EformsignDocument } from "@/lib/eformsign/types";

interface ContractsListItemProps {
  document: EformsignDocument | null;
  customerName: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
}

function mapCategoryToStatusType(
  category: "completed" | "rejected" | "in-progress"
): StatusType {
  switch (category) {
    case "completed":
      return "signed";
    case "rejected":
      return "expired";
    default:
      return "pending";
  }
}

function formatDate(timestamp: number): string {
  return new Date(timestamp)
    .toLocaleDateString("ko-KR", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    })
    .replace(/\.$/, "");
}

function ContractsListItemComponent({
  document,
  customerName,
  isLoading,
  isRefreshing,
}: ContractsListItemProps) {
  if (isLoading || isRefreshing || !document) {
    return (
      <>
        <div
          data-component="contracts-list-item-skeleton-icon"
          className="w-11 h-11 rounded-[14px] shrink-0 shadow-md bg-v3-dim-white flex items-center justify-center"
        >
          <Skeleton className="w-5 h-5 rounded-md bg-white/70" />
        </div>
        <div
          data-component="contracts-list-item-skeleton-content"
          className="flex-1 min-w-0"
        >
          <Skeleton className="h-4 w-24 mb-1.5 bg-v3-dim-white" />
          <Skeleton className="h-3 w-40 mb-2 bg-v3-dim-white" />
          <Skeleton className="h-3 w-52 bg-v3-dim-white" />
        </div>
        <Skeleton className="h-6 w-14 rounded-full bg-v3-dim-white shrink-0" />
      </>
    );
  }

  const category = getStatusCategory(document.current_status?.status_type);
  const statusType = mapCategoryToStatusType(category);
  const statusLabel = mapStatusToLabel(document.current_status?.status_type);
  const sentDate = formatDate(document.created_date);
  const signedDate =
    category === "completed" ? formatDate(document.updated_date) : null;

  return (
    <>
      <div
        data-component="contracts-list-item-icon"
        className={cn(
          "w-11 h-11 rounded-[14px] flex items-center justify-center shrink-0 shadow-md",
          category === "completed"
            ? "bg-v3-green-light"
            : category === "rejected"
              ? "bg-v3-burgundy-light"
              : "bg-v3-orange-light"
        )}
      >
        <FileSignature
          className={cn(
            "w-5 h-5",
            category === "completed"
              ? "text-v3-green"
              : category === "rejected"
                ? "text-v3-burgundy"
                : "text-v3-orange"
          )}
        />
      </div>

      <div data-component="contracts-list-item-content" className="flex-1 min-w-0">
        <div
          data-component="contracts-list-item-title-row"
          className="flex items-center gap-2 mb-0.5"
        >
          <span className="font-bold text-[0.85rem] text-v3-dark truncate">
            {customerName}
          </span>
        </div>
        <div
          data-component="contracts-list-item-subtitle"
          className="flex items-center gap-2 text-[0.7rem] text-v3-text-muted truncate"
        >
          {document.document_name}
        </div>
        <div
          data-component="contracts-list-item-meta"
          className="mt-1.5 flex items-center gap-3 overflow-hidden whitespace-nowrap text-[0.65rem] leading-none text-v3-text-muted"
        >
          <span className="flex min-w-0 items-center gap-1 shrink-0">
            <Calendar className="h-3 w-3 shrink-0" />
            발송 {sentDate}
          </span>
          {signedDate && (
            <span className="flex min-w-0 items-center gap-1 shrink-0">
              <CircleCheck className="h-3 w-3 shrink-0" />
              완료 {signedDate}
            </span>
          )}
        </div>
      </div>

      <div data-component="contracts-list-item-status" className="shrink-0">
        <StatusBadge status={statusType} label={statusLabel} />
      </div>
    </>
  );
}

export const ContractsListItem = memo(
  ContractsListItemComponent,
  (previousProps, nextProps) =>
    previousProps.document === nextProps.document &&
    previousProps.customerName === nextProps.customerName &&
    previousProps.isLoading === nextProps.isLoading &&
    previousProps.isRefreshing === nextProps.isRefreshing
);
