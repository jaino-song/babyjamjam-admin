import { Body, Controller, Post, HttpCode, HttpStatus, Logger, UseGuards } from "@nestjs/common";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { EformsignWebhookPayloadDto } from "interface/dto/eformsign-webhook.dto";
import { WebhookGuard } from "infrastructure/auth/webhook.guard";

/**
 * Controller for handling eformsign webhook callbacks
 * This endpoint is called by eformsign when document status changes
 * Protected by bearer token authentication configured in eformsign console
 */
@Controller("webhooks/eformsign")
@UseGuards(WebhookGuard)
export class EformsignWebhookController {
    private readonly logger = new Logger(EformsignWebhookController.name);

    constructor(private readonly webhookService: EformsignWebhookService) {}

    @Post()
    @HttpCode(HttpStatus.OK)
    async handleWebhook(@Body() payload: EformsignWebhookPayloadDto) {
        const documentId = payload.document?.id || payload.ready_document_pdf?.document_id || "unknown";
        this.logger.log(`Received eformsign webhook: ${payload.event_type} for document ${documentId}`);

        try {
            await this.webhookService.processWebhook(payload);
            return { success: true };
        } catch (error) {
            this.logger.error(`Webhook processing failed: ${error}`);
            // Return success anyway to avoid eformsign retries
            // The error is logged for manual review
            return { success: true, warning: "Processing deferred" };
        }
    }
}
