import { useQuery } from "@tanstack/react-query";

import { useMessageHistory } from "./use-message-triggers";
import { messageTriggerKeys } from "./keys";

jest.mock("@tanstack/react-query", () => ({
    useQuery: jest.fn(),
}));

const mockedUseQuery = jest.mocked(useQuery);

describe("useMessageHistory active-tab refresh", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockedUseQuery.mockReturnValue({
            data: [],
            isLoading: false,
            isError: false,
        } as never);
    });

    it("disables the global history request when the client messages tab is inactive", () => {
        useMessageHistory(500, {
            enabled: false,
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
        });

        expect(mockedUseQuery).toHaveBeenCalledWith(expect.objectContaining({
            queryKey: messageTriggerKeys.history(500),
            enabled: false,
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
            refetchOnMount: "always",
        }));
    });

    it("polls and refetches on focus while the client messages tab is active", () => {
        useMessageHistory(500, {
            enabled: true,
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
        });

        expect(mockedUseQuery).toHaveBeenCalledWith(expect.objectContaining({
            queryKey: messageTriggerKeys.history(500),
            enabled: true,
            refetchInterval: 30_000,
            refetchOnWindowFocus: true,
        }));
    });
});
