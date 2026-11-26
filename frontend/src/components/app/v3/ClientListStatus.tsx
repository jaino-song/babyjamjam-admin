"use client";

import { ContractInfoMismatchIcon } from "./ContractInfoMismatch";
import { StatusBadge } from "./StatusBadge";
import { isContractInfoMismatchBadge } from "@/lib/client/badges";
import type { ClientBadge } from "@/lib/client/types";

const SOURCE_COMPONENT = "ClientListStatus";

export interface ClientBadgeMarkProps {
  "data-component"?: string;
  badge: ClientBadge;
}

/**
 * One client badge in a list row: the bare warning icon for "정보 불일치",
 * the status pill for everything else.
 */
export function ClientBadgeMark({ "data-component": dataComponent, badge }: ClientBadgeMarkProps) {
  if (isContractInfoMismatchBadge(badge)) {
    return <ContractInfoMismatchIcon data-component={dataComponent} />;
  }

  return <StatusBadge status={badge.status} label={badge.label} />;
}

export interface ClientListStatusProps {
  /** Full-parent base; the overflow count renders as `${base}_more`. */
  "data-component": string;
  /** Badges already in display order (see prioritizeClientBadges). */
  badges: ClientBadge[];
  /** Maps the first badge's label for display (e.g. getClientDisplayLabel). */
  formatLabel?: (label: string) => string;
}

/** The status slot of a client list row: the first badge, then "+N" for the rest. */
export function ClientListStatus({ "data-component": dataComponent, badges, formatLabel }: ClientListStatusProps) {
  const [firstBadge, ...remainingBadges] = badges;
  if (!firstBadge) return null;

  return (
    <div
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className="flex items-center gap-[calc(4px*var(--glint-ui-scale,1))]"
    >
      <ClientBadgeMark
        data-component={`${dataComponent}_first`}
        badge={firstBadge.label && formatLabel ? { ...firstBadge, label: formatLabel(firstBadge.label) } : firstBadge}
      />
      {remainingBadges.length > 0 ? (
        <span
          data-component={`${dataComponent}_more`}
          className="shrink-0 text-[calc(10.4px*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted"
        >
          +{remainingBadges.length}
        </span>
      ) : null}
    </div>
  );
}
