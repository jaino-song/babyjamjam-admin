import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";

import type { EformsignLinkConfirmation } from "@/services/eformsign";
import { eformsignApi } from "@/services/api";
import { clientKeys } from "@/features/clients/hooks/keys";
import { clientsApi } from "@/features/clients/api/clients.api";
import { useDeleteEformsignDocument } from "@/hooks/useEformsignDocuments";
import { useEnqueueEformsignDocumentFinalization } from "@/hooks/useEformsignDocumentJobs";
import { queryKeyRootsForKinds } from "@/lib/realtime/entity-query-keys";

import { ContractLinkConfirmDialog } from "@/components/app/clients/ContractLinkConfirmDialog";

/**
 * SI-CONTRACT-08 — contract state → client view refresh on the desktop.
 *
 * The backend announces contract writes (`eformsign_doc`, `eformsign_document_job`,
 * `eformsign_dispatch_intent`) as the realtime kind `document`; the client list
 * renders that state (contract badges, `documentStatus`, `hasSigned`). These
 * tests assert which query keys the realtime refresh signal and the desktop
 * link-confirmation mutation actually invalidate, with a real QueryClient —
 * only the HTTP layer is mocked.
 */

const INTEGRITY_ID_PATTERN = /^SI-[A-Z]+-[0-9]{2}$/;

type IntegrityTestBody = () => Promise<void>;

function qualified(id: string, title: string): string {
    if (!INTEGRITY_ID_PATTERN.test(id)) {
        throw new Error(`integrity test id must match SI-<AREA>-<NN>, got "${id}"`);
    }
    return `${id} ${title}`;
}

/** An invariant that must hold today: a plain `it` with the id prefix. */
function invariant(id: string, title: string, body: IntegrityTestBody): void {
    it(qualified(id, title), body);
}

jest.mock("@/features/clients/api/clients.api", () => ({
    clientsApi: { update: jest.fn() },
}));

jest.mock("@/services/api", () => {
    const actual = jest.requireActual("@/services/api");
    return {
        ...actual,
        eformsignApi: {
            ...actual.eformsignApi,
            adoptDocument: jest.fn(),
            getLinkConfirmations: jest.fn(),
            deleteDocument: jest.fn(),
            enqueueDocumentFinalization: jest.fn(),
        },
    };
});

const adoptDocument = eformsignApi.adoptDocument as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    (clientsApi.update as jest.Mock).mockResolvedValue({ data: { id: 7 } });
    adoptDocument.mockResolvedValue({ documentId: "doc-1" });
    (eformsignApi.deleteDocument as jest.Mock).mockResolvedValue({});
    (eformsignApi.enqueueDocumentFinalization as jest.Mock).mockResolvedValue({
        jobId: "job-1", status: "queued", existing: false,
    });
});

