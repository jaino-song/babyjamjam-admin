"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

const ENDPOINT = "/api/eformsign-docs/events";

/**
 * Subscribes to the backend's SSE stream of eformsign-docs mutations.
 * On every `docs-changed` event, invalidates the contracts list + client-name
 * caches so the list-panel refetches without a full page reload.
 *
 * `enabled` should be the current authentication state — pass `false` to skip
 * connecting (e.g. before the user has logged in).
 */
export function useEformsignDocsLiveStream(enabled: boolean): void {
    const queryClient = useQueryClient();

    useEffect(() => {
        if (!enabled) return;
        if (typeof window === "undefined") return;

        const source = new EventSource(ENDPOINT);

        const onChange = () => {
            queryClient.invalidateQueries({ queryKey: ["eformsign-documents"] });
            queryClient.invalidateQueries({ queryKey: ["eformsign-client-names"] });
        };

        source.addEventListener("docs-changed", onChange);

        return () => {
            source.removeEventListener("docs-changed", onChange);
            source.close();
        };
    }, [enabled, queryClient]);
}
