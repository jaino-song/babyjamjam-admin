import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { writeFile } from "node:fs/promises";

import { EformsignService } from "application/services/eformsign.service";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import {
    acquireEformsignAccess,
    CONTRACT_DATE_UPDATE_DOCUMENT_ID,
    downloadContractDatePdf,
    readContractDateEvidence,
    readDocumentComponents,
    safeErrorReason,
    type ContractDateEvidence,
    verifyBaselineEvidence,
    type VerificationResult,
} from "./helpers/contract-date-update.live.helper";

/**
 * Read-only proof for the one reviewed provider-confirmation document used by
 * Task 0.1. Jest's normal config ignores test/e2e; run this file explicitly:
 *
 *   LIVE_E2E=1 pnpm exec jest test/e2e/contract-date-update.live.e2e.spec.ts \
 *     --testPathIgnorePatterns=/node_modules/ --runInBand
 *
 * This file is read-only. A save proof is deliberately not attempted while
 * the official exported PDF is stale or signature component values are absent.
 */
const LIVE = process.env["LIVE_E2E"] === "1";
const SAVE_BASELINE_PDF = process.env["LIVE_E2E_SAVE_BASELINE_PDF"] === "1";
const BASELINE_PDF_PATH = "/tmp/contract-date-proof-d54-baseline.pdf";

(LIVE ? describe : describe.skip)("contract date update — exact eformsign proof", () => {
    jest.setTimeout(240_000);

    let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
    let client: EformsignApiClient;
    let service: EformsignService;
    let accessToken: string;
    let baseline: VerificationResult<ContractDateEvidence>;

    beforeAll(async () => {
        if (process.env["E2E_VENDOR_STUBS"] === "1") {
            baseline = { status: "not_verified", reason: "vendor stubs are enabled" };
            return;
        }

        let phase = "module setup";
        try {
            moduleRef = await Test.createTestingModule({
                // Keep this module deliberately narrow: Config + the read-only
                // eformsign client/service. Do not import EformsignDocModule,
                // Prisma, schedulers, workers, or production finalize gates.
                imports: [ConfigModule.forRoot({ isGlobal: true })],
                providers: [EformsignApiClient, EformsignService],
            }).compile();
            client = moduleRef.get(EformsignApiClient);
            service = moduleRef.get(EformsignService);

            phase = "access token";
            const access = await acquireEformsignAccess(client);
            accessToken = access.accessToken;
            phase = "document detail and PDF";
            const evidence = await readContractDateEvidence(
                client,
                service,
                accessToken,
                CONTRACT_DATE_UPDATE_DOCUMENT_ID,
                {
                    getDocumentComponents: (token, documentId, names) => readDocumentComponents(
                        moduleRef.get(ConfigService),
                        token,
                        documentId,
                        names,
                    ),
                },
            );
            if (SAVE_BASELINE_PDF) {
                const pdf = await downloadContractDatePdf(service, accessToken, CONTRACT_DATE_UPDATE_DOCUMENT_ID);
                await writeFile(BASELINE_PDF_PATH, pdf);
                console.log(JSON.stringify({ pdfArtifactPath: BASELINE_PDF_PATH, pdfArtifactBytes: pdf.length }));
            }
            baseline = verifyBaselineEvidence(evidence);
            if (baseline.status !== "pass") {
                console.log(JSON.stringify({
                    status: baseline.status,
                    reason: baseline.reason,
                    documentId: evidence.id,
                    title: evidence.title,
                    templateId: evidence.templateId,
                    stage: {
                        statusType: evidence.statusType,
                        stepType: evidence.stepType,
                        stepName: evidence.stepName,
                    },
                    endDate: evidence.endDate,
                    receiptPeriodCount: evidence.receiptPeriods.length,
                    paymentDate: evidence.paymentDate,
                    moneyFieldKeys: Object.keys(evidence.moneyFields),
                    signatureHashCount: evidence.signatureHashes.length,
                    componentNames: evidence.componentNames,
                    signatureComponentNames: evidence.signatureComponentNames,
                    signatureComponentResults: evidence.signatureComponentResults.map((component) => ({
                        name: component.name,
                        valueHashPresent: Boolean(component.valueHash),
                        valueLength: component.valueLength,
                    })),
                    pdf: evidence.pdf,
                }));
            }
        } catch (error) {
            baseline = {
                status: "not_verified",
                reason: `${phase}: ${safeErrorReason(error, "read-only baseline")}`,
            };
        }
    });

    afterAll(async () => {
        if (moduleRef) {
            await moduleRef.close().catch(() => undefined);
        }
    });

    it("reads the exact document, saved fields, and downloadable PDF", () => {
        if (baseline.status !== "pass") {
            throw new Error(`[not_verified] ${baseline.reason}`);
        }

        const evidence = baseline.value;
        // Keep the log useful for the review without exposing access tokens,
        // customer fields, signatures, or the PDF body.
        console.log(JSON.stringify({
            status: "pass",
            documentId: evidence.id,
            title: evidence.title,
            templateIdPresent: Boolean(evidence.templateId),
            stage: {
                statusType: evidence.statusType,
                stepType: evidence.stepType,
                stepName: evidence.stepName,
            },
            endDate: evidence.endDate,
            receiptPeriodPresent: evidence.receiptPeriods.includes("20260709~20270104"),
            paymentDatePreserved: evidence.paymentDate === "2026-07-09",
            moneyFieldCount: Object.values(evidence.moneyFields).filter((values) => values.length === 1).length,
            signatureHashCount: evidence.signatureHashes.length,
            componentNames: evidence.componentNames,
            signatureComponentNames: evidence.signatureComponentNames,
            signatureComponentResults: evidence.signatureComponentResults.map((component) => ({
                name: component.name,
                valueHashPresent: Boolean(component.valueHash),
                valueLength: component.valueLength,
            })),
            pdf: {
                sha256: evidence.pdf.sha256,
                byteLength: evidence.pdf.byteLength,
                pageCount: evidence.pdf.pageCount,
                hasEndDate: evidence.pdf.hasEndDate,
                hasReceiptPeriod: evidence.pdf.hasReceiptPeriod,
                receiptPeriodOccurrences: evidence.pdf.receiptPeriodOccurrences,
                hasOldEndDate: evidence.pdf.hasOldEndDate,
                hasOldReceiptPeriod: evidence.pdf.hasOldReceiptPeriod,
                oldReceiptPeriodOccurrences: evidence.pdf.oldReceiptPeriodOccurrences,
            },
        }));
    });

});
