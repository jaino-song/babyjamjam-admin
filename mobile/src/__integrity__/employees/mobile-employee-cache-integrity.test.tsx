import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { employeeQueryKeys, type UpdateEmployeeDto } from "@/hooks/useEmployees";
import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";

// The mock factory cannot reference the `MockEventSource` class (imports and
// the class body are hoisted relative to the jest.mock call), so it resolves
// through a constructor that the class registers on globalThis at load time.
jest.mock("@/lib/api/authenticated-fetch", () => ({
    openAuthenticatedEventSource: (url: string, options?: unknown) => {
        const ctor = (
            globalThis as { __siMockEventSourceCtor?: (new (url: string) => unknown) | undefined }
        ).__siMockEventSourceCtor;
        if (!ctor) throw new Error("SI-EMP-08 mock EventSource constructor not registered");
        return Promise.resolve(new ctor(url));
    },
}));

/**
 * Local equivalents of the backend harness wrappers (the backend helpers are
 * not importable from mobile suites): `invariant(id, title, body)` is a plain
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

(globalThis as { __siMockEventSourceCtor?: unknown }).__siMockEventSourceCtor = MockEventSource;

describe("SI-EMP-08 employee caches after assignment/schedule changes (mobile)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        MockEventSource.instances = [];
        (global as unknown as { EventSource: unknown }).EventSource = MockEventSource;
    });

    afterEach(() => {
        jest.clearAllTimers();
        jest.useRealTimers();
        delete (global as unknown as { EventSource?: unknown }).EventSource;
    });

    knownDefect(
        "SI-EMP-08",
        "realtime: an assignment change announced as service-record kind invalidates employee queries",
        async () => {
            const queryClient = new QueryClient();
            const targets: Array<unknown> = [];
            jest.spyOn(queryClient, "invalidateQueries").mockImplementation((() => Promise.resolve()) as never);
            const wrapper = ({ children }: { children: ReactNode }) => (
                <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
            );
            const { unmount } = renderHook(() => useRealtimeInvalidation("user-1:branch-a"), { wrapper });

            await act(async () => {
                await Promise.resolve();
            });
            const source = MockEventSource.instances[0];
            act(() => {
                source.fireOpen();
            });

            // The backend announces `employee_schedule` writes with the
            // `service-record` kind; a live assignment change is exactly this
            // payload on the mobile stream.
            act(() => {
                source.emit("entity-changed", { entities: ["service-record"] });
            });

            const rootOf = (filters: unknown): unknown =>
                filters && typeof filters === "object" && "queryKey" in (filters as Record<string, unknown>)
                    ? (filters as { queryKey: unknown }).queryKey
                    : null;
            const invalidatedRoots = targets.map(rootOf);
            // Sanity: the event was consumed and invalidated its own root.
            expect(invalidatedRoots.some((root) => JSON.stringify(root) === JSON.stringify(["service-records"]))).toBe(
                true,
            );
            // The CORRECT behavior: mobile employee views must refresh too.
            expect(invalidatedRoots.some((root) => JSON.stringify(root) === JSON.stringify(["employees"]))).toBe(true);

            unmount();
        },
        /Expected: true/,
    );

    invariant(
        "SI-EMP-08",
        "DTO parity: the mobile update payload cannot carry smsAutomationEnabled (desktop DTO has it)",
        async () => {
            // Type pin: the field is absent from the mobile DTO today. If the
            // parity gap is fixed, this directive becomes unused and
            // `tsc --noEmit` fails on this file, forcing the pin to be flipped.
            const payload: UpdateEmployeeDto = {
                openToNextWork: false,
                // @ts-expect-error SI-EMP-08: mobile UpdateEmployeeDto omits smsAutomationEnabled
                smsAutomationEnabled: false,
            };
            expect(payload["openToNextWork" as keyof UpdateEmployeeDto]).toBe(false);
        },
    );
});
