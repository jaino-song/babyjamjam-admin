"use client";

import React from "react";
import type { LucideIcon } from "lucide-react";

export interface SectionNavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  disabled?: boolean;
}

interface SectionNavProps {
  items: readonly SectionNavItem[];
  activeId: string;
  onSelect: (id: string) => void;
  footer?: React.ReactNode;
}

export function SectionNav({ items, activeId, onSelect, footer }: SectionNavProps) {
  return (
    <nav
      data-component="section-nav"
      data-mode="desktop"
      className="w-full shrink-0 self-start animate-v3-slide-up lg:w-max"
    >
      <div
        data-component="section-nav-desktop"
        data-mode="desktop"
        className="sticky top-[calc(96px*var(--v3-ui-scale,1))] hidden lg:block"
      >
        <div className="flex flex-col gap-[calc(4px*var(--v3-ui-scale,1))]">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => !item.disabled && onSelect(item.id)}
                disabled={item.disabled}
                className={`flex items-center gap-[calc(12px*var(--v3-ui-scale,1))] whitespace-nowrap rounded-xl px-[calc(16px*var(--v3-ui-scale,1))] py-[calc(10px*var(--v3-ui-scale,1))] text-left text-[calc(14px*var(--v3-ui-scale,1))] font-medium transition-all duration-200 ${
                  item.disabled
                    ? "text-[hsl(var(--v3-text-muted))]/40 cursor-not-allowed"
                    : isActive
                      ? "bg-[hsl(var(--v3-primary))] text-white"
                      : "text-[hsl(var(--v3-text-muted))] hover:bg-[hsl(var(--v3-bg))]"
                }`}
              >
                <Icon className="h-[calc(16px*var(--v3-ui-scale,1))] w-[calc(16px*var(--v3-ui-scale,1))]" />
                {item.label}
              </button>
            );
          })}
        </div>
        {footer && <div className="mt-[calc(16px*var(--v3-ui-scale,1))] flex flex-col gap-[calc(8px*var(--v3-ui-scale,1))]">{footer}</div>}
      </div>

      <div
        data-component="section-nav-mobile"
        data-mode="desktop"
        className="-mx-[calc(16px*var(--v3-ui-scale,1))] overflow-x-auto px-[calc(16px*var(--v3-ui-scale,1))] scrollbar-hide lg:hidden"
      >
        <div className="flex gap-[calc(8px*var(--v3-ui-scale,1))] pb-[calc(8px*var(--v3-ui-scale,1))]">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                onClick={() => !item.disabled && onSelect(item.id)}
                disabled={item.disabled}
                className={`flex items-center gap-[calc(8px*var(--v3-ui-scale,1))] rounded-full px-[calc(16px*var(--v3-ui-scale,1))] py-[calc(8px*var(--v3-ui-scale,1))] text-[calc(14px*var(--v3-ui-scale,1))] font-medium whitespace-nowrap transition-all duration-200 ${
                  item.disabled
                    ? "text-[hsl(var(--v3-text-muted))]/40 cursor-not-allowed bg-[hsl(var(--v3-bg))]"
                    : isActive
                      ? "bg-[hsl(var(--v3-primary))] text-white"
                      : "text-[hsl(var(--v3-text-muted))] bg-[hsl(var(--v3-bg))]"
                }`}
              >
                <Icon className="h-[calc(16px*var(--v3-ui-scale,1))] w-[calc(16px*var(--v3-ui-scale,1))]" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
