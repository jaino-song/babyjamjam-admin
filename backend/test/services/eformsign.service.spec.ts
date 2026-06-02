import { ConfigService } from "@nestjs/config";

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
});
