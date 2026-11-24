import { StandaloneReceiptIssueService } from "application/services/standalone-receipt-issue.service";
import { StandaloneReceiptPreparationService } from "application/services/standalone-receipt-preparation.service";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { MessageTriggerService } from "application/services/message-trigger.service";
import { SmsRetryService } from "application/services/sms-retry.service";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { RECEIPT_LINK_TOKEN_REPOSITORY } from "domain/repositories/receipt-link-token.repository.interface";
import { SupabaseStorageAdapter } from "infrastructure/adapters/supabase-storage.adapter";
import { ReceiptLinkCleanupSchedulerService } from "application/services/receipt-link-cleanup-scheduler.service";
import { ReceiptLinkDeliveryEnricher } from "application/services/receipt-link-delivery-enricher.service";
import { ReceiptLinkIssueService } from "application/services/receipt-link-issue.service";
import { ReceiptLinkManualSendService } from "application/services/receipt-link-manual-send.service";
import { ReceiptLinkTokenService } from "application/services/receipt-link-token.service";
import { ReceiptLinkAdminController } from "interface/controllers/receipt-link-admin.controller";
import { ReceiptLinkController } from "interface/controllers/receipt-link.controller";
import { EformsignDocModule } from "module/eformsign-doc.module";
import { MessageModule } from "module/message.module";
import { ReceiptLinkModule } from "module/receipt-link.module";
import { SystemSettingModule } from "module/system-setting.module";

// app.module.ts cannot be imported directly in this jest project: it transitively imports
// `nanoid` (an ESM-only package) via infrastructure/database/repositories/chat-feedback.repository.ts,
// and jest's CommonJS transform fails on that import with "Cannot use import statement outside
// a module" (same issue documented in
// test/infrastructure/tenant/app-module-middleware.wiring.spec.ts). Stubbing nanoid out is
// enough to let app.module.ts load for the metadata assertion below. This must stay a top-level
// require (not inside jest.isolateModules) so the ReceiptLinkModule class it pulls in
// transitively is reference-identical to the one imported above — a separate module registry
// would produce a distinct class object and the `toContain` assertion would false-fail.
jest.mock("nanoid", () => ({ nanoid: () => "test-id" }));
const { AppModule } = require("../../app.module") as typeof import("../../app.module");

describe("ReceiptLinkModule wiring", () => {
    it("resolves the receipt enricher and MessageModule retry graph through Nest", async () => {
        const module = await Test.createTestingModule({
            imports: [
                ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
                TenantModule, ReceiptLinkModule,
            ],
        }).overrideProvider(SupabaseStorageAdapter).useValue({}).compile();
        try {
            const messages = module.select(MessageModule);
            const triggers = messages.get(MessageTriggerService, { strict: true });
            const retry = messages.get(SmsRetryService, { strict: true });
            expect(triggers).toBeInstanceOf(MessageTriggerService);
            expect(retry).toBeInstanceOf(SmsRetryService);
            expect(retry).toHaveProperty("messageTriggers", triggers);
            const receipts = module.select(ReceiptLinkModule);
            const enricher = receipts.get(ReceiptLinkDeliveryEnricher, { strict: true });
            expect(enricher).toHaveProperty("tokenRepository", receipts.get(RECEIPT_LINK_TOKEN_REPOSITORY, { strict: true }));
            expect(enricher).toHaveProperty("standalone", receipts.get(StandaloneReceiptPreparationService, { strict: true }));
        } finally {
            await module.close();
        }
    });

    it("declares the delivery enricher, cleanup scheduler, token and issue services as providers", () => {
        const providers = Reflect.getMetadata("providers", ReceiptLinkModule) as unknown[];

        expect(providers).toContain(ReceiptLinkDeliveryEnricher);
        expect(providers).toContain(ReceiptLinkCleanupSchedulerService);
        expect(providers).toContain(ReceiptLinkTokenService);
        expect(providers).toContain(ReceiptLinkIssueService);
        expect(providers).toContain(ReceiptLinkManualSendService);
        expect(providers).toContain(StandaloneReceiptIssueService);
        expect(providers).toContain(StandaloneReceiptPreparationService);
    });

    it("declares ReceiptLinkController and ReceiptLinkAdminController as controllers", () => {
        const controllers = Reflect.getMetadata("controllers", ReceiptLinkModule) as unknown[];

        expect(controllers).toContain(ReceiptLinkController);
        expect(controllers).toContain(ReceiptLinkAdminController);
    });

    it("imports MessageModule, EformsignDocModule and SystemSettingModule", () => {
        const imports = Reflect.getMetadata("imports", ReceiptLinkModule) as unknown[];

        expect(imports).toEqual(expect.arrayContaining([MessageModule, EformsignDocModule, SystemSettingModule]));
    });

    it("is imported by AppModule", () => {
        const imports = Reflect.getMetadata("imports", AppModule) as unknown[];

        expect(imports).toContain(ReceiptLinkModule);
    });
});
