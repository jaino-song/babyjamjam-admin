"use client";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div data-component="toaster" className="fixed top-4 right-4 z-50 flex flex-col gap-2 w-fit max-w-sm">
      {toasts.map((toast) => (
        <div
          data-component="toast"
          key={toast.id}
          className={cn(
            "relative flex items-center justify-between gap-4 rounded-2xl border p-4 pr-8 shadow-lg transition-all duration-300",
            toast.open === false
              ? "animate-out slide-out-to-right-full fade-out-0"
              : "animate-in slide-in-from-bottom-2 fade-in-0",
            toast.variant === "destructive"
              ? "border-destructive/50 bg-destructive text-destructive-foreground"
              : "border-border bg-background text-foreground"
          )}
        >
          <div className="grid gap-1">
            {toast.description && (
              <p className="text-sm opacity-90">{toast.description}</p>
            )}
          </div>
          {toast.action}
          <button
            type="button"
            onClick={() => dismiss(toast.id)}
            className="absolute right-2 top-2 rounded-2xl p-1 text-foreground/50 opacity-0 transition-opacity hover:text-foreground focus:opacity-100 focus:outline-none focus:ring-2 group-hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
