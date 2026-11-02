"use client";

import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { Check, X } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Mobile toasts sit at the bottom centre, clear of the tab bar and the home
 * indicator, so the message never lands under a thumb. Desktop puts them in the
 * bottom-right corner instead — see the frontend Toaster.
 */
const TOASTER_POSITION =
  "fixed bottom-[calc(env(safe-area-inset-bottom)+5.75rem)] left-1/2 w-[calc(100vw-32px)] max-w-[360px] -translate-x-1/2";

/**
 * Above the detail sheet and any dialog, so a toast raised from inside one is
 * never buried behind it.
 */
const TOASTER_LAYER = "z-[1000]";

/**
 * Every variant is the same dark snackbar; only the leading icon tells them
 * apart. Green-500 / red-500 are used for the icon discs because the status
 * tokens are tuned for light tinted surfaces and read too dark on this navy.
 */
const VARIANT_ICON = {
  default: null,
  success: { disc: "bg-green-500", glyph: <Check className="h-3.5 w-3.5" strokeWidth={3} /> },
  destructive: {
    disc: "bg-red-500",
    glyph: <span className="text-sm font-bold leading-none">!</span>,
  },
} as const;

/** Lets a `ToastAction` dismiss the toast it is rendered inside. */
const ToastDismissContext = createContext<(() => void) | null>(null);

/**
 * The action button of a toast: run the caller's `onClick`, then dismiss the
 * toast. Light blue on the dark surface, with a 44px minimum touch target.
 */
export function ToastAction({
  children,
  className,
  onClick,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode }) {
  const dismissToast = useContext(ToastDismissContext);

  return (
    <button
      data-slot="toast-action"
      type={type}
      onClick={(event) => {
        onClick?.(event);
        dismissToast?.();
      }}
      className={cn(
        "-my-2 -mr-2 inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-semibold text-[#9cc3ff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9cc3ff]",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div
      data-component="mobile_shell_toaster"
      // The container is the live region, not the individual toast: a region
      // has to exist before content lands in it to be announced reliably.
      role="status"
      aria-live="polite"
      className={cn(
        TOASTER_POSITION,
        TOASTER_LAYER,
        "pointer-events-none flex flex-col-reverse gap-2",
      )}
    >
      {toasts.map((toast) => {
        const variant = toast.variant ?? "default";
        const icon = VARIANT_ICON[variant];

        return (
          <div
            data-component="mobile_shell_toaster_toast"
            data-variant={variant}
            key={toast.id}
            className={cn(
              "group pointer-events-auto relative flex items-center gap-3 rounded-[14px] bg-v3-dark px-4 py-[13px] text-white shadow-[0_8px_24px_rgba(15,28,51,0.28)] transition-all duration-300",
              toast.open === false
                ? "animate-out slide-out-to-bottom-2 fade-out-0"
                : "animate-in slide-in-from-bottom-2 fade-in-0",
            )}
          >
            {icon && (
              <span
                data-slot="toast-icon"
                aria-hidden="true"
                className={cn(
                  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white",
                  icon.disc,
                )}
              >
                {icon.glyph}
              </span>
            )}
            <div className="grid min-w-0 flex-1 gap-0.5 break-keep">
              {toast.title && (
                <p data-slot="toast-title" className="text-[14.5px] font-semibold leading-snug">
                  {toast.title}
                </p>
              )}
              {toast.description && (
                <p data-slot="toast-description" className="text-[13px] leading-snug text-white/75">
                  {toast.description}
                </p>
              )}
            </div>
            <ToastDismissContext.Provider value={() => dismiss(toast.id)}>
              {toast.action}
            </ToastDismissContext.Provider>
            <button
              data-slot="toast-close"
              type="button"
              onClick={() => dismiss(toast.id)}
              aria-label="알림 닫기"
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-v3-dark text-white opacity-0 transition-opacity focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-[#9cc3ff] group-hover:opacity-100"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
