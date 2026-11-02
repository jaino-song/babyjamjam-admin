"use client";

import * as Sentry from "@sentry/nextjs";
import { useRouter } from "next/navigation";
import { startTransition, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const router = useRouter();

  useEffect(() => {
    Sentry.captureException(error);
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
    <div data-component="desktop_error_recovery" role="alert">
      <h1 data-component="desktop_error_recovery_title">서버에 연결할 수 없어요</h1>
      <p data-component="desktop_error_recovery_description">
        서버에 연결할 수 없거나 일시적인 문제가 발생했어요. 잠시 후 다시 시도해 주세요.
      </p>
      <Button
        data-component="desktop_error_recovery_retry"
        onClick={retry}
        type="button"
      >
        다시 시도
      </Button>
    </div>
  );
}
