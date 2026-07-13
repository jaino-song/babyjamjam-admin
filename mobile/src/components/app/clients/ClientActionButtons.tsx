import { type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ClientActionButtonItem {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  onClick?: () => void;
  dataComponent?: string;
}

interface ClientActionButtonsProps {
  items: ClientActionButtonItem[];
  className?: string;
}

export function ClientActionButtons({ items, className }: ClientActionButtonsProps) {
  if (items.length === 0) return null;

  return (
    <div
      data-component="client-action-buttons"
      className={cn("grid gap-2", className)}
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map(({ key, label, icon: Icon, href, onClick, dataComponent }) => {
        const buttonClasses =
          "w-full flex-col h-auto py-3 gap-1 hover:bg-v3-primary-light hover:text-v3-primary rounded-2xl";

        if (href) {
          return (
            <Button key={key} asChild variant="ghost" className={buttonClasses}>
              <a href={href} data-component={dataComponent ?? `client-action-buttons-${key}`}>
                <Icon className="w-4 h-4" />
                <span className="text-[10px] font-semibold">{label}</span>
              </a>
            </Button>
          );
        }

        return (
          <Button
            key={key}
            type="button"
            variant="ghost"
            className={buttonClasses}
            onClick={onClick}
            data-component={dataComponent ?? `client-action-buttons-${key}`}
          >
            <Icon className="w-4 h-4" />
            <span className="text-[10px] font-semibold">{label}</span>
          </Button>
        );
      })}
    </div>
  );
}
