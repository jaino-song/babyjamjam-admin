import { createEmployeeSchema } from "../tools/employee.tools";

describe("employee tool schemas", () => {
    it("should not require caller-supplied employee ids for creation", () => {
        const required = createEmployeeSchema.parameters.required ?? [];
        expect(required).not.toContain("id");
        expect(createEmployeeSchema.parameters.properties).not.toHaveProperty("id");
    });
});
