"use client";

import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { useInitialUser } from "@/providers/UserProvider";

/**
 * Mounts the app-wide realtime stream once for logged-in pages. Exists so the
 * server-component `(protected)/layout` can start the hook without becoming a
 * client component. Renders nothing.
 *
 * The layout stays mounted across an in-app branch switch, but its server
 * render hands UserProvider the new user/branch, so that identity — not a
 * cookie read — keys the subscription and re-subscribes on a switch.
 */
export function RealtimeInvalidation(): null {
    const user = useInitialUser();
    const identity = user ? `${user.id}:${user.branchId ?? ""}` : null;
    useRealtimeInvalidation(user !== null, identity);
    return null;
}
