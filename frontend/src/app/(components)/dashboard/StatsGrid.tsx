import { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export interface StatItem {
  title: string;
  firstDataLabel?: string;
  secondDataLabel?: string;
  firstDataValue: string;
  secondDataValue?: string;
  icon?: LucideIcon;
}

interface StatsGridProps {
  stats: StatItem[];
  disabled?: boolean;
}

export function StatsGrid({ stats, disabled = false }: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((item, index) => {
        const Icon = item.icon;
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
            <CardContent className="p-5">
              <div className="flex flex-col items-center text-center space-y-3">
                {/* Title */}
                <p className="text-sm font-semibold text-muted-foreground">
                  {item.title}
                </p>

                {/* Primary Data Row */}
                <div className="flex items-center justify-center gap-3">
                  <Avatar
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
                      {item.firstDataLabel ? (
                        item.firstDataLabel
                      ) : Icon ? (
                        <Icon className="h-5 w-5" />
                      ) : null}
                    </AvatarFallback>
                  </Avatar>
                  <p className="text-xl font-bold tracking-tight min-w-[50px]">
                    {item.firstDataValue}
                  </p>
                </div>

                {/* Secondary Data Row (if present) */}
                {item.secondDataValue && (
                  <div className="flex items-center justify-center gap-3">
                    <Avatar
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
                        {item.secondDataLabel}
                      </AvatarFallback>
                    </Avatar>
                    <p className="text-xl font-bold tracking-tight min-w-[50px]">
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
