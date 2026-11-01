import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { employeeQueryKeys, useCreateEmployee } from "../useEmployees";

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
jest.mock("@/lib/api/client", () => ({ api: { post: jest.fn() } }));

describe("SI-EMP-10 mobile create response", () => {
    it.each([true, false, undefined])("shows a restore success toast only for restored=true (%s)", async (restored) => {
        mockToast.mockClear();
        const response = { id: 42, restored };
        jest.mocked(api.post).mockResolvedValue({ data: response });
        const client = new QueryClient();
        client.setQueryData(employeeQueryKeys.all, []);
        const wrapper = ({ children }: { children: ReactNode }) => (
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        );
        const { result, unmount } = renderHook(() => useCreateEmployee(), { wrapper });
        const dto = {
            name: "관리사", phone: "01012345678", workArea: ["인천 부평구"],
            grade: "스탠다드", openToNextWork: true, smsAutomationEnabled: false,
        };
        await act(async () => { expect(await result.current.mutateAsync(dto)).toEqual(response); });
        expect(api.post).toHaveBeenLastCalledWith("/employees", dto);
        expect(client.getQueryState(employeeQueryKeys.all)?.isInvalidated).toBe(true);
        if (restored === true) {
            expect(mockToast).toHaveBeenCalledTimes(1);
            expect(mockToast).toHaveBeenCalledWith({
                variant: "success", title: "삭제된 관리사를 복원했습니다",
            });
        } else {
            expect(mockToast).not.toHaveBeenCalled();
        }
        unmount();
        client.clear();
    });
});
