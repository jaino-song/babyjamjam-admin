"use client";

import { useState } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, FileCheck2, Plus } from "lucide-react";

import type { ContractRow, ListRow, MenuGroup, SectionRows } from "./mockup-data";

const avatarToneClass: Record<NonNullable<ListRow["avatarTone"]>, string> = {
  primary: "bg-v3-primary",
  green: "bg-v3-green",
  burgundy: "bg-v3-burgundy",
  orange: "bg-v3-orange",
  purple: "bg-v3-purple",
};

const badgeToneClass = {
  primary: "badge-primary",
  green: "badge-green",
  burgundy: "badge-burgundy",
  orange: "badge-orange",
  muted: "badge-muted",
};

const iconToneClass: Record<ContractRow["iconTone"], string> = {
  primary: "bg-v3-primary-light text-v3-primary",
  green: "bg-v3-green-light text-v3-green",
  muted: "bg-v3-dim-white text-v3-text-muted",
};

const menuToneClass: Record<MenuGroup["rows"][number]["tone"], string> = {
  primary: "bg-v3-primary-light",
  green: "bg-v3-green-light",
  burgundy: "bg-v3-burgundy-light",
  orange: "bg-v3-orange-light",
  purple: "bg-v3-purple-light",
  muted: "bg-v3-dim-white",
  gold: "bg-[hsl(50,100%,88%)]",
};

const menuIconStroke: Record<MenuGroup["rows"][number]["tone"], string> = {
  primary: "hsl(214,100%,34%)",
  green: "hsl(137,34%,31%)",
  burgundy: "hsl(355,36%,45%)",
  orange: "hsl(34,100%,55%)",
  purple: "hsl(267,50%,46%)",
  muted: "hsl(214,25%,28%)",
  gold: "hsl(45,70%,30%)",
};

export function Badge({ label, tone }: { label: string; tone: keyof typeof badgeToneClass }) {
  return <span className={`badge ${badgeToneClass[tone]}`}>{label}</span>;
}

export function FilterPills({
  items,
}: {
  items: Array<{ label: string; count: string; active?: boolean }>;
}) {
  const initialActive = items.find((item) => item.active)?.label ?? items[0]?.label;
  const [activeLabel, setActiveLabel] = useState(initialActive);

  return (
    <div className="filter-row" data-component="mobile-redesign-filter-row">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={`filter-pill ${item.label === activeLabel ? "active" : ""}`}
          data-component="mobile-redesign-filter-pill"
          aria-pressed={item.label === activeLabel}
          onClick={() => setActiveLabel(item.label)}
        >
          {item.label} <span className="count">{item.count}</span>
        </button>
      ))}
    </div>
  );
}

export function ListCard({
  title,
  count,
  actionLabel,
  actionHref,
  filters,
  beforeFilters,
  beforeScroll,
  children,
}: {
  title: string;
  count?: string;
  actionLabel?: string;
  actionHref?: string;
  filters: Array<{ label: string; count: string; active?: boolean }>;
  beforeFilters?: ReactNode;
  beforeScroll?: ReactNode;
  children: ReactNode;
}) {
  const actionIcon = actionLabel?.startsWith("+") ? null : <Plus size={12} strokeWidth={3} />;
  const [actionFeedback, setActionFeedback] = useState("");
  const action = actionLabel ? (
    actionHref ? (
      <Link href={actionHref} className="list-action" data-component="mobile-redesign-list-action">
        {actionIcon}
        {actionLabel}
      </Link>
    ) : (
      <button
        type="button"
        className="list-action"
        data-component="mobile-redesign-list-action"
        onClick={() => setActionFeedback(`${actionLabel.replace(/^\+\s*/, "")} 기능을 열었습니다.`)}
      >
        {actionIcon}
        {actionLabel}
      </button>
    )
  ) : null;

  return (
    <div className="list-card" data-component="mobile-redesign-list-card">
      <div className="list-title" data-component="mobile-redesign-list-title">
        <span className="list-title-text">
          {title}
          {count && <span className="list-count">{count}</span>}
        </span>
        {action}
      </div>
      {beforeFilters}
      {filters.length > 0 && <FilterPills items={filters} />}
      {actionFeedback && (
        <div className="action-feedback" role="status" data-component="mobile-redesign-action-feedback">
          {actionFeedback}
        </div>
      )}
      {beforeScroll}
      <div className="list-card-scroll" data-component="mobile-redesign-list-scroll">
        {children}
      </div>
    </div>
  );
}

