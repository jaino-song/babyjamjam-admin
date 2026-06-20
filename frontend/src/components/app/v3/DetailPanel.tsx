"use client";

import React from "react";
import { ChevronLeft } from "lucide-react";
import { PanelTitleGroup } from "./PanelTitleGroup";
import { useSplitLayoutNavOptional } from "./SplitLayoutContext";
import { useScrollActivity } from "./useScrollActivity";

interface DetailPanelProps {
  /** Fully custom header (escape hatch for centered layouts etc.) */
  header?: React.ReactNode;
  /** Optional avatar element on the left */
  avatar?: React.ReactNode;
  /** Title text or node */
  title?: React.ReactNode;
  /** Subtitle below the title */
  subtitle?: React.ReactNode;
  /** Badges/chips inline with the title */
  badges?: React.ReactNode;
  /** Trailing content on the right side of the header (e.g. Stepper) */
  trailing?: React.ReactNode;
  /** Optional stepper rendered on the right side of the structured header */
  stepper?: React.ReactNode;
  /** Optional action row rendered between header and tabs. */
  headerAction?: React.ReactNode;
  /** Optional back button rendered at the top of the header. Overrides SplitLayout compact back behavior. */
  backAction?: {
    label: React.ReactNode;
    onClick: () => void;
  };
  compactBackLabel?: React.ReactNode;
  tabs?: React.ReactNode;
  overlay?: React.ReactNode;
  emptyState?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function DetailPanel({
  header = null,
  avatar,
  title,
  subtitle,
  badges,
  trailing,
  stepper,
  headerAction,
  backAction,
  compactBackLabel = "목록으로 돌아가기",
  tabs,
  overlay,
  emptyState,
  footer,
  children,
}: DetailPanelProps) {
  const splitLayoutNav = useSplitLayoutNavOptional();
  const { isScrollActive, handleScroll } = useScrollActivity();
  const resolvedOverlay = overlay ?? emptyState;
  const showCompactBackButton = splitLayoutNav?.isMobile ?? false;
  const resolvedBackAction = backAction ?? (
    showCompactBackButton && splitLayoutNav
      ? { label: compactBackLabel, onClick: splitLayoutNav.goToList }
      : null
  );

  const hasStructuredHeader = !!title;
  const hasHeaderTrailing = !!stepper || !!trailing;

  const renderedHeader = hasStructuredHeader ? (
    <div className="flex items-center justify-between gap-[calc(16px*var(--v3-ui-scale,1))]">
      <div className="flex min-w-0 items-center gap-[calc(12px*var(--v3-ui-scale,1))]">
        {avatar}
        <PanelTitleGroup
          component="detail-panel"
          title={title}
          subtitle={subtitle}
          badges={badges}
          className="flex-1"
          subtitleClassName="min-w-0 max-w-full overflow-hidden text-[calc(14px*var(--v3-ui-scale,1))]"
          titleClassName="text-[calc(16px*var(--v3-ui-scale,1))]"
        />
      </div>
      {hasHeaderTrailing ? (
        <div className="flex shrink-0 items-center gap-[calc(8px*var(--v3-ui-scale,1))]">
          {stepper}
          {trailing}
        </div>
      ) : null}
    </div>
  ) : header;

  return (
    <div data-component="detail-panel" className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-white shadow-v3">
      {(resolvedBackAction || renderedHeader) && (
        <header data-component="detail-panel-header" className="px-[calc(24px*var(--v3-ui-scale,1))] py-[calc(20px*var(--v3-ui-scale,1))]">
          {resolvedBackAction && (
            <button
              type="button"
              className="mb-[calc(16px*var(--v3-ui-scale,1))] inline-flex items-center gap-[calc(6px*var(--v3-ui-scale,1))] self-start text-[calc(12px*var(--v3-ui-scale,1))] font-semibold text-v3-text-muted transition-colors hover:text-v3-primary md:mb-[calc(24px*var(--v3-ui-scale,1))] md:text-[calc(12.8px*var(--v3-ui-scale,1))]"
              onClick={resolvedBackAction.onClick}
            >
              <ChevronLeft className="h-[calc(18px*var(--v3-ui-scale,1))] w-[calc(18px*var(--v3-ui-scale,1))] md:h-[calc(20px*var(--v3-ui-scale,1))] md:w-[calc(20px*var(--v3-ui-scale,1))]" aria-hidden="true" />
              {resolvedBackAction.label}
            </button>
          )}
          {renderedHeader}
        </header>
      )}
      {headerAction && <div className="px-[calc(24px*var(--v3-ui-scale,1))] pb-[calc(24px*var(--v3-ui-scale,1))]">{headerAction}</div>}
      {tabs && <div className="px-[calc(24px*var(--v3-ui-scale,1))]">{tabs}</div>}
      {resolvedOverlay ? (
        <div
          data-component="detail-panel-overlay"
          className="pointer-events-none absolute inset-0 z-10 flex -translate-y-[calc(12px*var(--v3-ui-scale,1))] items-center justify-center p-[calc(24px*var(--v3-ui-scale,1))]"
        >
          {resolvedOverlay}
        </div>
      ) : null}
      <main data-component="detail-panel-main" className="relative flex min-h-0 flex-1 flex-col">
        <div
          data-component="detail-panel-scroll-content"
          className="scrollbar-on-scroll flex min-h-0 flex-1 flex-col overflow-y-auto p-[calc(24px*var(--v3-ui-scale,1))]"
          data-scroll-active={isScrollActive ? "true" : "false"}
          onScroll={handleScroll}
        >
          {children}
        </div>
        <div
          data-component="detail-panel-bottom-spacer"
          className="h-[calc(24px*var(--v3-ui-scale,1))] shrink-0 bg-white"
        />
      </main>
      {footer ? (
        <footer data-component="detail-panel-footer" className="shrink-0">
          {footer}
        </footer>
      ) : null}
    </div>
  );
}
