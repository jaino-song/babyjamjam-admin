"use client";

import { LoadingState } from "@/components/app/ui/LoadingState";
import { useServiceWorkerUpdate } from "@/hooks/useServiceWorkerUpdate";

export function ServiceWorkerUpdateOverlay() {
    const { isUpdating } = useServiceWorkerUpdate();

    if (!isUpdating) return null;

    return (
        <div data-component="desktop_chrome_service-worker-update-overlay" className="fixed inset-0 bg-background/95 flex flex-col items-center justify-center z-[9999] gap-4">
            <LoadingState data-component="desktop_chrome_service-worker-update-overlay_loading" label="앱 업데이트 중" size="lg" />
        </div>
    );
}
