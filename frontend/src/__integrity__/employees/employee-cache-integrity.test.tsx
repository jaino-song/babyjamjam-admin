import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { clientQueryKeys, useUpdateClient } from "@/hooks/useClients";
import { employeeQueryKeys } from "@/hooks/useEmployees";
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { queryKeyRootsForKinds } from "@/lib/realtime/entity-query-keys";

jest.mock("@/lib/api/client", () => ({
    api: {
        patch: jest.fn().mockResolvedValue({
            data: { id: 7, name: "무결성 이용자", primaryEmployeeId: 3, secondaryEmployeeId: null },
        }),
    },
    redirectToLoginOnce: jest.fn().mockResolvedValue(undefined),
}));

/**
 * Local equivalents of the backend harness wrappers (the backend helpers are
 * not importable from frontend suites): `invariant(id, title, body)` is a plain
 * `it`; `knownDefect(id, title, body, expectedFailure)` inverts the expectation
 * (`it.failing`) but rethrows failures whose message does NOT match
 * `expectedFailure`, so a fixture or infra error turns RED instead of becoming
 * a green false-CONFIRMED. While the defect exists the knownDefect reports
 * green-as-expected-failure; after a fix lands it turns RED and the fixing unit
 * flips it to `invariant`.
 */

type IntegrityBody = () => Promise<void> | void;
type ExpectedFailure = RegExp | string;

async function assertDefectFailure(body: IntegrityBody, expectedFailure: ExpectedFailure): Promise<void> {
    let thrown: unknown;
    try {
        await body();
    } catch (error) {
        thrown = error;
    }
    if (thrown === undefined) return;
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    const matches =
        typeof expectedFailure === "string" ? message.includes(expectedFailure) : expectedFailure.test(message);
    if (matches) throw thrown;
    // eslint-disable-next-line no-console
    console.error(`[knownDefect] expected failure ${expectedFailure} but failed differently: ${message}`);
}

function knownDefect(id: string, title: string, body: IntegrityBody, expectedFailure: ExpectedFailure): void {
    it.failing(`${id} ${title}`, () => assertDefectFailure(body, expectedFailure));
}

function invariant(id: string, title: string, body: IntegrityBody): void {
    it(`${id} ${title}`, async () => {
        await body();
    });
}

/** jsdom has no EventSource — a controllable fake, mirroring the app's own stream-test harness. */
type SseListener = (event: { type: string; data?: string }) => void;

class MockEventSource {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    static instances: MockEventSource[] = [];

    readonly url: string;
    readyState = MockEventSource.CONNECTING;
    closed = false;
    private readonly listeners = new Map<string, Set<SseListener>>();

    constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
    }

    addEventListener(type: string, cb: SseListener): void {
        if (!this.listeners.has(type)) this.listeners.set(type, new Set());
        this.listeners.get(type)!.add(cb);
    }

    removeEventListener(type: string, cb: SseListener): void {
        this.listeners.get(type)?.delete(cb);
    }

    close(): void {
        this.closed = true;
        this.readyState = MockEventSource.CLOSED;
    }

    emit(type: string, data?: unknown): void {
        const event = { type, data: typeof data === "string" ? data : JSON.stringify(data ?? {}) };
        this.listeners.get(type)?.forEach((cb) => cb(event));
    }

    fireOpen(): void {
        this.readyState = MockEventSource.OPEN;
        this.emit("open");
    }
}

/**
 * Mounts the hook under test with a REAL `QueryClient`; the only thing mocked
 * is the HTTP transport (see the api mock above). Every `invalidateQueries`
 * call is RECORDED (the targets array) so a test can ask whether a given query
 * root was invalidated; the base implementation is stubbed so the seeded
 * queries (no fetcher attached) never refetch.
 */
function mountWithRealQueryClient(useHookUnderTest: () => unknown): {
    invalidationTargets: Array<unknown>;
    queryClient: QueryClient;
    hookResult: unknown;
    unmount: () => void;
} {
    const queryClient = new QueryClient();
    const invalidationTargets: Array<unknown> = [];
    jest.spyOn(queryClient, "invalidateQueries").mockImplementation(((filters: unknown) => {
        invalidationTargets.push(filters);
        return Promise.resolve();
    }) as never);
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => useHookUnderTest(), { wrapper });
    return { invalidationTargets, queryClient, hookResult: view.result.current, unmount: view.unmount };
}

const targetRoot = (filters: unknown): unknown => {
    if (filters && typeof filters === "object" && "queryKey" in (filters as Record<string, unknown>)) {
        return (filters as { queryKey: unknown }).queryKey;
    }
    return null;
};

