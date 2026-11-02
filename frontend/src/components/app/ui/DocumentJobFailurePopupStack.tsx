"use client";

import {
  DocumentJobFailurePopup,
  type DocumentJobFailurePopupProps,
} from "@/components/app/ui/DocumentJobFailurePopup";
import { useToasterClearance } from "@/components/app/ui/useToasterClearance";

export interface DocumentJobFailurePopupStackItem
  extends Omit<DocumentJobFailurePopupProps, "data-component"> {
  key: string;
}

export interface DocumentJobFailurePopupStackProps {
  items: readonly DocumentJobFailurePopupStackItem[];
  /** The collapse notice for popups beyond the visible limit; omitted when nothing is hidden. */
  overflow?: Omit<DocumentJobFailurePopupProps, "data-component"> | null;
  "data-component": string;
}

/**
 * Bottom-right region for failure popups, on any page. Its bottom offset follows the
 * measured height of the shared Toaster (plus an 8px gap), never below a floor that
 * clears the floating bottom navigation on phones, so none of the three overlap.
 */
export function DocumentJobFailurePopupStack({
  items,
  overflow,
  "data-component": dataComponent,
}: DocumentJobFailurePopupStackProps) {
  const visible = items.length > 0 || Boolean(overflow);
  const bottom = useToasterClearance(visible);

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="전자문서 처리 실패 알림"
      data-component={dataComponent}
      data-slot="document-job-failure-popup-stack"
      style={{ bottom }}
      className="pointer-events-none fixed inset-x-4 z-[1000] flex flex-col gap-2 md:inset-x-auto md:right-6 md:w-[380px]"
    >
      {items.map(({ key, ...popup }, index) => (
        <DocumentJobFailurePopup
          key={key}
          {...popup}
          data-component={`${dataComponent}_item-${index}`}
        />
      ))}
      {overflow ? (
        <DocumentJobFailurePopup {...overflow} data-component={`${dataComponent}_overflow`} />
      ) : null}
    </div>
  );
}
