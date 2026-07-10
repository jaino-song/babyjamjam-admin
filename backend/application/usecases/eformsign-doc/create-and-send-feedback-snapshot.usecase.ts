import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_DOC_REPOSITORY, IEformsignDocRepository } from "domain/repositories/eformsign-doc.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";
import {
    buildFeedbackDocumentFields,
    chunkSessions,
    type FeedbackDayInput,
} from "./service-record-field-mapper";

/**
 * Finalize a completed 제공기록지 into one or more fully-prefilled eformsign documents and route
 * them to the template's 제공업체 확인 (reviewer) step (BJJ-249). The 제공인력 fills everything in
 * the app — nobody fills anything in eformsign — so the document goes straight to the org's
 * pre-specified reviewer for confirmation.
 *
 * The template is a fixed 5-session grid, so a service of N sessions is split into ceil(N/5)
 * documents. Each document's fields are prefilled from `service_record` + `service_record_day`
 * by the pure mapper. Persisted with linkToClient:false — the client's eDocId is NEVER touched —
 * and the webhook template_id gate (EFORMSIGN_FEEDBACK_TEMPLATE_ID) keeps completion from
 * marking the contract done.
 *
 * Retry-safe: a chunk marker in `stepName` lets a re-run skip documents already created.
 */
@Injectable()
export class CreateAndSendFeedbackSnapshotUsecase {
    private readonly logger = new Logger(CreateAndSendFeedbackSnapshotUsecase.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        @Inject(EFORMSIGN_DOC_REPOSITORY)
        private readonly eformsignDocRepository: IEformsignDocRepository,
        private readonly prisma: PrismaService,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        private readonly configService: ConfigService,
    ) {}

    async execute(
        branchid: string,
        scheduleId: number,
    ): Promise<{ documentIds: string[]; documentId: string; chunkCount: number }> {
        const templateId = this.configService.get<string>("EFORMSIGN_FEEDBACK_TEMPLATE_ID");
        if (!templateId) {
            throw new BadRequestException("EFORMSIGN_FEEDBACK_TEMPLATE_ID is not configured.");
        }

        const schedule = await this.prisma.employee_schedule.findUnique({
            where: { id: scheduleId },
            include: {
                client: true,
                primaryEmployee: true,
                serviceRecord: true,
                serviceRecordDays: { orderBy: { sessionIndex: "asc" } },
            },
        });
        if (!schedule) throw new NotFoundException(`Assignment ${scheduleId} not found`);

        // 제공기관 이름 is required at the template's creation step — fail loudly if the branch is unnamed.
        const branch = await this.prisma.branch.findUnique({ where: { id: branchid } });
        const orgName = branch?.name;
        if (!orgName) throw new BadRequestException("제공기관 정보가 없습니다.");

        const clientName = schedule.client?.name ?? "";
        const employeeName = schedule.primaryEmployee.name;

        const days: FeedbackDayInput[] = schedule.serviceRecordDays.map((d) => ({
            sessionIndex: d.sessionIndex,
            serviceDate: d.serviceDate,
            answers: (d.answers ?? {}) as Record<string, unknown>,
            etcService: d.etcService,
            notes: d.notes,
            paymentConfirmed: d.paymentConfirmed,
            momApproval: d.momApproval,
        }));

        // ceil(N/5) documents; an empty record still yields one (header-only) document.
        const chunks = days.length > 0 ? chunkSessions(days) : [[]];
        const chunkCount = chunks.length;

        // Idempotency: skip chunks already created for this schedule (marker lives in stepName).
        const existingDocs = await this.eformsignDocRepository.findByClientId(branchid, schedule.clientId);
        const markerOf = (i: number) => `제공기록지 S${scheduleId} ${i + 1}/${chunkCount}`;

        const tokenResponse = await this.getAccessTokenUsecase.execute(Date.now());
        const accessToken = tokenResponse.oauth_token.access_token;

        // The reviewer recipient must mirror the template's pre-specified 제공업체 확인 step
        // exactly (eformsign rejects mismatches), so read it from the live template config.
        const reviewer = await this.eformsignClient.getTemplateReviewer(accessToken, templateId);
        if (!reviewer) {
            throw new BadRequestException("제공기록지 템플릿에 검토자(제공업체 확인) 지정이 없습니다.");
        }

        const documentIds: string[] = [];
        for (let i = 0; i < chunkCount; i++) {
            const marker = markerOf(i);
            const already = existingDocs.find((doc) => doc.stepName === marker);
            if (already) {
                this.logger.log(`Feedback chunk ${marker} already exists (doc ${already.documentId}); skipping.`);
                documentIds.push(already.documentId);
                continue;
            }

            const prefillFields = buildFeedbackDocumentFields({
                header: schedule.serviceRecord,
                orgName,
                employeeName,
                days: chunks[i] ?? [],
            });

            const result = await this.eformsignClient.createDocument(accessToken, {
                templateId,
                documentName: `서비스 제공기록지 - ${clientName} (${i + 1}/${chunkCount})`,
                prefillFields,
                reviewer,
            });

            // Log the remote id BEFORE persisting, so a persistence failure never loses the reference.
            this.logger.log(`Feedback chunk ${marker} created: documentId=${result.documentId}`);

            await this.createEformsignDocUsecase.execute(branchid, {
                documentId: result.documentId,
                clientId: schedule.clientId,
                linkToClient: false,
                statusType: "070",
                statusDetail: "검토 요청",
                stepType: "06",
                stepIndex: "2",
                stepName: marker,
                stepRecipientType: "reviewer",
                stepRecipientName: reviewer.name,
                stepRecipientSms: reviewer.phoneNumber ?? "-",
                expiredDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            });

            documentIds.push(result.documentId);
        }

        this.logger.log(`Feedback snapshot finalized: schedule=${scheduleId}, chunks=${chunkCount}, docs=[${documentIds.join(", ")}]`);
        return { documentIds, documentId: documentIds[0] ?? "", chunkCount };
    }
}
