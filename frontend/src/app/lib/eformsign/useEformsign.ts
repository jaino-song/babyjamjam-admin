"use client";

import { useState, useEffect, useCallback } from "react";
import type {
  EformSignDocument,
  EformsignDocumentOption,
  EformsignSuccessResponse,
  EformsignErrorResponse,
  EformsignActionResponse,
} from "./types";

const EFORMSIGN_SDK_URL = "https://www.eformsign.com/lib/js/efs_embedded_v2.js";
const JQUERY_URL = "https://www.eformsign.com/plugins/jquery/jquery.min.js";

interface UseEformsignResult {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  openDocument: (
    documentOption: EformsignDocumentOption,
    iframeId: string,
    callbacks?: {
      onSuccess?: (response: EformsignSuccessResponse) => void;
      onError?: (response: EformsignErrorResponse) => void;
      onAction?: (response: EformsignActionResponse) => void;
    }
  ) => void;
}

// Load script dynamically
const loadScript = (src: string, id: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    // Check if script already exists
    if (document.getElementById(id)) {
      resolve();
      return;
    }

    const script = document.createElement("script");
    script.id = id;
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(script);
  });
};

export function useEformsign(): UseEformsignResult {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadEformsignSDK = async () => {
      // Already loaded
      if (typeof window !== "undefined" && window.EformSignDocument) {
        setIsLoaded(true);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Load jQuery first (required by eformsign SDK)
        // Check if jQuery is already loaded
        if (typeof window !== "undefined" && !window.jQuery) {
          await loadScript(JQUERY_URL, "eformsign-jquery");
        }

        // Load eformsign SDK
        await loadScript(EFORMSIGN_SDK_URL, "eformsign-sdk");

        setIsLoaded(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load eformsign SDK");
      } finally {
        setIsLoading(false);
      }
    };

    loadEformsignSDK();
  }, []);

  const openDocument = useCallback(
    (
      documentOption: EformsignDocumentOption,
      iframeId: string,
      callbacks?: {
        onSuccess?: (response: EformsignSuccessResponse) => void;
        onError?: (response: EformsignErrorResponse) => void;
        onAction?: (response: EformsignActionResponse) => void;
      }
    ) => {
      if (!isLoaded || typeof window === "undefined" || !window.EformSignDocument) {
        console.error("Eformsign SDK is not loaded yet");
        return;
      }

      const eformsign: EformSignDocument = new window.EformSignDocument();

      const successCallback = (response: EformsignSuccessResponse) => {
        console.log("Eformsign success:", response);
        if (response.code === "-1") {
          callbacks?.onSuccess?.(response);
        }
      };

      const errorCallback = (response: EformsignErrorResponse) => {
        console.error("Eformsign error:", response);
        callbacks?.onError?.(response);
      };

      const actionCallback = (response: EformsignActionResponse) => {
        console.log("Eformsign action:", response);
        callbacks?.onAction?.(response);
      };

      eformsign.document(documentOption, iframeId, successCallback, errorCallback, actionCallback);
      eformsign.open();
    },
    [isLoaded]
  );

  return {
    isLoaded,
    isLoading,
    error,
    openDocument,
  };
}

// Extend Window interface for jQuery check
declare global {
  interface Window {
    jQuery?: unknown;
  }
}

