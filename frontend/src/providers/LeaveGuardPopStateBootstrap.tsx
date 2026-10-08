"use client";

import { ensureLeaveGuardPopState } from "@/features/service-records/hooks/leave-guard-popstate";

// Evaluating the module above (and this call, which keeps the import from being
// tree-shaken) happens in the initial client bundle, before Next's app router adds its
// own `popstate` listener. See `leave-guard-popstate.ts`.
ensureLeaveGuardPopState();

export function LeaveGuardPopStateBootstrap() {
    return null;
}
