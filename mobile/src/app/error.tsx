"use client";

import { useEffect } from "react";

import { ErrorFallback } from "@/components/app/ui/error-fallback";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

export default function AppError({ error, reset }: AppErrorProps) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorFallback
      debugDigest={IS_DEVELOPMENT ? error.digest : undefined}
      debugMessage={IS_DEVELOPMENT ? error.message : undefined}
      description="잠시 후 다시 시도해주세요."
      onReset={reset}
      title="페이지를 불러오는 중 문제가 발생했어요."
    />
  );
}
