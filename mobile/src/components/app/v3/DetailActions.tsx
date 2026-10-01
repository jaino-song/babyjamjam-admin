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
    "bg-v3-primary text-white hover:bg-v3-primary-hover",
  default:
    "bg-v3-dim-white text-v3-text hover:bg-v3-border",
  danger:
    "bg-v3-burgundy-light text-v3-burgundy hover:bg-v3-burgundy/10",
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
            "rounded-2xl px-3 py-1.5 text-[0.75rem] font-semibold transition-colors",
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
