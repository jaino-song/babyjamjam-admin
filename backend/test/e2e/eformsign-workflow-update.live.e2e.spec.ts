import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, type TestingModule } from "@nestjs/testing";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EformsignService } from "application/services/eformsign.service";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import {
    EFORMSIGN_SDK_CAPABILITY_USER_EMAIL,
    type EformsignSdkDocumentSnapshot,
} from "./helpers/eformsign-sdk-capability.live.helper";
import {
    EFORMSIGN_WORKFLOW_UPDATE_AFTER_STATUS_TYPE,
    EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_INDEX,
    EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_TYPE,
    EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID,
    EFORMSIGN_WORKFLOW_UPDATE_PDF_SHA256,
    EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID,
    assertEformsignSdkDocumentIdentity,
    assertPdfDownload,
    assertWorkflowUpdateDeclinedDocument,
    assertWorkflowUpdateFieldsUnchanged,
    assertWorkflowUpdateTemplateTopology,
    fetchWorkflowUpdateTemplateConfig,
    hashPdfBody,
    postSingleWorkflowUpdateDecline,
    type WorkflowUpdateTemplateTopology,
} from "./helpers/eformsign-workflow-update.live.helper";

const LIVE = process.env["LIVE_E2E"] === "1";
const LIVE_TEST_TIMEOUT_MS = 180_000;
const SECURE_DIRECTORY_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;

interface SecurePdfArtifact {
    sha256: string;
    byteLength: number;
}

interface WorkflowUpdateFixture {
    accessToken: string;
    beforeSnapshot: EformsignSdkDocumentSnapshot;
    beforePdf: SecurePdfArtifact;
    artifactDirectory: string;
    topology: WorkflowUpdateTemplateTopology;
}

async function createSecureArtifactDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "eformsign-workflow-update-"));
    await chmod(directory, SECURE_DIRECTORY_MODE);
    if (((await stat(directory)).mode & 0o777) !== SECURE_DIRECTORY_MODE) {
        throw new Error("workflow update could not secure the PDF artifact directory");
    }
    return directory;
}

async function writeSecurePdfArtifact(
    directory: string,
    label: "before" | "after",
    body: Buffer,
): Promise<SecurePdfArtifact> {
    const path = join(directory, `${label}.pdf`);
    await writeFile(path, body, { mode: SECURE_FILE_MODE, flag: "wx" });
    await chmod(path, SECURE_FILE_MODE);
    if (((await stat(path)).mode & 0o777) !== SECURE_FILE_MODE) {
        throw new Error("workflow update could not secure the PDF artifact");
    }
    return { sha256: hashPdfBody(body), byteLength: body.length };
}

