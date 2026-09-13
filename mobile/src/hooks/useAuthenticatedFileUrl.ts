"use client";

import { useEffect, useState } from "react";

import { fetchAuthenticatedFileBlob } from "@/lib/files/authenticated-file";

interface AuthenticatedFileUrlState {
  url: string | null;
  loading: boolean;
  error: boolean;
}

interface LoadedAuthenticatedFileUrlState {
  sourceUrl: string;
  url: string | null;
  error: boolean;
}

const IDLE_STATE: AuthenticatedFileUrlState = {
  url: null,
  loading: false,
  error: false,
};

export function useAuthenticatedFileUrl(
  sourceUrl: string,
  enabled: boolean,
): AuthenticatedFileUrlState {
  const activeKey = enabled && sourceUrl ? sourceUrl : "";
  const [previousActiveKey, setPreviousActiveKey] = useState(activeKey);
  const [loadedState, setLoadedState] = useState<LoadedAuthenticatedFileUrlState>({
    sourceUrl: "",
    url: null,
    error: false,
  });

  if (activeKey !== previousActiveKey) {
    setPreviousActiveKey(activeKey);
    setLoadedState({ sourceUrl: "", url: null, error: false });
  }

  useEffect(() => {
    if (!enabled || !sourceUrl) return;

    const controller = new AbortController();
    let objectUrl: string | null = null;

    void fetchAuthenticatedFileBlob(sourceUrl, { signal: controller.signal })
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setLoadedState({ sourceUrl, url: objectUrl, error: false });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoadedState({ sourceUrl, url: null, error: true });
        }
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [enabled, sourceUrl]);

  if (!activeKey) return IDLE_STATE;
  if (loadedState.sourceUrl !== sourceUrl) {
    return { url: null, loading: true, error: false };
  }
  return {
    url: loadedState.url,
    loading: false,
    error: loadedState.error,
  };
}
