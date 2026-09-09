import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";

import { EformsignService } from "application/services/eformsign.service";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import {
    EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME,
    EFORMSIGN_COMPLETED_REISSUE_CREATE_TEST_NAME,
    EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_FULL_TEST_NAME,
    EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_TEST_NAME,
    EFORMSIGN_COMPLETED_REISSUE_LEDGER_DIRECTORY,
    EFORMSIGN_COMPLETED_REISSUE_SUITE_NAME,
    fetchCompletedReissueTemplateConfig,
    isCompletedReissueLiveGate,
    runCompletedReissueProbe,
    verifyCompletedReissueFollowup,
} from "./helpers/eformsign-completed-reissue.live.helper";

const CREATE_LIVE = isCompletedReissueLiveGate(
    EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME,
);
const FOLLOWUP_LIVE = isCompletedReissueLiveGate(
    EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_FULL_TEST_NAME,
);
const LIVE_TEST_TIMEOUT_MS = 300_000;

function assertOfficialLiveOnly(): void {
    if (process.env["E2E_VENDOR_STUBS"] === "1") {
        throw new Error("completed reissue requires the official vendor API");
    }
}

async function createNarrowLiveModule(): Promise<{
    moduleRef: TestingModule;
    configService: ConfigService;
    eformsignClient: EformsignApiClient;
    eformsignService: EformsignService;
}> {
    const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true })],
        providers: [EformsignApiClient, EformsignService],
    }).compile();
    return {
        moduleRef,
        configService: moduleRef.get(ConfigService),
        eformsignClient: moduleRef.get(EformsignApiClient),
        eformsignService: moduleRef.get(EformsignService),
    };
}

(CREATE_LIVE ? describe : describe.skip)(EFORMSIGN_COMPLETED_REISSUE_SUITE_NAME, () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    it(EFORMSIGN_COMPLETED_REISSUE_CREATE_TEST_NAME, async () => {
        assertOfficialLiveOnly();
        const { moduleRef, configService, eformsignClient, eformsignService } = await createNarrowLiveModule();
        try {
            const tokenResponse = await eformsignClient.getAccessToken(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token.trim();
            if (!accessToken) throw new Error("completed reissue did not receive an access token");
            const result = await runCompletedReissueProbe({
                accessToken,
                api: eformsignClient,
                fileReader: eformsignService,
                templateReader: {
                    getTemplateConfig: (token, templateId) => fetchCompletedReissueTemplateConfig(
                        configService,
                        token,
                        templateId,
                    ),
                },
                ledgerDirectory: EFORMSIGN_COMPLETED_REISSUE_LEDGER_DIRECTORY,
            });
            console.info("[phase0-completed-reissue]", JSON.stringify(result));
            expect(result.status).toBe("created_visual_pending");
            expect(result.visualInspection).toBe("pending");
        } finally {
            await moduleRef.close();
        }
    });
});

(FOLLOWUP_LIVE ? describe : describe.skip)(EFORMSIGN_COMPLETED_REISSUE_SUITE_NAME, () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    it(EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_TEST_NAME, async () => {
        assertOfficialLiveOnly();
        const { moduleRef, eformsignClient, eformsignService } = await createNarrowLiveModule();
        try {
            const tokenResponse = await eformsignClient.getAccessToken(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token.trim();
            if (!accessToken) throw new Error("completed reissue followup did not receive an access token");
            const result = await verifyCompletedReissueFollowup({
                accessToken,
                api: eformsignClient,
                fileReader: eformsignService,
                ledgerDirectory: EFORMSIGN_COMPLETED_REISSUE_LEDGER_DIRECTORY,
            });
            console.info("[phase0-completed-reissue-followup]", JSON.stringify(result));
            expect(result.status).toBe("provider_stage_verified_visual_pending");
            expect(result.visualInspection).toBe("pending");
        } finally {
            await moduleRef.close();
        }
    });
});
