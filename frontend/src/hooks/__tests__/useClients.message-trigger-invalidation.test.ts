import { useMutation, useQueryClient } from "@tanstack/react-query";

import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import { employeeQueryKeys } from "@/hooks/useEmployees";
import { clientQueryKeys, useCreateClient, useUpdateClient } from "../useClients";

jest.mock("@tanstack/react-query", () => ({
    useMutation: jest.fn((options) => options),
    useQuery: jest.fn(),
    useInfiniteQuery: jest.fn(),
    useQueryClient: jest.fn(),
}));

// Legacy hooks must refresh the 알림 발송 목록 right away, like the features/clients ones do.
describe("legacy client mutation message job invalidation", () => {
    const invalidateQueries = jest.fn();
    const setQueriesData = jest.fn();
    const setQueryData = jest.fn();

    beforeEach(() => {
        jest.clearAllMocks();
        (useMutation as jest.Mock).mockImplementation((options) => options);
        (useQueryClient as jest.Mock).mockReturnValue({
            invalidateQueries,
            setQueriesData,
            setQueryData,
        });
    });

    it("invalidates upcoming jobs after creating a client", async () => {
        const mutation = useCreateClient() as unknown as { onSuccess: () => Promise<void> };

        await mutation.onSuccess();

        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: clientQueryKeys.all });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.upcoming() });
    });

    it("invalidates upcoming jobs after updating a client", async () => {
        const mutation = useUpdateClient() as unknown as {
            onSuccess: (client: { id: number }, variables: { id: number; dto: object }) => Promise<void>;
        };

        await mutation.onSuccess({ id: 42 }, { id: 42, dto: {} });

        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: clientQueryKeys.all });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: messageTriggerKeys.upcoming() });
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: serviceRecordKeys.clientOverview(42) });
        expect(invalidateQueries).not.toHaveBeenCalledWith({ queryKey: employeeQueryKeys.all });
    });

    it.each([{ primaryEmployeeId: 9 }, { primaryEmployeeId: null }, { secondaryEmployeeId: 9 }, { secondaryEmployeeId: null }])(
        "invalidates employee views when assignment fields are supplied: %j", async (dto) => {
            const mutation = useUpdateClient() as unknown as {
                onSuccess: (client: { id: number }, variables: { id: number; dto: object }) => Promise<void>;
            };

            await mutation.onSuccess({ id: 42 }, { id: 42, dto });

            expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: employeeQueryKeys.all });
        },
    );
});
