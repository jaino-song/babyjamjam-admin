import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { EformsignLinkConfirmation } from "@/services/eformsign";
import { eformsignApi } from "@/services/api";
import { clientKeys } from "@/features/clients/hooks/keys";
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

/** Frontend twin of the backend `knownDefect` wrapper (it.failing + expectedFailure). */
function knownDefect(id: string, title: string, body: IntegrityTestBody, expectedFailure: RegExp | string): void {
    it.failing(qualified(id, title), async () => {
        try {
            await body();
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const matches = typeof expectedFailure === "string" ? message.includes(expectedFailure) : expectedFailure.test(message);
            if (matches) {
                throw error;
            }
            // A failure for any other reason must NOT count as the defect.
            return;
        }
        // The defect looks fixed — return normally so it.failing reports RED.
    });
}

jest.mock("@/features/clients/hooks/use-clients", () => ({
    useUpdateClient: () => ({ mutateAsync: mockUpdateMutateAsync }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        adoptDocument: jest.fn(),
        getLinkConfirmations: jest.fn(),
    },
}));

const mockUpdateMutateAsync = jest.fn();
const adoptDocument = eformsignApi.adoptDocument as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateMutateAsync.mockResolvedValue({});
    adoptDocument.mockResolvedValue({ documentId: "doc-1" });
});

describe("SI-CONTRACT-08 contract state → client view refresh (desktop)", () => {
    afterEach(cleanup);

    knownDefect(
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
        /NOT invalidated by a `document` entity-changed event/,
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
            fireEvent.click(screen.getByRole("radio", { name: "계약서: 박계약" }));
            fireEvent.click(screen.getByRole("radio", { name: "계약서: 1990-01-02" }));
            fireEvent.click(screen.getByRole("button", { name: "확정" }));

            await waitFor(() => expect(invalidations.some((key) => key[0] === "clients")).toBe(true));
            expect(invalidations.some((key) => key[0] === "eformsign-documents")).toBe(true);
            cleanup();
        },
    );
});