const wasInvalidated = (targets: Array<unknown>, root: readonly unknown[]): boolean =>
    targets.map(targetRoot).some((candidate) => JSON.stringify(candidate) === JSON.stringify(root));

describe("SI-EMP-08 employee caches after assignment/schedule changes (desktop)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        MockEventSource.instances = [];
        (global as unknown as { EventSource: unknown }).EventSource = MockEventSource;
        (global as unknown as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({ status: 200 });
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        delete (global as unknown as { EventSource?: unknown }).EventSource;
        delete (global as unknown as { fetch?: unknown }).fetch;
    });

    knownDefect(
        "SI-EMP-08",
        "realtime: an assignment change announced as service-record kind invalidates employee queries",
        async () => {
            const { invalidationTargets, queryClient, unmount } = mountWithRealQueryClient(
                () => useRealtimeInvalidation(true),
            );
            queryClient.setQueryData(employeeQueryKeys.lists(), [
                { id: 3, name: "무결성 관리사", openToNextWork: true, status: "working" },
            ]);

            await act(async () => {
                await Promise.resolve();
            });
            const source = MockEventSource.instances[0];
            act(() => {
                source.fireOpen();
            });

            // The backend announces `employee_schedule` writes with the
            // `service-record` kind (entity-change.extension.ts); this is the
            // payload a stream listener receives for an assignment change.
            act(() => {
                source.emit("entity-changed", { entities: ["service-record"] });
            });

            // Sanity: the event was consumed and invalidated its own root.
            expect(wasInvalidated(invalidationTargets, ["service-records"])).toBe(true);
            // The correct behavior: employee queries (status is derived from
            // active assignments) must be invalidated too. The defect
            // assertion throws with a defect-specific message: `expectedFailure`
            // below matches THIS message and nothing else, so an infra/fixture
            // failure (whose "Expected: true"-shaped message does not match)
            // turns RED instead of a green false-CONFIRMED.
            if (!wasInvalidated(invalidationTargets, ["employees"])) {
                throw new Error(
                    "SI-EMP-08 defect: employee queries were not invalidated by the service-record entity-changed event",
                );
            }

            unmount();
        },
        /employee queries were not invalidated by the service-record entity-changed event/,
    );

    knownDefect(
        "SI-EMP-08",
        "acting user: a client update whose payload changes the assignment invalidates employee queries",
        async () => {
            const { invalidationTargets, hookResult, queryClient, unmount } = mountWithRealQueryClient(
                () => useUpdateClient(),
            );
            queryClient.setQueryData(employeeQueryKeys.lists(), [
                { id: 3, name: "무결성 관리사", openToNextWork: true, status: "working" },
            ]);
            queryClient.setQueryData(clientQueryKeys.lists(), [
                { id: 7, name: "무결성 이용자", primaryEmployeeId: 3, secondaryEmployeeId: null },
            ]);
            const updateClient = hookResult as {
                mutateAsync: (variables: { id: number; dto: Record<string, unknown> }) => Promise<unknown>;
            };

            await act(async () => {
                await updateClient.mutateAsync({
                    id: 7,
                    dto: { name: "무결성 이용자", primaryEmployeeId: 9, secondaryEmployeeId: null },
                });
            });

            // Sanity: the mutation success ran (client keys invalidated).
            expect(wasInvalidated(invalidationTargets, ["clients"])).toBe(true);
            // The defect: employee queries must be invalidated or not — the
            // response carries only the client row while employee status and
            // active-client views changed on the server. The defect-specific
            // message is the only one `expectedFailure` matches.
            if (!wasInvalidated(invalidationTargets, ["employees"])) {
                throw new Error(
                    "SI-EMP-08 defect: the useUpdateClient success handler does not invalidate employee queries after an assignment change",
                );
            }

            unmount();
        },
        /the useUpdateClient success handler does not invalidate employee queries after an assignment change/,
    );

    invariant(
        "SI-EMP-08",
        "realtime mapping evidence: the employee kind maps to employees roots, so the fix is a mapping change",
        async () => {
            const serviceRecordRoots = queryKeyRootsForKinds(["service-record"]);
            const employeeRoots = queryKeyRootsForKinds(["employee"]);
            // The mapping that today hides assignment changes from employee views:
            expect(JSON.stringify(serviceRecordRoots)).not.toContain('["employees"]');
            // The employee kind itself is mapped correctly, which is why adding
            // it to `employee_schedule` announcements is a small, safe fix.
            expect(JSON.stringify(employeeRoots)).toContain('["employees"]');
        },
    );
});
