import {
    SYSTEM_TEMPLATE_REGISTRY,
    SystemTemplateKey,
} from "domain/constants/system-template-registry";

describe("SYSTEM_TEMPLATE_REGISTRY", () => {
    it("has a registry entry whose key matches for every SystemTemplateKey", () => {
        for (const key of Object.values(SystemTemplateKey)) {
            expect(SYSTEM_TEMPLATE_REGISTRY[key]?.key).toBe(key);
        }
    });

    it("defines CONTRACT_REMINDER as a name-only manual template", () => {
        const contract = SYSTEM_TEMPLATE_REGISTRY[SystemTemplateKey.CONTRACT_REMINDER];

        expect(contract.name).toBe("계약서 작성 요청");
        expect(contract.requiredVariables).toEqual([
            { key: "name", label: "산모님 성함", type: "string", required: true },
        ]);
        expect(contract.defaultContent).toContain("{{name}}");
        expect(contract.defaultContent).not.toContain("{{client_name}");
    });
});
