"use client";

import { useState, useEffect } from "react";

export function NotificationPermissionPrompt() {
    const [showBanner, setShowBanner] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!('Notification' in window)) return;
        if (Notification.permission === 'default') {
            setShowBanner(true);
        }
    }, []);

    if (!showBanner) return null;

    const handleEnable = async () => {
        const permission = await Notification.requestPermission();
        if (permission !== 'default') {
            setShowBanner(false);
        }
    };

    const handleDismiss = () => {
        setShowBanner(false);
    };

    return (
        <div className="fixed bottom-20 left-4 right-4 md:bottom-6 md:left-auto md:right-6 md:w-96 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-4 flex items-start gap-3 animate-in slide-in-from-bottom-4">
            <div className="flex-shrink-0 text-2xl">🔔</div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    알림을 허용하시겠습니까?
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    서비스 일정, 계약서 알림 등을 받을 수 있습니다.
                </p>
                <div className="flex gap-2 mt-2">
                    <button
                        onClick={handleEnable}
                        className="px-3 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                        허용
                    </button>
                    <button
                        onClick={handleDismiss}
                        className="px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                    >
                        나중에
                    </button>
                </div>
            </div>
            <button
                onClick={handleDismiss}
                className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                aria-label="닫기"
            >
                ✕
            </button>
        </div>
    );
}
