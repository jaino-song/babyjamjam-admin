"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { Search, X } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export type AvatarTone = "primary" | "green" | "burgundy" | "orange" | "purple" | "muted";
export type InfoTone = "green" | "burgundy" | "muted" | "primary" | "orange";
export type DocRowTone = "green" | "muted" | "primary" | "burgundy" | "orange";
export type BadgeTone = DocRowTone | "kakao" | "purple";
export type DetailTab = { id: string; label: string };
export type DetailHeaderBadge = {
  label: ReactNode;
  tone: BadgeTone;
  dataComponent?: string;
  className?: string;
};
export type DetailAction = {
  label: ReactNode;
  variant?: "primary" | "secondary";
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  ariaLabel?: string;
  dataComponent?: string;
  className?: string;
};

export function MobileDetailStack({
  name,
  isOpen,
  onClose,
  list,
  children,
  sectionDataComponent,
  sectionClassName,
  sectionStyle,
  sectionAriaHidden,
  stackDataComponent,
  stackClassName,
  listDataComponent,
  listClassName,
  scrimDataComponent,
  scrimClassName,
  scrimDisabled,
  detailDataComponent,
  detailClassName,
  detailRole,
  detailAriaModal,
  detailAriaLabelledBy,
  detailAriaDescribedBy,
  sheetHeaderDataComponent,
  sheetHeaderClassName,
  closeLabel = "상세 닫기",
  closeDisabled,
}: {
  name: string;
  isOpen: boolean;
  onClose: () => void;
  list: ReactNode;
  children: ReactNode;
  sectionDataComponent?: string;
  sectionClassName?: string;
  sectionStyle?: CSSProperties;
  sectionAriaHidden?: boolean;
  stackDataComponent?: string;
  stackClassName?: string;
  listDataComponent?: string;
  listClassName?: string;
  scrimDataComponent?: string;
  scrimClassName?: string;
  scrimDisabled?: boolean;
  detailDataComponent?: string;
  detailClassName?: string;
  detailRole?: "dialog" | "region";
  detailAriaModal?: boolean;
  detailAriaLabelledBy?: string;
  detailAriaDescribedBy?: string;
  sheetHeaderDataComponent?: string;
  sheetHeaderClassName?: string;
  closeLabel?: string;
  closeDisabled?: boolean;
}) {
  return (
    <section
      data-component={sectionDataComponent ?? name}
      className={sectionClassName}
      style={sectionStyle}
      aria-hidden={sectionAriaHidden}
    >
      <div
        className={cn("nav-stack", isOpen && "show-detail", stackClassName)}
        data-component={stackDataComponent ?? `mobile-${name}-stack`}
      >
        <div
          className={cn("nav-page list", listClassName)}
          data-component={listDataComponent ?? `mobile-${name}-list-page`}
          aria-hidden={list == null}
        >
          {list}
        </div>
        <button
          type="button"
          aria-label={closeLabel}
          className={cn("scrim", scrimClassName)}
          data-component={scrimDataComponent ?? `mobile-${name}-detail-scrim`}
          onClick={onClose}
          disabled={scrimDisabled}
        />
        <div
          className={cn("nav-page detail", detailClassName)}
          data-component={detailDataComponent ?? `mobile-${name}-detail-page`}
          role={detailRole}
          aria-modal={detailAriaModal}
          aria-labelledby={detailAriaLabelledBy}
          aria-describedby={detailAriaDescribedBy}
          aria-hidden={!isOpen}
        >
          <div className="sheet-handle" />
          <div className={cn("sheet-header", sheetHeaderClassName)} data-component={sheetHeaderDataComponent}>
            <button
              type="button"
              className="sheet-close"
              aria-label={closeLabel}
              onClick={onClose}
              disabled={closeDisabled}
              style={{ marginLeft: "auto" }}
            >
              <X aria-hidden="true" size={22} strokeWidth={2.5} />
            </button>
          </div>
          {children}
        </div>
      </div>
    </section>
  );
}