export function SectionedList({ sections }: { sections: SectionRows[] }) {
  return (
    <>
      {sections.map((section) => (
        <div className="section-block" key={section.title} data-component="mobile-redesign-list-section">
          <div className="section-header">{section.title}</div>
          {section.rows.map((row) => (
            <ClientLikeRow key={`${section.title}-${row.name}`} row={row} />
          ))}
        </div>
      ))}
    </>
  );
}

export function ClientLikeRow({ row }: { row: ListRow }) {
  const hasDue = Boolean(row.due || row.dueSub);

  return (
    <div className="list-item" data-component="mobile-redesign-list-row">
      <div className={`list-avatar ${avatarToneClass[row.avatarTone ?? "primary"]}`}>{row.initial}</div>
      <div className="list-info">
        <div className="list-name">
          {row.name}
          {hasDue && (
            <>
              {" "}
              <Badge label={row.badge} tone={row.badgeTone} />
            </>
          )}
        </div>
        <div className="list-meta">{row.meta}</div>
      </div>
      <div className="list-right">
        {hasDue ? (
          <>
            {row.due && <span className={`dday ${row.dueTone ?? ""}`}>{row.due}</span>}
            {row.dueSub && <span className="dday-sub">{row.dueSub}</span>}
          </>
        ) : (
          <Badge label={row.badge} tone={row.badgeTone} />
        )}
      </div>
    </div>
  );
}

export function ContractList({ sections }: { sections: Array<{ title: string; rows: ContractRow[] }> }) {
  return (
    <>
      {sections.map((section) => (
        <div className="section-block" key={section.title} data-component="mobile-redesign-contract-section">
          <div className="section-header">{section.title}</div>
          {section.rows.map((row) => (
            <div
              className="contract-item"
              key={`${section.title}-${row.name}`}
              data-component="mobile-redesign-contract-row"
              data-progress={row.badge}
            >
              <div className={`contract-icon ${iconToneClass[row.iconTone]}`}>
                <FileCheck2 size={18} strokeWidth={2.5} />
              </div>
              <div className="contract-info">
                <div className="contract-title">{row.name}</div>
                <div className="contract-meta">
                  <span className={row.badgeTone === "green" ? "step-label muted" : "step-label"}>{row.meta}</span>
                </div>
              </div>
              <div className="list-right">
                <Badge label={row.badge} tone={row.badgeTone} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

export function MenuGroups({ groups }: { groups: MenuGroup[] }) {
  return (
    <>
      {groups.map((group) => (
        <div className="menu-group" key={group.title} data-component="mobile-redesign-menu-group">
          <div className="menu-group-title">{group.title}</div>
          {group.rows.map((row) => {
            const Icon = row.icon;
            return row.href ? (
                <Link
                  key={`${group.title}-${row.label}`}
                  href={row.href}
                  className="menu-row"
                  data-component="mobile-redesign-menu-row"
                >
                  <div className={`menu-icon ${menuToneClass[row.tone]}`}>
                    <Icon size={18} strokeWidth={2.5} color={menuIconStroke[row.tone]} />
                  </div>
                  <div className="menu-text">
                    <div className="menu-label">{row.label}</div>
                  </div>
                  <div className="menu-right">
                    {row.badge && <span className="menu-badge">{row.badge}</span>}
                    {row.value && <span className="menu-value">{row.value}</span>}
                    <ChevronRight size={16} strokeWidth={2} />
                  </div>
                </Link>
              ) : (
                <div
                  key={`${group.title}-${row.label}`}
                  className="menu-row"
                  data-component="mobile-redesign-menu-row"
                >
                  <div className={`menu-icon ${menuToneClass[row.tone]}`}>
                    <Icon size={18} strokeWidth={2.5} color={menuIconStroke[row.tone]} />
                  </div>
                  <div className="menu-text">
                    <div className="menu-label">{row.label}</div>
                  </div>
                  <div className="menu-right">
                    {row.badge && <span className="menu-badge">{row.badge}</span>}
                    {row.value && <span className="menu-value">{row.value}</span>}
                    <ChevronRight size={16} strokeWidth={2} />
                  </div>
                </div>
              );
          })}
        </div>
      ))}
    </>
  );
}
