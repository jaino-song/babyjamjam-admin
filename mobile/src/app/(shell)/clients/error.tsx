"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

import { ErrorFallback } from "@/components/app/ui/error-fallback";

interface ClientsErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ClientsError({ error, reset }: ClientsErrorProps) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <ErrorFallback
      description="잠시 후 다시 시도해주세요."
      onReset={reset}
      title="고객 목록을 불러오는 중 문제가 발생했어요."
    />
  );
}
