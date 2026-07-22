import Link from "next/link";
import type { ReactNode } from "react";
import { Plus } from "lucide-react";

export interface ListCardHeaderProps {
  title: string;
  count?: ReactNode;
  actionLabel?: string;
  actionHref?: string;
  actionIcon?: ReactNode;
  actionType?: "button" | "submit";
  actionDisabled?: boolean;
  onActionClick?: () => void;
}

export function ListCardHeader({
  title,
  count,
  actionLabel,
  actionHref,
  actionIcon,
  actionType = "button",
  actionDisabled = false,
  onActionClick,
}: ListCardHeaderProps) {
  const resolvedActionIcon = actionIcon !== undefined
    ? actionIcon
    : actionLabel?.startsWith("+")
      ? null
      : <Plus size={12} strokeWidth={3} />;
  const action = actionLabel ? (
    actionHref ? (
      <Link href={actionHref} className="list-action" data-component="mobile-redesign-list-action">
        {resolvedActionIcon}
        {actionLabel}
      </Link>
    ) : (
      <button
        type={actionType}
        disabled={actionDisabled}
        className="list-action"
        data-component="mobile-redesign-list-action"
        onClick={onActionClick}
      >
        {resolvedActionIcon}
        {actionLabel}
      </button>
    )
  ) : null;

  return (
    <div className="list-title" data-component="mobile-redesign-list-title">
      <span className="list-title-text">
        {title}
        {count && <span className="list-count">{count}</span>}
      </span>
      {action}
    </div>
  );
}
