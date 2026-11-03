import {
    SYSTEM_TEMPLATE_REGISTRY,
    SystemTemplateKey,
} from "domain/constants/system-template-registry";

describe("SYSTEM_TEMPLATE_REGISTRY", () => {
    it("lists the two recipient groups in the approved order with exact titles", () => {
        expect(Object.values(SystemTemplateKey).map((key) => {
            const entry = SYSTEM_TEMPLATE_REGISTRY[key];
            return [key, entry.name, entry.group, entry.groupLabel];
        })).toEqual([
            ["GREETING", "첫 인사", "mother", "산모 대상"],
            ["SERVICE_INFO", "서비스 내용 안내", "mother", "산모 대상"],
            ["PRICE_INFO", "서비스 비용 안내", "mother", "산모 대상"],
            ["REMINDER", "리마인드", "mother", "산모 대상"],
            ["THANKS", "입금 확인 및 예약 완료 안내", "mother", "산모 대상"],
            ["INFO", "산모 정보 요청", "mother", "산모 대상"],
            ["CONTRACT_GUIDE", "계약서 작성 안내", "mother", "산모 대상"],
            ["CONTRACT_REMINDER", "계약서 작성 요청", "mother", "산모 대상"],
            ["MATERNAL_NOTICE", "산모님 안내문", "mother", "산모 대상"],
            ["SERVICE_END_NOTICE", "서비스 종료 안내", "mother", "산모 대상"],
            ["SURVEY", "모니터링 설문", "mother", "산모 대상"],
            ["PROVIDER_NOTICE", "제공인력 안내문", "provider", "제공인력 대상"],
            ["SERVICE_RECORD_LINK", "제공기록지 작성 요청", "provider", "제공인력 대상"],
            ["SERVICE_RECORD_REMINDER", "제공기록지 미작성 알림", "provider", "제공인력 대상"],
        ]);
    });

    it.each(["CONTRACT_GUIDE", "MATERNAL_NOTICE", "PROVIDER_NOTICE", "SERVICE_RECORD_REMINDER"])(
        "creates %s with an empty body and no required variables", (key) => {
            expect(SYSTEM_TEMPLATE_REGISTRY[key as SystemTemplateKey]).toMatchObject({ defaultContent: "", requiredVariables: [] });
        },
    );
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
