"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";

import { ErrorFallback } from "@/components/app/ui/error-fallback";

interface AppErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

export default function AppError({ error, reset }: AppErrorProps) {
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  // A failed server render (for example a protected layout that could not reach
  // the backend) is not re-requested by reset() alone, which only re-renders the
  // client tree. router.refresh() refetches the server components first.
  const retry = () => {
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  // Production strips server error messages (only `digest` reaches the client),
  // so this copy has to be honest for any server-render failure.
  return (
    <ErrorFallback
      debugDigest={IS_DEVELOPMENT ? error.digest : undefined}
      debugMessage={IS_DEVELOPMENT ? error.message : undefined}
      description="서버에 연결할 수 없거나 일시적인 문제가 발생했어요. 잠시 후 다시 시도해 주세요."
      onReset={retry}
      title="서버에 연결할 수 없어요"
    />
  );
}
