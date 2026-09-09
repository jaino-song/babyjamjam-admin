import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";

import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import {
    assertCompletedReissueTemplateTopology,
    EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
    fetchCompletedReissueTemplateConfig,
    isCompletedReissueLiveGate,
} from "./helpers/eformsign-completed-reissue.live.helper";
import {
    EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME,
    EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_TEST_NAME,
    EFORMSIGN_DRAFT_DIAGNOSTIC_LEDGER_DIRECTORY,
    EFORMSIGN_DRAFT_DIAGNOSTIC_SUITE_NAME,
    assertDraftDiagnosticOfficialLiveOrigins,
    runDraftDiagnostic,
} from "./helpers/eformsign-draft-diagnostic.live.helper";

const LIVE = isCompletedReissueLiveGate(EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME);
const LIVE_TEST_TIMEOUT_MS = 300_000;

function assertOfficialLiveOnly(): void {
    if (process.env["E2E_VENDOR_STUBS"] === "1") throw new Error("draft diagnostic requires the official vendor API");
}

async function createNarrowLiveModule(): Promise<{
    moduleRef: TestingModule;
    configService: ConfigService;
    eformsignClient: EformsignApiClient;
}> {
    const moduleRef = await Test.createTestingModule({
        imports: [ConfigModule.forRoot({ isGlobal: true })],
        providers: [EformsignApiClient],
    }).compile();
    return {
        moduleRef,
        configService: moduleRef.get(ConfigService),
        eformsignClient: moduleRef.get(EformsignApiClient),
    };
}

(LIVE ? describe : describe.skip)(EFORMSIGN_DRAFT_DIAGNOSTIC_SUITE_NAME, () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    it(EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_TEST_NAME, async () => {
        assertOfficialLiveOnly();
        const { moduleRef, configService, eformsignClient } = await createNarrowLiveModule();
        try {
            assertDraftDiagnosticOfficialLiveOrigins(configService);
            const tokenResponse = await eformsignClient.getAccessToken(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token.trim();
            if (!accessToken) throw new Error("draft diagnostic did not receive an access token");
            const template = assertCompletedReissueTemplateTopology(
                await fetchCompletedReissueTemplateConfig(
                    configService,
                    accessToken,
                    EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
                ),
            );
            const result = await runDraftDiagnostic({
                accessToken,
                api: eformsignClient,
                config: configService,
                template,
                ledgerDirectory: EFORMSIGN_DRAFT_DIAGNOSTIC_LEDGER_DIRECTORY,
            });
            console.info("[phase0-draft-diagnostic]", JSON.stringify(result));
            expect(result.status).toBe("created");
            expect(result.fieldCount).toBe(15);
            expect(result.documentId).toMatch(/^[a-f0-9]{32}$/i);
        } finally {
            await moduleRef.close();
        }
    });
});
