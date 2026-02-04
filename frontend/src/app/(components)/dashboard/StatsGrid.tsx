import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface StatItem {
  title: string;
  firstTitle?: string;
  secondTitle?: string;
  firstDataLabel?: string;
  secondDataLabel?: string;
  firstDataValue: string;
  secondDataValue?: string;
  icon?: LucideIcon;
  secondIcon?: LucideIcon;
  variant?: "circle" | "pill";
}

interface StatsGridProps {
  stats: StatItem[];
  disabled?: boolean;
}

interface StatsShapeProps {
  label?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}

function StatsCircle({ label, icon: Icon, disabled }: StatsShapeProps) {
  return (
    <Avatar
      data-component="stats-circle"
      className={cn(
        "h-11 w-11 transition-all duration-300 group-hover:scale-110",
        disabled
          ? "bg-muted text-muted-foreground"
          : "bg-primary text-primary-foreground"
      )}
    >
      <AvatarFallback
        className={cn(
          "font-bold text-sm",
          disabled
            ? "bg-muted text-muted-foreground"
            : "bg-primary text-primary-foreground"
        )}
      >
        {label ? label : Icon ? <Icon className="h-5 w-5" /> : null}
      </AvatarFallback>
    </Avatar>
  );
}

function StatsPill({ label, icon: Icon, disabled }: StatsShapeProps) {
  return (
    <div
      data-component="stats-pill"
      className={cn(
        "h-11 min-w-[66px] px-4 rounded-full flex items-center justify-center transition-all duration-300 group-hover:scale-105",
        "text-xs font-bold whitespace-nowrap",
        disabled
          ? "bg-muted text-muted-foreground"
          : "bg-primary text-primary-foreground"
      )}
    >
      {label ? label : Icon ? <Icon className="h-4 w-4" /> : null}
    </div>
  );
}

export function StatsGrid({ stats, disabled = false }: StatsGridProps) {
  return (
    <div data-component="stats-grid" className="grid grid-cols-2 lg:grid-cols-4 gap-4 items-start">
      {stats.map((item, index) => {
        const Icon = item.icon;
        const SecondIcon = item.secondIcon;
        const ShapeComponent = item.variant === "pill" ? StatsPill : StatsCircle;

        return (
          <Card
            key={item.title}
            data-component="stats-grid-card"
            className={cn(
              "relative overflow-hidden hover-lift hover-border cursor-pointer group opacity-0 animate-fade-in",
              "bg-card",
              disabled && "opacity-50 pointer-events-none"
            )}
            style={{ animationDelay: `${150 + index * 50}ms` }}
          >
            <CardContent data-component="stats-card-content" className="p-5">
              <div data-component="stats-card-layout" className="flex flex-col items-center text-center gap-2">
                <p data-component="stats-card-title" className="text-sm font-semibold text-muted-foreground">
                  {item.title}
                </p>

                <div data-component="stats-primary-row" className="flex items-center justify-center gap-3">
                  <ShapeComponent label={item.firstTitle || item.firstDataLabel} icon={Icon} disabled={disabled} />
                  <p data-component="stats-primary-value" className="text-2xl font-bold tracking-tight">
                    {item.firstDataValue}
                  </p>
                </div>

                {item.secondDataValue && (
                  <div data-component="stats-secondary-row" className="flex items-center justify-center gap-3">
                    <ShapeComponent
                      label={item.secondTitle || item.secondDataLabel}
                      icon={SecondIcon}
                      disabled={disabled}
                    />
                    <p data-component="stats-secondary-value" className="text-2xl font-bold tracking-tight">
                      {item.secondDataValue}
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
