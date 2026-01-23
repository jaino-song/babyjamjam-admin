"use client";

import { useEffect, useState } from "react";

/**
 * Component to auto-request notification permission on app mount
 * Only requests if permission is 'default' (not yet asked)
 */
export function NotificationPermissionPrompt() {
    const [hasPrompted, setHasPrompted] = useState(false);

    useEffect(() => {
        // Only run in browser
        if (typeof window === 'undefined') return;
        
        // Check if notifications are supported
        if (!('Notification' in window)) return;

        // Only prompt if permission hasn't been decided yet
        if (Notification.permission === 'default' && !hasPrompted) {
            setHasPrompted(true);
            Notification.requestPermission().then((permission) => {
                console.log('[Push] Auto-prompt permission result:', permission);
            });
        }
    }, [hasPrompted]);

    // This component doesn't render anything
    return null;
}
