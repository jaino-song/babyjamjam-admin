"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export default function StatsError({ retry }: { retry: () => void }) {
  return (
    <Alert data-component="desktop_stats_error" variant="destructive">
      <AlertTitle data-component="desktop_stats_error_title">
        통계를 불러오지 못했어요
      </AlertTitle>
      <AlertDescription data-component="desktop_stats_error_description">
        <p>통계 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요.</p>
        <Button
          data-component="desktop_stats_error_retry"
          type="button"
          className="mt-4"
          onClick={retry}
        >
          다시 시도
        </Button>
      </AlertDescription>
    </Alert>
  );
}
