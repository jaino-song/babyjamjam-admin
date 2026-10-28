"use client";

import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";

/**
 * Mounts the app-wide realtime stream once for logged-in pages. Exists so the
 * server-component `(protected)/layout` can start the hook without becoming a
 * client component. Renders nothing.
 */
export function RealtimeInvalidation(): null {
    useRealtimeInvalidation();
    return null;
}
