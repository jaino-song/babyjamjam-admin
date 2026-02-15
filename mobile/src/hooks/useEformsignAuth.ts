"use client";

import { useState, useEffect, useCallback } from "react";
import { eformsignApi } from "@/services/api";
import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-storage";

interface UseEformsignAuthReturn {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: Error | null;
  authenticate: () => Promise<void>;
}

// Cookie expiry buffer (re-authenticate 5 minutes before expiry)
const AUTH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Hook to manage eformsign authentication
 * 
 * - Checks if auth cookie exists before making API call
 * - Stores authentication timestamp in sessionStorage
 * - Auto re-authenticates when token is about to expire
 */
export function useEformsignAuth(): UseEformsignAuthReturn {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const authenticate = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      
      const executionTime = Date.now();
      await eformsignApi.authenticate(executionTime);
      
      // Store auth timestamp in sessionStorage
      safeStorageSetItem("session", "eformsign_auth_time", executionTime.toString());
      
      setIsAuthenticated(true);
    } catch (err) {
      console.error("[useEformsignAuth] Authentication failed:", err);
      setError(err instanceof Error ? err : new Error("Authentication failed"));
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const checkAndAuthenticate = async () => {
      // Check if we have a recent auth timestamp
      const authTimeStr = safeStorageGetItem("session", "eformsign_auth_time");
      const authTime = authTimeStr ? parseInt(authTimeStr, 10) : 0;
      const now = Date.now();
      
      // Token expires in 1 hour, re-auth 5 minutes before
      const tokenExpiryMs = 60 * 60 * 1000; // 1 hour
      const tokenAge = now - authTime;
      
      if (authTime > 0 && tokenAge < tokenExpiryMs - AUTH_BUFFER_MS) {
        // Token is still valid (not expired and not about to expire)
        setIsAuthenticated(true);
        setIsLoading(false);
        return;
      }
      
      // Need to authenticate (first time or token expired/expiring)
      await authenticate();
    };

    checkAndAuthenticate();
  }, [authenticate]);

  return { isAuthenticated, isLoading, error, authenticate };
}
