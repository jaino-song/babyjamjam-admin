import { useSyncExternalStore } from "react";

const ACTIVE_BRANCH_COOKIE_NAMES = ["selected_branch_id", "selected_organization_id"] as const;

/**
 * The selected branch is encoded into the authenticated session and mirrored
 * into these non-httpOnly cookies by the branch selector. Reading the cookie
 * here is only used to partition client query/draft state; authorization is
 * still derived by the backend from the access token.
 */
export function getActiveBranchId(): string | null {
  if (typeof document === "undefined") return null;

  for (const cookieName of ACTIVE_BRANCH_COOKIE_NAMES) {
    const prefix = `${cookieName}=`;
    const cookie = document.cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(prefix));

    if (!cookie) continue;

    const value = cookie.slice(prefix.length);
    if (!value) continue;

    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

/**
 * A query or mutation captured before a branch switch must not run with the
 * newly selected session. Callers use this guard before enabling or sending a
 * request; the current branch cookie must be present and match the captured
 * identity exactly.
 */
export function isBranchContextAligned(branchId: string | null): boolean {
  if (!branchId) return false;

  const currentBranchId = getActiveBranchId();
  return currentBranchId !== null && currentBranchId === branchId;
}

function subscribeToBranchContext(onChange: () => void): () => void {
  window.addEventListener("focus", onChange);
  window.addEventListener("pageshow", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.removeEventListener("focus", onChange);
    window.removeEventListener("pageshow", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

const getServerBranchId = (): null => null;

/** Hydrate with the same empty context as the server before reading cookies. */
export function useActiveBranchId(): string | null {
  return useSyncExternalStore(subscribeToBranchContext, getActiveBranchId, getServerBranchId);
}
