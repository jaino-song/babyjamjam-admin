"use client";

import { ErrorFallback } from "@/components/app/ui/error-fallback";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ reset }: GlobalErrorProps) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-[radial-gradient(circle_at_top,_hsla(214,100%,34%,0.08),_transparent_55%),linear-gradient(180deg,_hsl(210,100%,99%),_#ffffff)]">
        <ErrorFallback
          className="min-h-screen px-6 py-10"
          description="잠시 후 다시 시도해주세요."
          onReset={reset}
          title="앱을 불러오는 중 문제가 발생했어요."
        />
      </body>
    </html>
  );
}
