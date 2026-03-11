"use client";

import { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessagingFeatureGateProps {
  children: ReactNode;
  isEnabled: boolean;
  title: string;
  description: string;
  isLoading?: boolean;
}

export function MessagingFeatureGate({
  children,
  isEnabled,
  title,
  description,
  isLoading = false,
}: MessagingFeatureGateProps) {
  if (isEnabled) {
    return <>{children}</>;
  }

  return (
    <div className="relative">
      <div
        className={cn(
          "transition-all duration-200",
          "pointer-events-none select-none blur-[1.5px] grayscale-[0.35] opacity-55",
        )}
        aria-hidden="true"
      >
        {children}
      </div>

      <div className="absolute inset-0 z-10 overflow-hidden rounded-[28px] border border-slate-300/80 bg-slate-200/45 backdrop-blur-[2px]">
        <div className="border-b border-slate-300/80 bg-slate-100/90 px-5 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-slate-700 text-white">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900">관리자 승인이 필요합니다</p>
              <p className="text-xs text-slate-600">
                {isLoading ? "승인 상태를 확인하는 중입니다." : title}
              </p>
            </div>
          </div>
        </div>

        <div className="flex h-[calc(100%-61px)] items-center justify-center px-6 text-center">
          <div className="max-w-md rounded-[22px] border border-white/70 bg-white/80 px-6 py-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
