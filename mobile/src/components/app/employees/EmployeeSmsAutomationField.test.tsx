import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import NewEmployeePage from "@/app/(shell)/employees/new/page";
import { useEmployeeWizardStore } from "@/stores/employee-wizard-store";
import { api } from "@/lib/api/client";

const mockCreate = jest.fn();
const mockPush = jest.fn();
const mockSearchParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
    useRouter: () => ({ push: mockPush }),
    useSearchParams: () => mockSearchParams,
}));
jest.mock("@/hooks/use-navigation-pending", () => ({
    useNavigationPending: () => ({ isNavigationPending: false, startNavigation: jest.fn() }),
}));
jest.mock("@/hooks/useEmployees", () => ({
    useCreateEmployee: () => ({ mutateAsync: mockCreate, isPending: false }),
}));
jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

describe("SI-EMP-08 mobile wizard SMS setting", () => {
    beforeEach(() => {
        useEmployeeWizardStore.getState().reset();
        jest.clearAllMocks();
        jest.mocked(api.get).mockResolvedValue({ data: { exists: false } });
        mockCreate.mockResolvedValue({ id: 42 });
    });

    it("defaults to true, submits false after toggling, and resets to true", async () => {
        useEmployeeWizardStore.setState({
            currentStep: 1, name: "김관리", phone: "01012345678", workArea: ["인천 부평구"],
        });
        render(<NewEmployeePage />);
        const smsSwitch = screen.getByRole("switch", { name: "문자 자동 발송" });
        expect(smsSwitch).toBeChecked();
        fireEvent.click(smsSwitch);
        expect(smsSwitch).not.toBeChecked();
        expect(useEmployeeWizardStore.getState().smsAutomationEnabled).toBe(false);
        fireEvent.click(screen.getByRole("button", { name: "✓ 등록" }));
        await waitFor(() => expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            smsAutomationEnabled: false,
        })));
        expect(mockPush).toHaveBeenCalledWith("/employees?id=42");
        expect(useEmployeeWizardStore.getState().smsAutomationEnabled).toBe(true);
        await act(async () => { await Promise.resolve(); });
    });
});