export function MobileDetailSheet({
  name,
  isOpen,
  onClose,
  list,
  detail,
}: {
  name: string;
  isOpen: boolean;
  onClose: () => void;
  list: ReactNode;
  detail: ReactNode;
}) {
  return (
    <MobileDetailStack
      name={name}
      isOpen={isOpen}
      onClose={onClose}
      list={list}
      sectionClassName="mobile-detail-sheet relative flex flex-col flex-1 min-h-0 overflow-hidden -mx-4 -mb-24"
      sectionStyle={{ minHeight: "var(--mobile-detail-sheet-min-height, calc(100dvh - 80px))" }}
    >
      {detail}
    </MobileDetailStack>
  );
}

export function MobileDetailPage({
  name,
  children,
  className,
  dataComponent,
  style,
}: {
  name: string;
  children: ReactNode;
  className?: string;
  dataComponent?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      className={cn("detail-body detail-column", className)}
      data-component={dataComponent ?? `mobile-${name}-detail`}
      style={style}
    >
      {children}
    </div>
  );
}

export function MobileDetailHeader({
  name,
  avatar,
  avatarTone = "primary",
  avatarClassName,
  title,
  titleClassName,
  titleStyle,
  badges,
  menu,
  className,
}: {
  name: string;
  avatar: ReactNode;
  avatarTone?: AvatarTone;
  avatarClassName?: string;
  title: ReactNode;
  titleClassName?: string;
  titleStyle?: CSSProperties;
  badges?: DetailHeaderBadge[];
  menu?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("client-detail-header pop-up", className)} data-component={`mobile-${name}-detail-header`}>
      <div
        className={cn("client-detail-avatar-lg", `av-${avatarTone}`, avatarClassName)}
        data-component={`mobile-${name}-detail-avatar`}
      >
        {avatar}
      </div>
      <div className="client-detail-title" data-component={`mobile-${name}-detail-title`}>
        <div
          className={cn("client-detail-name", titleClassName)}
          data-component={`mobile-${name}-detail-name`}
          style={titleStyle}
        >
          {title}
        </div>
        {badges && badges.length > 0 ? (
          <div className="client-detail-badges" data-component={`mobile-${name}-detail-badges`}>
            {badges.map((badge, index) => (
              <span
                key={`${badge.tone}-${index}`}
                className={cn("badge-mini", badge.tone, badge.className)}
                data-component={badge.dataComponent}
              >
                {badge.label}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      {menu}
    </div>
  );
}

export function MobileDetailActions({
  name,
  actions,
  children,
  className,
}: {
  name: string;
  actions?: DetailAction[];
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("detail-actions", className)} data-component={`mobile-${name}-detail-actions`}>
      {actions?.map((action, index) => {
        const actionClassName = cn("btn", `btn-${action.variant ?? "secondary"}`, action.className);
        const key = action.dataComponent ?? `${name}-action-${index}`;
        const isDisabled = action.disabled ?? (!action.href && !action.onClick);

        if (action.href) {
          return (
            <Link
              key={key}
              href={action.href}
              className={actionClassName}
              aria-label={action.ariaLabel}
              data-component={action.dataComponent}
            >
              {action.label}
            </Link>
          );
        }

        return (
          <button
            key={key}
            className={actionClassName}
            type="button"
            onClick={action.onClick}
            disabled={isDisabled}
            aria-busy={action.busy}
            aria-label={action.ariaLabel}
            data-component={action.dataComponent}
          >
            {action.label}
          </button>
        );
      })}
      {children}
    </div>
  );
}

export function MobileDetailTabPanel({
  name,
  tabId,
  activeTab,
  children,
  dataComponent,
  className,
}: {
  name: string;
  tabId: string;
  activeTab: string;
  children: ReactNode;
  dataComponent?: string;
  className?: string;
}) {
  return (
    <div
      className={cn("tab-content", activeTab === tabId && "active", className)}
      data-tab-content={tabId}
      data-component={dataComponent ?? `mobile-${name}-${tabId}-tab`}
    >
      {children}
    </div>
  );
}

export function InfoCard({
  title,
  children,
  delay,
  padded = false,
}: {
  title: string;
  children: ReactNode;
  delay?: number;
  padded?: boolean;
}) {
  return (
    <div
      className={cn("info-card pop-up", padded && "info-card-padded")}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      <div className="info-card-title">{title}</div>
      {children}
    </div>
  );
}

export function InfoRow({
  label,
  value,
  tone,
}: {
  label?: string;
  value: ReactNode;
  tone?: InfoTone;
}) {
  return (
    <div className={cn("info-row", !label && "info-row-no-label")}>
      {label ? <span className="info-row-label">{label}</span> : null}
      <span className={cn("info-row-value", tone && `info-row-value-${tone}`)}>{value}</span>
    </div>
  );
}

export function Avatar({
  initial,
  tone,
  large = false,
}: {
  initial: string;
  tone: AvatarTone;
  large?: boolean;
}) {
  return <div className={cn(large ? "client-detail-avatar-lg" : "list-avatar", `av-${tone}`)}>{initial}</div>;
}

export function DetailTabPills({
  tabs,
  activeTab,
  onTabChange,
}: {
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  const tabsRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const updateIndicatorBounds = useCallback(() => {
    const indicator = indicatorRef.current;
    const activeButton = buttonRefs.current[activeTab];
    if (!indicator || !activeButton) {
      indicator?.style.setProperty("opacity", "0");
      return;
    }

    indicator.style.setProperty("--detail-tab-indicator-x", `${activeButton.offsetLeft}px`);
    indicator.style.setProperty("--detail-tab-indicator-width", `${activeButton.offsetWidth}px`);
    indicator.style.setProperty("opacity", "1");
  }, [activeTab]);

  useLayoutEffect(() => {
    updateIndicatorBounds();

    const tabsElement = tabsRef.current;
    const activeButton = buttonRefs.current[activeTab];
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateIndicatorBounds);

    if (tabsElement) resizeObserver?.observe(tabsElement);
    if (activeButton) resizeObserver?.observe(activeButton);

    window.addEventListener("resize", updateIndicatorBounds);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updateIndicatorBounds);
    };
  }, [activeTab, tabs.length, updateIndicatorBounds]);

  const handleTabClick = (event: MouseEvent<HTMLButtonElement>, tabId: string) => {
    if (tabId === activeTab) return;

    const scrollContainer = event.currentTarget.closest(".detail-body");
    if (scrollContainer instanceof HTMLElement && scrollContainer.scrollTop > 0) {
      scrollContainer.scrollTop = 0;
      window.requestAnimationFrame(() => onTabChange(tabId));
      return;
    }

    onTabChange(tabId);
  };

  return (
    <div ref={tabsRef} className="filter-row detail-tabs" data-component="mobile-redesign-detail-tabs">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            ref={(button) => {
              buttonRefs.current[tab.id] = button;
            }}
            className={cn("filter-pill", isActive && "active")}
            data-tab={tab.id}
            aria-pressed={isActive}
            onClick={(event) => handleTabClick(event, tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
      <span
        ref={indicatorRef}
        className="detail-tabs-indicator"
        data-component="mobile-redesign-detail-tabs-indicator"
      />
    </div>
  );
}

export function DocRow({
  initial,
  title,
  meta,
  badge,
  tone,
}: {
  initial: string;
  title: string;
  meta: string;
  badge: string;
  tone: DocRowTone;
}) {
  const iconToneClass: Record<DocRowTone, string> = {
    green: "bg-v3-green-light text-v3-green",
    primary: "bg-v3-primary-light text-v3-primary",
    burgundy: "bg-v3-burgundy-light text-v3-burgundy",
    orange: "bg-v3-orange-light text-v3-orange",
    muted: "bg-v3-dim-white text-v3-text-muted",
  };
  return (
    <div className="doc-row">
      <div className={cn("doc-icon", iconToneClass[tone])}>{initial}</div>
      <div className="doc-info">
        <div className="doc-title">{title}</div>
        <div className="doc-meta">{meta}</div>
      </div>
      <span className={cn("badge-mini", tone)}>{badge}</span>
    </div>
  );
}

export function MobileSearchBar({
  placeholder,
  label,
  value,
  onChange,
}: {
  placeholder: string;
  label: string;
  value?: string;
  onChange?: (value: string) => void;
}) {
  return (
    <div className="search-bar" data-component={`mobile-${label}-search`}>
      <Search size={14} strokeWidth={2.5} />
      <input
        name={`${label}Search`}
        autoComplete="off"
        aria-label={placeholder}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}
