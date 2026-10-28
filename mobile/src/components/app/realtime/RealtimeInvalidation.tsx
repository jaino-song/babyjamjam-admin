"use client";

import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { useInitialUser } from "@/providers/UserProvider";

/**
 * Mounts the app-wide realtime stream once the shell has an authenticated user; renders nothing.
 *
 * The stream is branch-scoped, so user id + branch id is its identity: a branch
 * switch that re-renders the shell with a different user reopens it.
 */
export function RealtimeInvalidation(): null {
  const user = useInitialUser();
  useRealtimeInvalidation(user ? `${user.id}:${user.branchId ?? ""}` : null);
  return null;
}
