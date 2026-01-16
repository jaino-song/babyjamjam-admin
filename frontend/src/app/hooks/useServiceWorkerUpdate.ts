"use client";

import { useState, useEffect, useCallback } from "react";

interface ServiceWorkerUpdateState {
    isUpdating: boolean;
    isUpdateAvailable: boolean;
    registration: ServiceWorkerRegistration | null;
}

export function useServiceWorkerUpdate() {
    const [state, setState] = useState<ServiceWorkerUpdateState>({
        isUpdating: false,
        isUpdateAvailable: false,
        registration: null,
    });

    const applyUpdate = useCallback(() => {
        if (!state.registration?.waiting) return;

        setState(prev => ({ ...prev, isUpdating: true }));

        state.registration.waiting.postMessage('skipWaiting');
    }, [state.registration]);

    useEffect(() => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
            return;
        }

        const handleControllerChange = () => {
            window.location.reload();
        };

        navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

        navigator.serviceWorker.ready.then((registration) => {
            setState(prev => ({ ...prev, registration }));

            if (registration.waiting) {
                setState(prev => ({ ...prev, isUpdateAvailable: true, isUpdating: true }));
                registration.waiting.postMessage('skipWaiting');
            }

            registration.addEventListener('updatefound', () => {
                const newWorker = registration.installing;
                if (!newWorker) return;

                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        setState(prev => ({ ...prev, isUpdateAvailable: true, isUpdating: true }));
                        newWorker.postMessage('skipWaiting');
                    }
                });
            });

            registration.update();
        });

        return () => {
            navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
        };
    }, []);

    return {
        ...state,
        applyUpdate,
    };
}
