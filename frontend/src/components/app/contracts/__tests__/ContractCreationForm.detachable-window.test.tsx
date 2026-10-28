/**
 * The host may only close the form while the run awaits the first headless dispatch
 * (or the job enqueue); everywhere else a mounted form has follow-up work left. The
 * success footer waits for the verified HTTP result, not the progress stream.
 *
 * Rendering-based, mirroring ContractCreationForm.detached-send.test.tsx.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import type { Client } from "@/lib/client/types";
import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockAdoptDocument = jest.fn();
const mockSupersedeDocument = jest.fn();
const mockEnqueue = jest.fn();
const mockToast = jest.fn();
const mockFlags: Record<string, boolean> = { headlessDispatch: true, eformsignDocumentJobs: false };
let mockSseOnEvent: ((event: { data: string }) => void) | null = null;

jest.mock("@/hooks/use-toast", () => ({
    useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/lib/feature-flags", () => ({
    isFeatureEnabled: (flag: string) => mockFlags[flag] ?? false,
}));

jest.mock("@/hooks/useEformsignDocumentJobs", () => ({
    useEnqueueEformsignDocumentCreation: () => ({
        mutateAsync: (...args: unknown[]) => mockEnqueue(...args),
        isPending: false,
    }),
}));

jest.mock("@/hooks/useBusinessDayCalendar");
jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
    useLocale: () => "ko",
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
    useGetAuthUser: () => ({ data: { phone: "010-1234-5678" } }),
}));

jest.mock("@/hooks/useEformsign", () => ({
    useEformsign: () => ({
        isLoaded: true,
        isLoading: false,
        error: null,
        openDocument: mockOpenDocument,
    }),
}));

jest.mock("@/services/api", () => ({
    eformsignApi: {
        dispatchHeadless: (...args: unknown[]) => mockDispatchHeadless(...args),
        generateDocument: (...args: unknown[]) => mockGenerateDocument(...args),
        createDocRecord: jest.fn().mockResolvedValue({}),
        adoptDocument: (...args: unknown[]) => mockAdoptDocument(...args),
        supersedeDocument: (...args: unknown[]) => mockSupersedeDocument(...args),
    },
}));

const idleMutation = () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 42 }), isPending: false });
jest.mock("@/hooks/useClients", () => ({
    useCreateClient: () => idleMutation(),
    useUpdateClient: () => idleMutation(),
    useDeleteClient: () => idleMutation(),
    useAllClients: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
    useEmployees: () => ({ data: [], isLoading: false }),
}));

const mockAreaTemplates = [{
    id: "area-template-1",
    areaId: "인천",
    templateId: "template-1",
    templateName: "인천 산모 계약서",
}];

jest.mock("@/hooks", () => ({
    useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
    useVoucherYears: () => ({ data: [2026], isLoading: false }),
    useAreaTemplates: () => ({ data: mockAreaTemplates, isLoading: false }),
}));

jest.mock("@/lib/sse/reconnecting-event-source", () => ({
    createReconnectingEventSource: (options: { onEvent: (event: { data: string }) => void }) => {
        mockSseOnEvent = options.onEvent;
        return { close: jest.fn() };
    },
}));

const CONTRACT_INFO_STEP_INDEX = 3;
const DUPLICATE_PROMPT = "최근 생성된 진행 중 문서가 있습니다. 그래도 새로 생성하시겠습니까?";
const FAILURE_TOAST = {
    variant: "destructive",
    description: "전자문서 발송에 실패했어요. 계약서 목록에서 상태를 확인해 주세요.",
};

function seedValidContractForm(): void {
    useFormStore.setState({
        clientId: 42,
        isManualEntry: false,
        name: "송진호",
        phone: "010-6621-1878",
        birthday: "960414",
        dueDate: "",
        address: "인천시 강다",
        employeeId: 7,
        employeeName: "김정인",
        employeePhone: "01057871878",
        showEmployee2: false,
        employee2Id: null,
        startDate: "2026-08-05",
        endDate: "2026-08-25",
        paymentDate: "2026-08-05",
        fullPrice: "1000000",
        grant: "800000",
        actualPrice: "200000",
        voucherType: "일반",
        voucherDuration: "15",
        area: "인천",
    });
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeCallbacks() {
    return {
        onClose: jest.fn(),
        onSuccess: jest.fn(),
        onSessionStateChange: jest.fn(),
        onSubmissionStateChange: jest.fn(),
        onProcessingFailureChange: jest.fn(),
        onDetachableChange: jest.fn(),
    };
}

function renderForm(
    callbacks: ReturnType<typeof makeCallbacks>,
    options: { activeStepSpy?: jest.Mock; initialClient?: Client; supersedeDocumentId?: string } = {},
) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Harness() {
        const [activeStep, setActiveStep] = useState(CONTRACT_INFO_STEP_INDEX);
        return (
            <ContractCreationForm
                activeStep={activeStep}
                onActiveStepChange={(step) => {
                    options.activeStepSpy?.(step);
                    setActiveStep(step);
                }}
                initialClient={options.initialClient}
                supersedeDocumentId={options.supersedeDocumentId}
                {...callbacks}
            />
        );
    }
    return render(
        <QueryClientProvider client={queryClient}>
            <Harness />
        </QueryClientProvider>,
    );
}

const lastDetachable = (callbacks: ReturnType<typeof makeCallbacks>) =>
    callbacks.onDetachableChange.mock.calls.at(-1)?.[0];

async function submit() {
    fireEvent.click(screen.getByTestId("contract-creation-submit"));
}

async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
    });
}

describe("ContractCreationForm — detachable window and verified footer", () => {
    beforeAll(() => {
        class ResizeObserverMock {
            observe = jest.fn();
            unobserve = jest.fn();
            disconnect = jest.fn();
        }
        global.ResizeObserver = ResizeObserverMock;
        Element.prototype.scrollIntoView = jest.fn();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockFlags.headlessDispatch = true;
        mockFlags.eformsignDocumentJobs = false;
        mockSseOnEvent = null;
        mockGenerateDocument.mockResolvedValue({ document: { id: "tpl-1" }, user_data: {} });
        mockAdoptDocument.mockResolvedValue({ documentId: "doc-remote-9" });
        mockSupersedeDocument.mockResolvedValue(undefined);
        seedValidContractForm();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("hides the success footer until the dispatch result is verified, then supersedes once on a re-issue", async () => {
        const pending = createDeferred<unknown>();
        mockDispatchHeadless.mockReturnValue(pending.promise);
        const callbacks = makeCallbacks();
        // Mirrors the seeded form so the client-diff confirmation does not interpose.
        const initialClient = {
            id: 42,
            name: "송진호",
            phone: "010-6621-1878",
            birthday: "960414",
            address: "인천시 강다",
            dueDate: null,
            birthDate: null,
            primaryEmployee: { id: 7, name: "김정인" },
            secondaryEmployee: null,
            type: "일반",
            duration: 15,
            fullPrice: "1000000",
            grant: "800000",
            actualPrice: "200000",
            startDate: "2026-08-05",
            endDate: "2026-08-25",
            areaId: "인천",
        } as unknown as Client;
        renderForm(callbacks, { initialClient, supersedeDocumentId: "doc-old-1" });
        // The prefill effect resets the store for the re-issued client; reseed the form.
        act(() => seedValidContractForm());
        await submit();
        await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1), { timeout: 5000 });

        // The progress stream reports "sent" before the HTTP result is back.
        act(() => {
            mockSseOnEvent?.({ data: JSON.stringify({ step: "sent" }) });
        });
        await settle();
        expect(screen.queryByTestId("contract-creation-done")).not.toBeInTheDocument();
        expect(screen.queryByTestId("contract-creation-new-send")).not.toBeInTheDocument();
        expect(mockSupersedeDocument).not.toHaveBeenCalled();

        await act(async () => {
            pending.resolve({ ok: true, documentId: "doc-1", durationMs: 5 });
        });

        expect(await screen.findByTestId("contract-creation-done")).toBeInTheDocument();
        expect(screen.getByTestId("contract-creation-new-send")).toBeInTheDocument();
        await waitFor(() => expect(mockSupersedeDocument).toHaveBeenCalledTimes(1));
        expect(mockSupersedeDocument).toHaveBeenCalledWith("doc-old-1", 42);
    });

    it("is detachable only while awaiting the initial dispatch", async () => {
        const pending = createDeferred<unknown>();
        mockDispatchHeadless.mockReturnValue(pending.promise);
        const callbacks = makeCallbacks();
        renderForm(callbacks);
        expect(lastDetachable(callbacks)).toBe(false);

        await submit();
        await waitFor(() => expect(lastDetachable(callbacks)).toBe(true));

        await act(async () => {
            pending.resolve({ ok: true, documentId: "doc-1", durationMs: 5 });
        });
        await waitFor(() => expect(lastDetachable(callbacks)).toBe(false));
    });

    it("is not detachable while a partial-apply adoption is pending", async () => {
        const adopt = createDeferred<unknown>();
        mockAdoptDocument.mockReturnValue(adopt.promise);
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "local_persist_failed",
            outcome: "PARTIALLY_APPLIED",
            remoteDocumentId: "doc-remote-9",
            durationMs: 5,
        });
        const callbacks = makeCallbacks();
        renderForm(callbacks);

        await submit();
        await waitFor(() => expect(mockAdoptDocument).toHaveBeenCalledTimes(1), { timeout: 5000 });

        expect(lastDetachable(callbacks)).toBe(false);
    });

    it("is not detachable while the forced duplicate dispatch is pending", async () => {
        const forced = createDeferred<unknown>();
        mockDispatchHeadless
            .mockResolvedValueOnce({
                ok: false,
                reason: "duplicate_pending_document",
                outcome: "NOT_APPLIED",
                durationMs: 5,
            })
            .mockReturnValueOnce(forced.promise);
        const callbacks = makeCallbacks();
        renderForm(callbacks);

        await submit();
        expect(await screen.findByText(DUPLICATE_PROMPT)).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "확인" }));
        await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(2), { timeout: 5000 });

        expect(lastDetachable(callbacks)).toBe(false);
    });

    it("is not detachable while the manual editor option is being generated", async () => {
        const generating = createDeferred<unknown>();
        mockGenerateDocument.mockReturnValue(generating.promise);
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "chromium crashed",
            fallbackHint: "iframe",
            durationMs: 5,
        });
        const callbacks = makeCallbacks();
        renderForm(callbacks);

        await submit();
        await waitFor(() => expect(mockGenerateDocument).toHaveBeenCalledTimes(1), { timeout: 5000 });

        expect(lastDetachable(callbacks)).toBe(false);
    });

    it("is detachable only while the job enqueue is pending", async () => {
        mockFlags.eformsignDocumentJobs = true;
        const enqueue = createDeferred<unknown>();
        mockEnqueue.mockReturnValue(enqueue.promise);
        const callbacks = makeCallbacks();
        renderForm(callbacks);

        await submit();
        await waitFor(() => expect(lastDetachable(callbacks)).toBe(true));

        await act(async () => {
            enqueue.resolve({ id: "job-1" });
        });
        await waitFor(() => expect(lastDetachable(callbacks)).toBe(false));
        expect(callbacks.onSuccess).toHaveBeenCalledTimes(1);
    });

    it("reports a rejected enqueue by toast without driving the parent when closed meanwhile", async () => {
        mockFlags.eformsignDocumentJobs = true;
        const enqueue = createDeferred<unknown>();
        mockEnqueue.mockReturnValue(enqueue.promise);
        const callbacks = makeCallbacks();
        const activeStepSpy = jest.fn();
        const view = renderForm(callbacks, { activeStepSpy });

        await submit();
        await waitFor(() => expect(mockEnqueue).toHaveBeenCalledTimes(1), { timeout: 5000 });
        view.unmount();
        activeStepSpy.mockClear();
        callbacks.onSubmissionStateChange.mockClear();

        await act(async () => {
            enqueue.reject(new Error("queue down"));
        });
        await settle();

        expect(mockToast).toHaveBeenCalledWith(FAILURE_TOAST);
        expect(activeStepSpy).not.toHaveBeenCalled();
        expect(callbacks.onSubmissionStateChange).not.toHaveBeenCalled();
        expect(callbacks.onSuccess).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
    });

    it("does not start the manual fallback when the form unmounts before its timer fires", async () => {
        const pending = createDeferred<unknown>();
        mockDispatchHeadless.mockReturnValue(pending.promise);
        const callbacks = makeCallbacks();
        const view = renderForm(callbacks);
        await submit();
        await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(1), { timeout: 5000 });

        // Hold back the deferred fallback so the form can unmount before it fires.
        const realSetTimeout = global.setTimeout;
        const heldTimers: Array<() => void> = [];
        jest.spyOn(global, "setTimeout").mockImplementation(((handler: () => void, delay?: number, ...rest: unknown[]) => {
            if (delay === 0) {
                heldTimers.push(handler);
                return 0 as unknown as ReturnType<typeof setTimeout>;
            }
            return realSetTimeout(handler, delay, ...rest);
        }) as typeof setTimeout);

        await act(async () => {
            pending.resolve({ ok: false, reason: "chromium crashed", fallbackHint: "iframe", durationMs: 5 });
        });
        expect(heldTimers.length).toBeGreaterThan(0);

        view.unmount();
        callbacks.onSubmissionStateChange.mockClear();
        await act(async () => {
            heldTimers.forEach((handler) => handler());
        });
        await settle();

        expect(mockGenerateDocument).not.toHaveBeenCalled();
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(callbacks.onSubmissionStateChange).not.toHaveBeenCalled();
    });

    it("toasts and leaves the parent alone when manual generation fails after unmount", async () => {
        const generating = createDeferred<unknown>();
        mockGenerateDocument.mockReturnValue(generating.promise);
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "chromium crashed",
            fallbackHint: "iframe",
            durationMs: 5,
        });
        const callbacks = makeCallbacks();
        const activeStepSpy = jest.fn();
        const view = renderForm(callbacks, { activeStepSpy });
        await submit();
        await waitFor(() => expect(mockGenerateDocument).toHaveBeenCalledTimes(1), { timeout: 5000 });

        view.unmount();
        activeStepSpy.mockClear();
        callbacks.onSubmissionStateChange.mockClear();
        await act(async () => {
            generating.reject(new Error("generate failed"));
        });
        await settle();

        expect(mockToast).toHaveBeenCalledWith(FAILURE_TOAST);
        expect(activeStepSpy).not.toHaveBeenCalled();
        expect(callbacks.onSubmissionStateChange).not.toHaveBeenCalled();
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(callbacks.onClose).not.toHaveBeenCalled();
    });
});
