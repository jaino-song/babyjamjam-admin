"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { SelectableItemFrame } from "@/components/ui/selectable-item";

const THEME_OPTIONS = [
  { id: "light", label: "라이트", icon: Sun, description: "밝은 테마" },
  { id: "dark", label: "다크", icon: Moon, description: "어두운 테마" },
  { id: "system", label: "시스템", icon: Monitor, description: "시스템 설정" },
] as const;

/** Existing light-only theme preview; unavailable choices stay disabled. */
export function ThemeChoice({ "data-component": base }: { "data-component"?: string }) {
  const sub = (suffix: string) => base ? `${base}_${suffix}` : undefined;

  return (
    <div data-component={base} data-source-component="ThemeChoice" className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {THEME_OPTIONS.map((theme) => {
        const Icon = theme.icon;
        const isSelected = theme.id === "light";
        return (
          <SelectableItemFrame key={theme.id} asChild isSelected={isSelected} isInteractive={isSelected}>
            <button
              data-component={sub(theme.id)}
              type="button"
              aria-pressed={isSelected}
              disabled={!isSelected}
              className="relative flex flex-col items-center gap-3 rounded-xl p-6 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
            >
              <div
                data-component={sub(`${theme.id}_icon`)}
                className={`flex h-12 w-12 items-center justify-center rounded-full ${isSelected ? "bg-v3-primary/10" : "bg-muted/50"}`}
              >
                <Icon size={24} className={isSelected ? "text-v3-primary" : "text-muted-foreground"} />
              </div>
              <div data-component={sub(`${theme.id}_text`)} className="text-center">
                <p className="text-sm font-medium">{theme.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{theme.description}</p>
              </div>
              {!isSelected && (
                <span className="absolute right-2 top-2 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">준비 중</span>
              )}
            </button>
          </SelectableItemFrame>
        );
      })}
    </div>
  );
}
