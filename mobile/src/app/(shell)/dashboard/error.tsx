"use client";

import { ErrorFallback } from "@/components/app/ui/error-fallback";

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function DashboardError({ reset }: DashboardErrorProps) {
  return (
    <ErrorFallback
      description="잠시 후 다시 시도해주세요."
      onReset={reset}
      title="대시보드를 불러오는 중 문제가 발생했어요."
    />
  );
}
