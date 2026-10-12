import { api } from "@/lib/api/client";
import { employeesApi } from "./employees.api";

jest.mock("@/lib/api/client", () => ({
    api: { get: jest.fn() },
}));

describe("employeesApi.getById", () => {
    it("calls the by-id proxy route with the id as a query param", async () => {
        (api.get as jest.Mock).mockResolvedValue({ data: { id: 12 } });

        await employeesApi.getById(12);

        expect(api.get).toHaveBeenCalledWith("/employees/id", { params: { id: 12 } });
    });
});
