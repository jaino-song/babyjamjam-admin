import { ConfigService } from "@nestjs/config";

import { AligoApiClient } from "infrastructure/api/aligo-api.client";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import {
    createAligoPortClient,
    createEformsignClientRepository,
    E2eAligoApiStub,
    E2eEformsignClientStub,
} from "infrastructure/vendor-stubs/e2e-vendor-stubs";

function createConfigService(overrides: Record<string, string | undefined> = {}): ConfigService {
    return {
        get: jest.fn((key: string) => {
            const values: Record<string, string | undefined> = {
                ALIGO_API_KEY: "aligo-key",
                ALIGO_API_URL: "https://kakaoapi.aligo.in",
                ALIGO_SENDER_KEY: "aligo-sender-key",
                ALIGO_SENDER_PHONE: "01012345678",
                ALIGO_SMS_API_URL: "https://apis.aligo.in",
                ALIGO_USER_ID: "aligo-user",
                E2E_VENDOR_STUBS: "0",
                EFORMSIGN_API_KEY: "eformsign-key",
                EFORMSIGN_API_URL: "https://api.eformsign.example",
                EFORMSIGN_DOC_API_URL: "https://doc.eformsign.example",
                EFORMSIGN_PRIVATE_KEY: "00",
                EFORMSIGN_USER_EMAIL: "staff@example.com",
                ...overrides,
            };

            return values[key];
        }),
    } as unknown as ConfigService;
}

describe("vendor stub factory selection", () => {
    it("keeps real vendor clients when E2E_VENDOR_STUBS is off", () => {
        const configService = createConfigService();

        expect(createEformsignClientRepository(configService)).toBeInstanceOf(EformsignApiClient);
        expect(createAligoPortClient(configService)).toBeInstanceOf(AligoApiClient);
    });

    it("switches to stubbed vendor clients when E2E_VENDOR_STUBS is on", async () => {
        const configService = createConfigService({
            E2E_VENDOR_STUBS: "1",
            ALIGO_API_KEY: undefined,
            ALIGO_API_URL: undefined,
            ALIGO_SENDER_KEY: undefined,
            ALIGO_SENDER_PHONE: undefined,
            ALIGO_SMS_API_URL: undefined,
            ALIGO_USER_ID: undefined,
            EFORMSIGN_API_KEY: undefined,
            EFORMSIGN_API_URL: undefined,
            EFORMSIGN_DOC_API_URL: undefined,
            EFORMSIGN_PRIVATE_KEY: undefined,
            EFORMSIGN_USER_EMAIL: undefined,
        });

        const eformsignClient = createEformsignClientRepository(configService);
        const aligoClient = createAligoPortClient(configService);

        expect(eformsignClient).toBeInstanceOf(E2eEformsignClientStub);
        expect(aligoClient).toBeInstanceOf(E2eAligoApiStub);
        await expect(eformsignClient.getAllDocuments("ignored-token")).resolves.toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: "doc-create-test" }),
                expect.objectContaining({ id: "doc-finalize-test" }),
            ]),
        );
        await expect(aligoClient.sendSms({
            receiver: "01012345678",
            message: "테스트",
        })).resolves.toMatchObject({
            result_code: 1,
            error_cnt: 0,
            success_cnt: 1,
        });
    });
});
