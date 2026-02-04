"use client";

import { useState } from "react";
import { Bell } from "lucide-react";
import { api } from "@/app/lib/axios/client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";

interface BroadcastResult {
  sent: number;
  failed: number;
}

export function NotificationTestSection() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<BroadcastResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTestBroadcast = async () => {
    setLoading(true);
    setResult(null);
    setError(null);

    try {
      const { data } = await api.post<BroadcastResult>('/notifications/test-broadcast');
      setResult(data);
    } catch {
      setError('알림 전송에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      data-component="NotificationTestSection"
      className="p-4 border border-border rounded-lg opacity-0 animate-fade-in"
      style={{ animationDelay: "100ms" }}
    >
      <h3 className="text-lg font-semibold mb-2 flex items-center gap-2">
        <Bell size={20} className="text-primary" />
        알림 테스트
      </h3>

      <p className="text-sm text-muted-foreground mb-4">
        모든 구독된 디바이스에 테스트 알림을 전송합니다.
      </p>

      <Button
        onClick={handleTestBroadcast}
        disabled={loading}
        className="gap-2"
      >
        {loading ? (
          <Spinner className="h-4 w-4" />
        ) : (
          <Bell size={16} />
        )}
        {loading ? '전송 중...' : '테스트 알림 보내기'}
      </Button>

      {result && (
        <Alert className="mt-4 bg-success/10 border-success/30 text-success">
          <AlertDescription>
            전송 완료 - 성공: {result.sent}건 / 실패: {result.failed}건
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mt-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
