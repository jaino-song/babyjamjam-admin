import { Injectable, Logger } from "@nestjs/common";
import { EformsignService } from "application/services/eformsign.service";
import { EformsignHeadlessService } from "infrastructure/automation/eformsign-headless.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import type { EformsignHeadlessProgressStep } from "application/services/eformsign-headless-progress.service";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";

export interface FinalizeHeadlessParams {
    documentId: string;
    prefillEndDate?: string;
    progressId?: string;
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
    failedStep?: EformsignHeadlessProgressStep;
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
        private readonly progressService: EformsignHeadlessProgressService,
    ) {}

    async execute(params: FinalizeHeadlessParams): Promise<FinalizeHeadlessResult> {
        const start = Date.now();
        let latestProgressStep: EformsignHeadlessProgressStep | undefined;
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
                onProgress: (step) => {
                    latestProgressStep = step;
                    this.progressService.emit(params.progressId, step);
                },
            });

            if (!result.ok) {
                this.progressService.emit(params.progressId, "failed", result.reason, latestProgressStep);
                return {
                    ok: false,
                    reason: result.reason,
                    fallbackHint: "iframe",
                    durationMs: result.durationMs,
                    failedStep: latestProgressStep,
                };
            }

            return { ok: true, durationMs: result.durationMs };
        } catch (error) {
            const reason = error instanceof Error ? error.message : "unknown headless finalize error";
            this.logger.error(`FinalizeDocumentHeadlessUsecase failed: ${reason}`);
            this.progressService.emit(params.progressId, "failed", reason, latestProgressStep);
            return {
                ok: false,
                reason,
                fallbackHint: "iframe",
                durationMs: Date.now() - start,
                failedStep: latestProgressStep,
            };
        }
    }
}
