import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";
import { EformsignWebhookController } from "interface/controllers/eformsign-webhook.controller";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import request from "supertest";

describe("EformsignWebhookController (Integration)", () => {
    let app: INestApplication;
    let webhookService: jest.Mocked<Pick<EformsignWebhookService, "processWebhook">>;
    const authHeader = { Authorization: "Bearer webhook-secret" };

    const payload: EformsignWebhookPayloadDto = {
        webhook_id: "webhook-1",
        webhook_name: "contract-status",
        company_id: "company-1",
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
        const mockConfigService = {
            get: jest.fn((key: string) => {
                switch (key) {
                    case "EFORMSIGN_WEBHOOK_SECRET":
                        return "webhook-secret";
                    case "EFORMSIGN_COMPANY_ID":
                        return "company-1";
                    default:
                        return undefined;
                }
            }),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignWebhookController],
            providers: [
                {
                    provide: EformsignWebhookService,
                    useValue: mockWebhookService,
                },
                {
                    provide: ConfigService,
                    useValue: mockConfigService,
                },
                WebhookGuard,
            ],
        })
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
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        expect(webhookService.processWebhook).toHaveBeenCalledWith(payload);
    });

    it("returns retryable failure when webhook processing fails", async () => {
        webhookService.processWebhook.mockRejectedValue(new Error("database unavailable"));

        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send(payload);

        expect(response.status).toBe(503);
        expect(response.body).toEqual({
            success: false,
            error: "Webhook processing failed",
            webhookId: "webhook-1",
            documentId: "doc-1",
        });
    });

    it("returns 401 when the webhook secret is missing", async () => {
        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .send(payload);

        expect(response.status).toBe(401);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });

    it("returns 401 when the webhook secret is invalid", async () => {
        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set({ Authorization: "Bearer wrong-secret" })
            .send(payload);

        expect(response.status).toBe(401);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });

    it("returns 403 when the company id is unknown", async () => {
        const response = await request(app.getHttpServer())
            .post("/webhooks/eformsign")
            .set(authHeader)
            .send({
                ...payload,
                company_id: "unknown-company",
            });

        expect(response.status).toBe(403);
        expect(webhookService.processWebhook).not.toHaveBeenCalled();
    });
});
