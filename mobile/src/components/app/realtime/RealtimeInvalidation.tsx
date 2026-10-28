"use client";

import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { useInitialUser } from "@/providers/UserProvider";

/** Mounts the app-wide realtime stream once the shell has an authenticated user; renders nothing. */
export function RealtimeInvalidation(): null {
  useRealtimeInvalidation(useInitialUser() !== null);
  return null;
}