describe("SI-CONTRACT-08 contract state → client view refresh (desktop)", () => {
    afterEach(cleanup);

    invariant(
        "SI-CONTRACT-08",
        "a `document` entity-changed event refreshes the client views that render contract state",
        async () => {
            const queryClient = new QueryClient();
            // The exact roots the app-shell realtime hook invalidates for the
            // backend's coalesced `entity-changed { entities: ["document"] }`.
            const roots = queryKeyRootsForKinds(["document"]);

            // The client list renders contract state (documentStatus, badges,
            // hasSigned) for the same client row, so a contract change must
            // reach it. TanStack prefix semantics: invalidating the document
            // roots must also refresh the seeded clients cache entry.
            queryClient.setQueryData(
                clientKeys.list({ branchId: "b1", page: 1, limit: 20 }),
                "cached",
            );
            for (const root of roots) {
                void queryClient.invalidateQueries({ queryKey: root });
            }

            const state = queryClient.getQueryState(clientKeys.list({ branchId: "b1", page: 1, limit: 20 }));
            if (state === undefined) {
                throw new Error("SI-CONTRACT-08: the clients list cache entry disappeared entirely");
            }
            if (!state.isInvalidated) {
                throw new Error("SI-CONTRACT-08: the clients list query was NOT invalidated by a `document` entity-changed event (its contract badges went stale)");
            }
        },
    );

    invariant(
        "SI-CONTRACT-08",
        "(control) the `client` entity-changed kind still refreshes the clients root",
        async () => {
            const roots = queryKeyRootsForKinds(["client"]);
            expect(roots.some((root) => root[0] === "clients")).toBe(true);
        },
    );

    invariant(
        "SI-CONTRACT-08",
        "the link-confirmation dialog mutation invalidates the clients root that renders contract status (mutation half of the hypothesis is refuted)",
        async () => {
            const entry: EformsignLinkConfirmation = {
                documentId: "doc-1",
                documentName: "서비스 계약서",
                statusType: "002",
                statusDetail: "고객 서명",
                createdDate: "2026-09-01T00:00:00.000Z",
                document: { name: "박계약", phone: "01011112222", birthday: "1990-01-02" },
                client: { id: 7, name: "김고객", phone: "01011112222", birthday: "1991-03-04" },
                differences: ["name", "birthday"],
                canConfirm: true,
            };
            let invalidations: QueryKey[] = [];
            const queryClient = new QueryClient();
            const originalInvalidate = queryClient.invalidateQueries.bind(queryClient);
            queryClient.invalidateQueries = ((...args: Parameters<typeof originalInvalidate>) => {
                invalidations = [...invalidations, (args[0]?.queryKey ?? []) as QueryKey];
                return originalInvalidate(...args);
            }) as typeof queryClient.invalidateQueries;

            render(
                <QueryClientProvider client={queryClient}>
                    <ContractLinkConfirmDialog
                        entry={entry}
                        clientId={7}
                        dataComponentPrefix="test_prefix"
                        onClose={() => undefined}
                    />
                </QueryClientProvider>,
            );
            // Keep the client values: no updateClient mutation can supply the
            // clients invalidation that this control attributes to adoption.
            fireEvent.click(screen.getByRole("radio", { name: "고객 정보: 김고객" }));
            fireEvent.click(screen.getByRole("radio", { name: "고객 정보: 1991-03-04" }));
            fireEvent.click(screen.getByRole("button", { name: "확정" }));

            await waitFor(() => expect(invalidations.some((key) => key[0] === "clients")).toBe(true));
            expect(clientsApi.update).not.toHaveBeenCalled();
            expect(adoptDocument).toHaveBeenCalledWith("doc-1", 7);
            expect(invalidations.some((key) => key[0] === "eformsign-documents")).toBe(true);
            cleanup();
        },
    );

    // Re-request is private page-local useMutation, not one of these hooks.
    // Register-client is excluded: its real useCreateClient invalidates clients.
    for (const operation of ["delete", "finalization"] as const) {
        invariant(
            "SI-CONTRACT-08",
            `the ${operation} hook invalidates the clients list that renders contract state`,
            async () => {
                const queryClient = new QueryClient({
                    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
                });
                const key = clientKeys.list({ branchId: "b1", page: 1, limit: 20 });
                const documentsKey = ["eformsign-documents", "all"] as const;
                queryClient.setQueryData(key, { data: [{ id: 7, hasSigned: false }] });
                queryClient.setQueryData(documentsKey, { documents: [], total_rows: 0 });
                const wrapper = ({ children }: PropsWithChildren) => (
                    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
                );
                const { result, unmount } = renderHook(() => ({
                    deleteDocument: useDeleteEformsignDocument(),
                    finalizeDocument: useEnqueueEformsignDocumentFinalization(),
                }), { wrapper });
                try {
                    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
                    await act(async () => {
                        if (operation === "delete") {
                            await result.current.deleteDocument.mutateAsync("doc-1");
                        } else {
                            await result.current.finalizeDocument.mutateAsync({
                                requestKey: "request-1", documentId: "doc-1",
                            });
                        }
                    });
                    if (operation === "delete") {
                        expect(eformsignApi.deleteDocument).toHaveBeenCalledWith("doc-1");
                    } else {
                        expect(eformsignApi.enqueueDocumentFinalization).toHaveBeenCalledWith({
                            requestKey: "request-1", documentId: "doc-1",
                        });
                    }
                    // This passing control proves the real mutation's cleanup
                    // ran before the clients-state assertion, not just HTTP.
                    expect(queryClient.getQueryState(documentsKey)?.isInvalidated).toBe(true);
                    expect(queryClient.getQueryState(key)).toBeDefined();
                    if (!queryClient.getQueryState(key)?.isInvalidated) {
                        throw new Error(`SI-CONTRACT-08: ${operation} succeeded but the clients list query was NOT invalidated`);
                    }
                } finally {
                    unmount();
                    queryClient.clear();
                }
            },
        );
    }
});