(LIVE ? describe : describe.skip)("eformsign workflow update — one decline", () => {
    jest.setTimeout(LIVE_TEST_TIMEOUT_MS);

    let moduleRef: TestingModule | undefined;
    let configService: ConfigService;
    let eformsignClient: EformsignApiClient;
    let eformsignService: EformsignService;
    let fixture: WorkflowUpdateFixture;

    beforeAll(async () => {
        try {
            if (process.env["E2E_VENDOR_STUBS"] === "1") {
                throw new Error("workflow update requires the official vendor API");
            }
            moduleRef = await Test.createTestingModule({
                imports: [ConfigModule.forRoot({ isGlobal: true })],
                providers: [EformsignApiClient, EformsignService],
            }).compile();
            configService = moduleRef.get(ConfigService);
            eformsignClient = moduleRef.get(EformsignApiClient);
            eformsignService = moduleRef.get(EformsignService);

            if (configService.get<string>("EFORMSIGN_USER_EMAIL")?.trim() !== EFORMSIGN_SDK_CAPABILITY_USER_EMAIL) {
                throw new Error("workflow update user is outside the exact allowlist");
            }
            const tokenResponse = await eformsignClient.getAccessToken(Date.now());
            const accessToken = tokenResponse.oauth_token.access_token.trim();
            if (!accessToken || !tokenResponse.oauth_token.refresh_token.trim()) {
                throw new Error("workflow update did not receive usable API tokens");
            }

            // Fresh identity, field snapshot, PDF, and template topology immediately precede the one POST.
            const beforeDocument = await eformsignClient.getDocument(accessToken, EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID);
            const beforeSnapshot = assertEformsignSdkDocumentIdentity(beforeDocument);
            const beforeDownload = await eformsignService.downloadDocumentFile(
                accessToken,
                EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID,
                "document",
            );
            assertPdfDownload(beforeDownload);
            const artifactDirectory = await createSecureArtifactDirectory();
            const beforePdf = await writeSecurePdfArtifact(artifactDirectory, "before", beforeDownload.body);
            if (beforePdf.sha256 !== EFORMSIGN_WORKFLOW_UPDATE_PDF_SHA256) {
                throw new Error("workflow update preflight PDF is outside the exact allowlist");
            }
            const topology = assertWorkflowUpdateTemplateTopology(
                await fetchWorkflowUpdateTemplateConfig(configService, accessToken, EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID),
            );
            fixture = { accessToken, beforeSnapshot, beforePdf, artifactDirectory, topology };
        } catch {
            throw new Error("workflow update preflight failed");
        }
    });

    afterAll(async () => {
        await moduleRef?.close();
    });

    it("declines once to the inherited internal participant and verifies immutable fields/PDF", async () => {
        const httpEvidence = await postSingleWorkflowUpdateDecline(
            configService,
            fixture.accessToken,
            EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID,
        );

        let stateConfirmed = false;
        let afterSnapshot: EformsignSdkDocumentSnapshot | undefined;
        let afterStatus: { statusType: string; stepType: string; stepIndex: string } | undefined;
        try {
            const afterDocument = await eformsignClient.getDocument(
                fixture.accessToken,
                EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID,
            );
            afterSnapshot = assertWorkflowUpdateDeclinedDocument(afterDocument);
            assertWorkflowUpdateFieldsUnchanged(fixture.beforeSnapshot, afterSnapshot);
            afterStatus = {
                statusType: EFORMSIGN_WORKFLOW_UPDATE_AFTER_STATUS_TYPE,
                stepType: EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_TYPE,
                stepIndex: EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_INDEX,
            };
            stateConfirmed = true;
        } catch {
            stateConfirmed = false;
        }

        let pdfConfirmed = false;
        let afterPdf: SecurePdfArtifact | undefined;
        try {
            const afterDownload = await eformsignService.downloadDocumentFile(
                fixture.accessToken,
                EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID,
                "document",
            );
            assertPdfDownload(afterDownload);
            afterPdf = await writeSecurePdfArtifact(fixture.artifactDirectory, "after", afterDownload.body);
            pdfConfirmed = afterPdf.sha256 === fixture.beforePdf.sha256
                && afterPdf.sha256 === EFORMSIGN_WORKFLOW_UPDATE_PDF_SHA256;
        } catch {
            pdfConfirmed = false;
        }

        console.info("[eformsign-workflow-update] " + JSON.stringify({
            declineAttempted: httpEvidence.attempted,
            declineResponseReceived: httpEvidence.responseReceived,
            declineHttpStatus: httpEvidence.status,
            declineHttpSuccess: httpEvidence.httpSuccess,
            declineTransportError: httpEvidence.transportError,
            declineResponseBodyJson: httpEvidence.responseBodyJson,
            declineResponseIdPresent: httpEvidence.responseIdPresent,
            declineResponseIdMatches: httpEvidence.responseIdMatches,
            templateStepCount: fixture.topology.stepCount,
            templateSequential: fixture.topology.sequential,
            templateParallel: fixture.topology.parallel,
            templateRejectRestrictionsFalse: fixture.topology.rejectRestrictionsFalse,
            templateReviewerPreviousSequence: fixture.topology.reviewerPreviousSequence,
            templateParticipantSequence: fixture.topology.participantSequence,
            templateUserParticipantUnselected: fixture.topology.userParticipantUnselected,
            beforeFieldCount: fixture.beforeSnapshot.fieldCount,
            afterFieldCount: afterSnapshot?.fieldCount ?? null,
            fieldsUnchanged: stateConfirmed,
            beforePdfSha256: fixture.beforePdf.sha256,
            afterPdfSha256: afterPdf?.sha256 ?? null,
            beforePdfBytes: fixture.beforePdf.byteLength,
            afterPdfBytes: afterPdf?.byteLength ?? null,
            pdfUnchanged: pdfConfirmed,
            confirmedState: afterStatus ?? null,
        }));

        if (httpEvidence.responseIdPresent && httpEvidence.responseIdMatches !== true) {
            throw new Error("workflow update decline response document id did not match");
        }
        if (!stateConfirmed || !pdfConfirmed) {
            throw new Error("workflow update postflight confirmation failed");
        }
    });
});
