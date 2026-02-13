"use client";

import { useState, useEffect, useCallback } from "react";

interface ServiceWorkerUpdateState {
    isUpdating: boolean;
    isUpdateAvailable: boolean;
    registration: ServiceWorkerRegistration | null;
}

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
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        setState(prev => ({ ...prev, isUpdateAvailable: true, isUpdating: true }));
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
