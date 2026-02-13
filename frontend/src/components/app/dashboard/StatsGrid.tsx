import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";

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

const iconColors = ["text-primary", "text-burgundy", "text-orange", "text-gray"];

export function StatsGrid({ stats, disabled = false }: StatsGridProps) {
  return (
    <div data-component="dashboard-stats" className="grid grid-cols-2 lg:grid-cols-4 gap-4 lg:max-w-3xl">
      {stats.map((item, index) => {
        const Icon = item.icon;

        return (
          <Card
            key={item.title}
            variant="v3"
            data-component="dashboard-stats-card"
            className={cn(
              "animate-pop-in cursor-pointer transition-all hover:scale-105",
              disabled && "opacity-50 pointer-events-none"
            )}
            style={{ animationDelay: `${100 + index * 100}ms` }}
          >
            <CardContent className="flex flex-col justify-between h-full p-6">
              <div className="flex items-center justify-between mb-4">
                <span className="text-sm font-medium text-muted-foreground truncate">
                  {item.title}
                </span>
                {Icon && <Icon className={cn("h-5 w-5", iconColors[index % iconColors.length])} />}
              </div>
              <span className="text-2xl font-bold tracking-tight text-foreground">
                {item.value}
                {item.unit && <span className="text-sm font-normal text-muted-foreground ml-1">{item.unit}</span>}
              </span>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
