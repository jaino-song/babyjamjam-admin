"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { QueryErrorState } from "@/components/app/ui/QueryErrorState";

export function StatsQueryError({ dataComponent }: { dataComponent: string }) {
  const router = useRouter();
  const [isRetrying, startTransition] = useTransition();

  return (
    <QueryErrorState
      dataComponent={dataComponent}
      size="inline"
      title="통계를 불러오지 못했습니다"
      isRetrying={isRetrying}
      onRetry={() => startTransition(() => router.refresh())}
    />
  );
}
