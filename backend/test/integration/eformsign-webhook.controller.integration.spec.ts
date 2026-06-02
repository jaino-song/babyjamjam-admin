import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";
import { EformsignWebhookController } from "interface/controllers/eformsign-webhook.controller";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import request from "supertest";

describe("EformsignWebhookController (Integration)", () => {
    let app: INestApplication;
    let webhookService: jest.Mocked<Pick<EformsignWebhookService, "processWebhook">>;

    const payload: EformsignWebhookPayloadDto = {
        webhook_id: "webhook-1",
        webhook_name: "contract-status",
        company_id: "branch-1",
        event_type: "document",
        document: {
            id: "doc-1",
            document_title: "계약서",
            template_id: "template-1",
            template_name: "산모신생아 계약서",
            workflow_seq: 1,
            workflow_name: "서명",
            status: "doc_complete",
            updated_date: 1780000000000,
        },
    };

    beforeEach(async () => {
        const mockWebhookService = {
            processWebhook: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignWebhookController],
            providers: [
                {
                    provide: EformsignWebhookService,
                    useValue: mockWebhookService,
                },
            ],
        })
            .overrideGuard(WebhookGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        webhookService = moduleFixture.get(EformsignWebhookService);
    });

    afterEach(async () => {
        await app.close();
    });

    it("returns success when webhook processing completes", async () => {
        webhookService.processWebhook.mockResolvedValue(undefined);

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .send(payload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(webhookService.processWebhook).toHaveBeenCalledWith("branch-1", payload);
    });

    it("returns retryable failure when webhook processing fails", async () => {
        webhookService.processWebhook.mockRejectedValue(new Error("database unavailable"));

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .send(payload);

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            success: false,
            error: "Webhook processing failed",
            webhookId: "webhook-1",
            documentId: "doc-1",
        });
    });
});
