import { Injectable, Logger } from "@nestjs/common";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";

export interface FinalizeHeadlessParams {
    documentId: string;
    prefillEndDate?: string;
}

export interface FinalizeHeadlessSuccess {
    ok: true;
    durationMs: number;
}

export interface FinalizeHeadlessFailure {
    ok: false;
    reason: string;
    fallbackHint: "iframe";
    durationMs: number;
}

export type FinalizeHeadlessResult = FinalizeHeadlessSuccess | FinalizeHeadlessFailure;

/**
 * Backend-driven mode:"02" finalize flow. Mirrors the staff-completion iframe
 * modal: builds the same SDK option payload, then runs the gate sequence
 * (top-level 전송 → popup 전송) headlessly. Falls back to iframe on errors.
 */
@Injectable()
export class FinalizeDocumentHeadlessUsecase {
    private readonly logger = new Logger(FinalizeDocumentHeadlessUsecase.name);

    constructor(
        private readonly eformsignService: EformsignService,
        private readonly headlessService: EformsignHeadlessService,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
    ) {}

    async execute(params: FinalizeHeadlessParams): Promise<FinalizeHeadlessResult> {
        const start = Date.now();
        try {
            const tokenResponse = await this.getAccessTokenUsecase.execute(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token;
            const refreshToken = tokenResponse.oauth_token.refresh_token;

            const documentOption = (await this.eformsignService.generateStaffCompletionOptions(
                params.documentId,
                accessToken,
                refreshToken,
                params.prefillEndDate,
            )) as Record<string, unknown>;

            const result = await this.headlessService.dispatchFinalize({
                documentOption,
                documentId: params.documentId,
            });

            if (!result.ok) {
                return {
                    ok: false,
                    reason: result.reason,
                    fallbackHint: "iframe",
                    durationMs: result.durationMs,
                };
            }

            return { ok: true, durationMs: result.durationMs };
        } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown headless finalize error";
            this.logger.error(`FinalizeDocumentHeadlessUsecase failed: ${reason}`);
            return {
                ok: false,
                reason,
                fallbackHint: "iframe",
                durationMs: Date.now() - start,
            };
        }
    }
}
