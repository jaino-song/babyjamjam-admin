import { api } from "@/lib/api/client";
import { employeesApi } from "./employees.api";

jest.mock("@/lib/api/client", () => ({ api: { get: jest.fn() } }));

it("gets an employee through the query-id proxy", () => {
    employeesApi.getById(12);
    expect(api.get).toHaveBeenCalledWith("/employees/id", { params: { id: 12 } });
});
