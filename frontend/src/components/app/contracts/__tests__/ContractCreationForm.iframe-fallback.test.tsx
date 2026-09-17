/**
 * The headless dispatch is allowed to fail — what must never happen is staff
 * being stranded on a dead processing step. These tests drive the real component
 * through a failing dispatch and assert the eformsign editor actually opens,
 * i.e. `openDocument(..., "eformsign_iframe", ...)` is called.
 *
 * Both failure shapes are covered, because they reach the fallback through
 * different branches:
 *   - backend answered `ok:false` + `fallbackHint:"iframe"`  (verdict known)
 * A transport failure is different: the verdict is unknown, so automatically
 * reopening the editor could create a second contract and is forbidden.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";

import { useFormStore } from "@/stores/form-store";
import { ContractCreationForm } from "../ContractCreationForm";

const mockOpenDocument = jest.fn();
const mockDispatchHeadless = jest.fn();
const mockGenerateDocument = jest.fn();
const mockAuthenticate = jest.fn();
const mockCreateClient = jest.fn();
const mockUpdateClient = jest.fn();
const mockAreaTemplates = [{
    id: "area-template-1",
    areaId: "인천",
    templateId: "template-1",
    templateName: "인천 산모 계약서",
}];

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
        authenticate: (...args: unknown[]) => mockAuthenticate(...args),
        dispatchHeadless: (...args: unknown[]) => mockDispatchHeadless(...args),
        generateDocument: (...args: unknown[]) => mockGenerateDocument(...args),
        createDocRecord: jest.fn().mockResolvedValue({}),
        adoptDocument: jest.fn().mockResolvedValue({}),
    },
}));

jest.mock("@/hooks/useClients", () => ({
    useCreateClient: () => ({ mutateAsync: mockCreateClient, isPending: false }),
    useUpdateClient: () => ({ mutateAsync: mockUpdateClient, isPending: false }),
    useDeleteClient: () => ({ mutateAsync: jest.fn().mockResolvedValue({ id: 42 }), isPending: false }),
}));

jest.mock("@/hooks/useEmployees", () => ({
    useEmployees: () => ({ data: [], isLoading: false }),
}));

jest.mock("@/hooks", () => ({
    useVoucherPriceInfos: () => ({ data: [], isLoading: false }),
    useVoucherYears: () => ({ data: [2026], isLoading: false }),
    useAreaTemplates: () => ({ data: mockAreaTemplates, isLoading: false }),
}));

// The SSE channel is orthogonal here; a no-op source keeps the dispatch path
// from touching EventSource, which jsdom does not implement.
jest.mock("@/lib/sse/reconnecting-event-source", () => ({
    createReconnectingEventSource: () => ({ close: jest.fn() }),
}));

const CONTRACT_INFO_STEP_INDEX = 3;

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

function renderForm(props: { onProcessingFailureChange?: (failed: boolean) => void } = {}) {
    const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Harness() {
        const [activeStep, setActiveStep] = useState(CONTRACT_INFO_STEP_INDEX);
        return (
            <ContractCreationForm
                activeStep={activeStep}
                onActiveStepChange={setActiveStep}
                onProcessingFailureChange={props.onProcessingFailureChange}
            />
        );
    }
    return render(
        <QueryClientProvider client={queryClient}>
            <Harness />
        </QueryClientProvider>,
    );
}

async function submitAndExpectIframeOpens() {
    fireEvent.click(screen.getByTestId("contract-creation-submit"));

    await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalled(), { timeout: 5000 });
    // The manual re-entry is deferred a tick and then waits 500ms before opening,
    // so give the assertion room rather than racing it.
    await waitFor(() => expect(mockOpenDocument).toHaveBeenCalled(), { timeout: 5000 });

    expect(mockOpenDocument).toHaveBeenCalledWith(
        expect.anything(),
        "eformsign_iframe",
        expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    );
}

describe("ContractCreationForm — eformsign iframe fallback on headless failure", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockAuthenticate.mockResolvedValue({ success: true });
        mockCreateClient.mockResolvedValue({ id: 42 });
        mockUpdateClient.mockResolvedValue({ id: 42 });
        mockGenerateDocument.mockResolvedValue({ document: { id: "tpl-1" }, user_data: {} });
        seedValidContractForm();
    });

    it("opens the embedded iframe when the backend reports a definite failure", async () => {
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            reason: "Timed out after 100000ms while advancing eformsign creation gates",
            fallbackHint: "iframe",
            failedStep: "client-started",
            durationMs: 100000,
        });

        renderForm();
        await submitAndExpectIframeOpens();

        // The second run must be the manual one — otherwise we would have looped
        // back into another headless attempt instead of opening the editor.
        expect(mockDispatchHeadless).toHaveBeenCalledTimes(1);
        expect(mockGenerateDocument).toHaveBeenCalled();
    });

    it.each([
        "template_workflow_config_invalid",
        "template_workflow_unsupported",
        "template_workflow_config_unavailable",
    ])("keeps %s on the retry path without opening the iframe", async (reason) => {
        mockDispatchHeadless
            .mockResolvedValueOnce({ ok: false, reason, failedStep: "client-started", durationMs: 1 })
            .mockResolvedValueOnce({ ok: true, documentId: "doc-retried", durationMs: 1 });

        renderForm();
        fireEvent.click(screen.getByTestId("contract-creation-submit"));

        await waitFor(() => expect(screen.getByText(/이번 요청에서 계약서를 발송하지 않았어요/)).toBeInTheDocument());
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(screen.getByTestId("contract-creation-retry")).toBeEnabled();

        fireEvent.click(screen.getByTestId("contract-creation-retry"));
        await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(2));
        expect(mockOpenDocument).not.toHaveBeenCalled();
        expect(mockCreateClient).not.toHaveBeenCalled();
        expect(mockUpdateClient).toHaveBeenCalledTimes(1);
    });

    it("updates the retained client before retry when date and assignment values change", async () => {
        mockDispatchHeadless
            .mockResolvedValueOnce({
                ok: false,
                reason: "template_workflow_config_unavailable",
                failedStep: "client-started",
                durationMs: 1,
            })
            .mockResolvedValueOnce({ ok: true, documentId: "doc-retried", durationMs: 1 });

        renderForm();
        fireEvent.click(screen.getByTestId("contract-creation-submit"));
        await waitFor(() => expect(screen.getByText(/이번 요청에서 계약서를 발송하지 않았어요/)).toBeInTheDocument());

        act(() => {
            useFormStore.setState({
                employeeId: 8,
                employeeName: "박수정",
                employeePhone: "01011112222",
                startDate: "2026-08-06",
                endDate: "2026-08-26",
            });
        });

        fireEvent.click(screen.getByTestId("contract-creation-retry"));
        await waitFor(() => expect(mockDispatchHeadless).toHaveBeenCalledTimes(2));

        expect(mockCreateClient).not.toHaveBeenCalled();
        expect(mockUpdateClient).toHaveBeenCalledTimes(2);
        expect(mockUpdateClient.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            id: 42,
            dto: expect.objectContaining({
                primaryEmployeeId: 8,
                startDate: "2026-08-06",
            }),
        }));
        const updatedClientDto = mockUpdateClient.mock.calls[1]?.[0]?.dto as { endDate?: string };
        expect(mockDispatchHeadless.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
            caretaker1Name: "박수정",
            caretaker1Contact: "01011112222",
            startDate: "2026-08-06",
            endDate: updatedClientDto.endDate,
        }));
        expect(mockDispatchHeadless.mock.calls[1]?.[1]).toBe(42);
    });

    it("does not open the embedded iframe when the dispatch request itself fails", async () => {
        mockDispatchHeadless.mockRejectedValue(new Error("timeout of 180000ms exceeded"));

        renderForm();
        fireEvent.click(screen.getByTestId("contract-creation-submit"));

        await waitFor(() => {
            expect(screen.getByText(/전자문서 목록에서 생성 여부를 먼저 확인/)).toBeInTheDocument();
        });
        await new Promise((resolve) => setTimeout(resolve, 700));
        expect(mockOpenDocument).not.toHaveBeenCalled();
    });

    it("marks an unfinished run failed when the embedded editor is closed", async () => {
        mockDispatchHeadless.mockResolvedValue({
            ok: false,
            fallbackHint: "iframe",
            failedStep: "client-started",
        });
        const onProcessingFailureChange = jest.fn();

        renderForm({ onProcessingFailureChange });
        await submitAndExpectIframeOpens();
        fireEvent.click(screen.getByRole("button", { name: "계약서 작성 닫기" }));

        await waitFor(() => {
            expect(onProcessingFailureChange).toHaveBeenLastCalledWith(true);
        });
    });
});
