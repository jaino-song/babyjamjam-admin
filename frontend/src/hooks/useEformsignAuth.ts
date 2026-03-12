"use client";

import { useState, useEffect, useCallback } from "react";
import { eformsignApi } from "@/services/api";
import { safeStorageGetItem, safeStorageRemoveItem, safeStorageSetItem } from "@/lib/safe-storage";

interface UseEformsignAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  authenticate: () => Promise<void>;
}

interface UseEformsignAuthOptions {
  syncOnWindowFocus?: boolean;
}

// Cookie expiry buffer (re-authenticate 5 minutes before expiry)
const AUTH_BUFFER_MS = 5 * 60 * 1000;
const TOKEN_EXPIRY_MS = 60 * 60 * 1000;

let inFlightAuthentication: Promise<void> | null = null;

function getStoredAuthTime(): number {
  const authTimeStr = safeStorageGetItem("session", "eformsign_auth_time");
  return authTimeStr ? parseInt(authTimeStr, 10) : 0;
}

function hasFreshAuthTime(authTime: number): boolean {
  return authTime > 0 && Date.now() - authTime < TOKEN_EXPIRY_MS - AUTH_BUFFER_MS;
}

async function authenticateOnce(memberEmail?: string): Promise<void> {
  if (!inFlightAuthentication) {
    const executionTime = Date.now();

    inFlightAuthentication = eformsignApi
      .authenticate(executionTime, memberEmail)
      .then(() => {
        safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
      })
      .finally(() => {
        inFlightAuthentication = null;
      });
  }

  await inFlightAuthentication;
}

/**
 * Hook to manage eformsign authentication
 * 
 * - Verifies server-side auth cookies before trusting the local auth timestamp
 * - Stores authentication timestamp in sessionStorage
 * - Auto re-authenticates when token is about to expire
 */
export function useEformsignAuth(
  { syncOnWindowFocus = true }: UseEformsignAuthOptions = {}
): UseEformsignAuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const authenticate = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      await authenticateOnce();

      setIsAuthenticated(true);
    } catch (err) {
      console.error("[useEformsignAuth] Authentication failed:", err);
      safeStorageRemoveItem("session", "eformsign_auth_time");
      setError(err instanceof Error ? err : new Error("Authentication failed"));
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const syncAuthentication = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const authTime = getStoredAuthTime();
      if (!hasFreshAuthTime(authTime)) {
        await authenticate();
        return;
      }

      const authStatus = await eformsignApi.getAuthStatus();
      if (authStatus.hasAppAuthToken && authStatus.hasAccessToken) {
        setIsAuthenticated(true);
        return;
      }

      await authenticate();
    } catch (err) {
      console.error("[useEformsignAuth] Auth state validation failed:", err);
      safeStorageRemoveItem("session", "eformsign_auth_time");
      setError(err instanceof Error ? err : new Error("Failed to validate authentication"));
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, [authenticate]);

  useEffect(() => {
    void syncAuthentication();

    if (!syncOnWindowFocus) {
      return;
    }

    const handleFocus = () => {
      void syncAuthentication();
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [syncAuthentication, syncOnWindowFocus]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const checkTokenExpiry = () => {
      const authTime = getStoredAuthTime();
      if (!hasFreshAuthTime(authTime)) {
        void authenticate();
      }
    };

    const interval = setInterval(checkTokenExpiry, 60 * 1000);
    return () => clearInterval(interval);
  }, [isAuthenticated, authenticate]);

  return { isAuthenticated, isLoading, error, authenticate };
}
