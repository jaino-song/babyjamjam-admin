import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatItem {
  title: string;
  value: string;
  unit?: string;
  icon?: LucideIcon;
  variant?: "default" | "primary" | "success" | "warning" | "destructive";
}

interface StatsGridProps {
  stats: StatItem[];
  disabled?: boolean;
}

const variantStyles = {
  default: "border-border",
  primary: "border-primary/20 bg-primary/5",
  success: "border-success/20 bg-success/5",
  warning: "border-warning/20 bg-warning/5",
  destructive: "border-destructive/20 bg-destructive/5",
};

const iconColors = ["text-primary", "text-burgundy", "text-orange", "text-gray"];

export function StatsGrid({ stats, disabled = false }: StatsGridProps) {
  return (
    <div data-component="stats-grid" className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:max-w-3xl">
      {stats.map((item, index) => {
        const Icon = item.icon;
        const variant = item.variant || "default";

        return (
          <div
            key={item.title}
            data-component="stats-grid-card"
            className={cn(
              "rounded-xl border bg-card p-6 transition-all active:scale-[0.98]",
              "opacity-0 animate-fade-in cursor-pointer hover:shadow-md",
              variantStyles[variant],
              disabled && "opacity-50 pointer-events-none"
            )}
            style={{ animationDelay: `${150 + index * 50}ms` }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground truncate">
                {item.title}
              </span>
              {Icon && <Icon className={cn("h-5 w-5", iconColors[index % iconColors.length])} />}
            </div>
            <span className="text-xl font-bold tracking-tight">
              {item.value}
              {item.unit && <span className="text-xs text-gray ml-1">{item.unit}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
