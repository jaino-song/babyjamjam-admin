import { ConfigService } from "@nestjs/config";

import { ContractDataDto } from "application/dto/contract.dto";
import { EformsignService } from "application/services/eformsign.service";

describe("EformsignService", () => {
    const configService = {
        get: jest.fn((key: string) => {
            const values: Record<string, string> = {
                EFORMSIGN_USER_EMAIL: "staff@example.com",
                EFORMSIGN_API_URL: "https://api.eformsign.example",
                EFORMSIGN_DOC_API_URL: "https://doc.eformsign.example",
                EFORMSIGN_API_KEY: "api-key",
                EFORMSIGN_PRIVATE_KEY: "00",
                EFORMSIGN_COMPANY_ID: "company-1",
                EFORMSIGN_TEMPLATE_ID: "template-1",
            };

            return values[key];
        }),
    } as unknown as ConfigService;

    it("sorts merged document lists by eformsign created_date newest first", async () => {
        const service = new EformsignService(configService);

        jest.spyOn(service, "getInProgressDocuments").mockResolvedValue({
            documents: [
                { id: "older", created_date: 1780000000000 },
                { id: "duplicate", created_date: 1780000003000 },
            ],
        });
        jest.spyOn(service, "getCompletedDocuments").mockResolvedValue({
            documents: [
                { id: "newest", created_date: 1780000005000 },
                { id: "duplicate", created_date: 1780000003000 },
            ],
        });
        jest.spyOn(service, "getRejectedDocuments").mockResolvedValue({
            documents: [
                { id: "middle", created_date: 1780000001000 },
            ],
        });

        const result = await service.getAllDocuments("access-token");

        expect(result.documents.map((document) => document.id)).toEqual([
            "newest",
            "duplicate",
            "middle",
            "older",
        ]);
        expect(result.total_rows).toBe(4);
    });

    it("uses payment collection date fields and reviewer step for provider confirmation", () => {
        const service = new EformsignService(configService);
        const contractData: ContractDataDto = {
            customerName: "김정인",
            customerContact: "010-1234-5678",
            customerDOB: "900101",
            customerAddress: "인천 서구",
            caretaker1Name: "이관리",
            caretaker1Contact: "010-9999-8888",
            type: "A통합3형",
            days: "15",
            area: "Seogu",
            contractDuration: "2026-06-03 ~ 2026-06-23",
            startYear: "26",
            startMonth: "06",
            startDay: "03",
            startDate: "2026-06-03",
            endYear: "26",
            endMonth: "06",
            endDay: "23",
            endDate: "2026-06-23",
            paymentYear: "26",
            paymentMonth: "06",
            paymentDay: "03",
            fullPrice: "1000000",
            grant: "800000",
            actualPrice: "200000",
        };

        const options = service.generateDocumentOptions(
            contractData,
            "access-token",
            "refresh-token",
            "template-seogu",
        );

        expect(options.prefill.fields).toEqual(
            expect.arrayContaining([
                { id: "이용자 생년월일", value: "900101", enabled: true },
                { id: "본인부담금 수령 년도", value: "26" },
                { id: "본인부담금 수령 월", value: "06" },
                { id: "본인부담금 수령 일", value: "03" },
            ]),
        );
        expect(options.prefill.fields.map((field) => field.id)).not.toEqual(
            expect.arrayContaining(["영수증 년도", "영수증 월", "영수증 일"]),
        );
        expect(options.prefill.recipients).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    step_idx: "3",
                    step_type: "06",
                    name: "제공기관 확인",
                }),
            ]),
        );
    });
});
