"use client";

import { UserPlus, CalendarPlus, Send, FileSignature, LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface QuickAction {
  label: string;
  icon: LucideIcon;
  href?: string;
  iconBgClass?: string;
  iconColor?: string;
}

const actions: QuickAction[] = [
  {
    label: "고객 등록",
    icon: UserPlus,
    iconBgClass: "bg-primary/10",
    iconColor: "text-primary",
  },
  {
    label: "일정 추가",
    icon: CalendarPlus,
    iconBgClass: "bg-success/10",
    iconColor: "text-success",
  },
  {
    label: "메시지 발송",
    icon: Send,
    iconBgClass: "bg-warning/10",
    iconColor: "text-warning",
  },
  {
    label: "계약서 작성",
    icon: FileSignature,
    iconBgClass: "bg-info/10",
    iconColor: "text-info",
  },
];

export function QuickActions() {
  return (
    <div data-component="quick-actions" className="opacity-0 animate-fade-in" style={{ animationDelay: "400ms" }}>
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Quick Action Cards</p>
      <div data-component="quick-actions-grid" className="grid grid-cols-4 gap-2">
        {actions.map((action, index) => {
          const Icon = action.icon;
          return (
            <div
              key={action.label}
              data-component="quick-action-card"
              className={cn(
                "aspect-square flex flex-col items-center justify-center rounded-xl border bg-card",
                "transition-all active:scale-[0.95] cursor-pointer hover:shadow-md",
                "opacity-0 animate-scale-in"
              )}
              style={{ animationDelay: `${450 + index * 50}ms` }}
              role="button"
              tabIndex={0}
            >
              <div className={cn("p-2 rounded-full mb-1.5", action.iconBgClass || "bg-primary/10")}>
                <Icon className={cn("h-4 w-4", action.iconColor || "text-primary")} />
              </div>
              <span className="text-xs font-medium text-center">{action.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
