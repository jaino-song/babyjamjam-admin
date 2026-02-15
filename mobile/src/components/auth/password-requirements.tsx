import { Check, Circle } from "lucide-react";
import { cn } from "@/lib/utils";

interface PasswordRequirement {
  label: string;
  met: boolean;
}

interface PasswordRequirementsProps {
  requirements: PasswordRequirement[];
  className?: string;
}

export function PasswordRequirements({
  requirements,
  className,
}: PasswordRequirementsProps) {
  return (
    <ul className={cn("space-y-1", className)}>
      {requirements.map((req) => (
        <li
          key={req.label}
          className={cn(
            "flex items-center gap-2 text-sm transition-colors",
            req.met ? "text-success" : "text-muted-foreground"
          )}
        >
          {req.met ? (
            <Check className="h-4 w-4 shrink-0" />
          ) : (
            <Circle className="h-4 w-4 shrink-0" />
          )}
          <span>{req.label}</span>
        </li>
      ))}
    </ul>
  );
}
