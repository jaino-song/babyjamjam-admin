import { cn } from "@/lib/utils";

export interface DetailAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "default" | "danger";
  disabled?: boolean;
}

export interface DetailActionsProps {
  actions: DetailAction[];
  name?: string;
}

const variantStyles: Record<string, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover",
  default:
    "bg-surface text-text hover:bg-border",
  danger:
    "bg-burgundy-light text-burgundy hover:bg-burgundy/10",
};

export function DetailActions({ actions, name }: DetailActionsProps) {
  return (
    <div data-component={name} className="flex gap-2">
      {actions.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          disabled={action.disabled}
          className={cn(
            "rounded-[10px] px-3 py-1.5 text-[0.75rem] font-semibold transition-colors",
            "disabled:opacity-50 disabled:pointer-events-none",
            variantStyles[action.variant ?? "default"]
          )}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}
