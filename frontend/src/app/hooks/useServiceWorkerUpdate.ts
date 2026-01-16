"use client";

import { useState, useEffect, useCallback } from "react";

interface ServiceWorkerUpdateState {
    isUpdating: boolean;
    isUpdateAvailable: boolean;
    registration: ServiceWorkerRegistration | null;
}

// 오버레이 표시 최소 시간 (ms)
const OVERLAY_MIN_DISPLAY_TIME = 1000;

export function useServiceWorkerUpdate() {
    const [state, setState] = useState<ServiceWorkerUpdateState>({
        isUpdating: false,
        isUpdateAvailable: false,
        registration: null,
    });

    const applyUpdate = useCallback(() => {
        if (!state.registration?.waiting) return;

        setState(prev => ({ ...prev, isUpdating: true }));

        // 오버레이가 보이도록 잠시 대기 후 skipWaiting
        setTimeout(() => {
            state.registration?.waiting?.postMessage('skipWaiting');
        }, OVERLAY_MIN_DISPLAY_TIME);
    }, [state.registration]);

    useEffect(() => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
            return;
        }

        let reloadTimeout: NodeJS.Timeout | null = null;

        const handleControllerChange = () => {
            // 이미 isUpdating이면 바로 reload, 아니면 상태 설정 후 reload
            if (state.isUpdating) {
                window.location.reload();
            } else {
                setState(prev => ({ ...prev, isUpdating: true }));
                reloadTimeout = setTimeout(() => {
                    window.location.reload();
                }, OVERLAY_MIN_DISPLAY_TIME);
            }
        };

        navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

        navigator.serviceWorker.ready.then((registration) => {
            setState(prev => ({ ...prev, registration }));

            // 이미 대기 중인 SW가 있으면 오버레이 표시 후 활성화
            if (registration.waiting) {
                setState(prev => ({ ...prev, isUpdateAvailable: true, isUpdating: true }));
                setTimeout(() => {
                    registration.waiting?.postMessage('skipWaiting');
                }, OVERLAY_MIN_DISPLAY_TIME);
            }

            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;

                newWorker.addEventListener('statechange', () => {
                    // 새 SW가 설치 완료되고, 기존 컨트롤러가 있으면 (업데이트 상황)
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        setState(prev => ({ ...prev, isUpdateAvailable: true, isUpdating: true }));
                        // 오버레이가 보이도록 잠시 대기 후 skipWaiting
                        setTimeout(() => {
                            newWorker.postMessage('skipWaiting');
                        }, OVERLAY_MIN_DISPLAY_TIME);
                    }
                });
            });

            registration.update();
        });

        return () => {
            navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
            if (reloadTimeout) clearTimeout(reloadTimeout);
        };
    }, [state.isUpdating]);

    return {
        ...state,
        applyUpdate,
    };
}
