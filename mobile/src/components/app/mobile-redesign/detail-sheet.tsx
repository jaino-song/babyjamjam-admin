"use client";

import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type AvatarTone = "primary" | "green" | "burgundy" | "orange" | "purple";
export type InfoTone = "green" | "burgundy" | "muted" | "primary";
export type DocRowTone = "green" | "muted" | "primary" | "burgundy" | "orange";
export type DetailTab = { id: string; label: string };

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
    <section
      data-component={name}
      className="relative flex flex-col flex-1 min-h-0 overflow-hidden -mx-4 -mb-24"
      style={{ minHeight: "calc(100dvh - 80px)" }}
    >
      <div className={cn("nav-stack", isOpen && "show-detail")} data-component={`mobile-${name}-stack`}>
        <div className="nav-page list" data-component={`mobile-${name}-list-page`}>
          {list}
        </div>
        <button
          type="button"
          aria-label="상세 닫기"
          className="scrim"
          data-component={`mobile-${name}-detail-scrim`}
          onClick={onClose}
        />
        <div className="nav-page detail" data-component={`mobile-${name}-detail-page`} aria-hidden={!isOpen}>
          <div className="sheet-handle" />
          <div className="sheet-header">
            <button
              type="button"
              className="sheet-close"
              aria-label="상세 닫기"
              onClick={onClose}
              style={{ marginLeft: "auto" }}
            >
              <X size={22} strokeWidth={2.5} />
            </button>
          </div>
          {detail}
        </div>
      </div>
    </section>
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
  label: string;
  value: ReactNode;
  tone?: InfoTone;
}) {
  return (
    <div className="info-row">
      <span className="info-row-label">{label}</span>
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
  return (
    <div className="filter-row detail-tabs" data-component="mobile-redesign-detail-tabs">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={cn("filter-pill", activeTab === tab.id && "active")}
          data-tab={tab.id}
          aria-pressed={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.label}
        </button>
      ))}
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
        aria-label={placeholder}
        placeholder={placeholder}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
      />
    </div>
  );
}
