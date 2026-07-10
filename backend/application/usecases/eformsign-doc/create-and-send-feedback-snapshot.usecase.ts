import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EFORMSIGN_CLIENT_REPOSITORY, IEformsignClientRepository } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_DOCUMENT_KIND } from "domain/entities/eformsign-doc.entity";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CreateEformsignDocUsecase } from "./create-eformsign-doc.usecase";
import { GetEformsignAccessTokenUsecase } from "./get-eformsign-access-token.usecase";

/**
 * Finalize a completed 제공기록지 into ONE eformsign snapshot and SMS it to the 제공인력 to sign (BJJ-247).
 * The N-session record is rendered into a single text field, so eformsign's fixed-template limit never applies.
 * Mirrors CreateAndSendContractUsecase but with linkToClient:false — the client's eDocId must NOT be touched —
 * and the webhook template_id gate (EFORMSIGN_FEEDBACK_TEMPLATE_ID) keeps completion from marking the contract done.
 */
@Injectable()
export class CreateAndSendFeedbackSnapshotUsecase {
    private readonly logger = new Logger(CreateAndSendFeedbackSnapshotUsecase.name);

    constructor(
        @Inject(EFORMSIGN_CLIENT_REPOSITORY)
        private readonly eformsignClient: IEformsignClientRepository,
        private readonly prisma: PrismaService,
        private readonly getAccessTokenUsecase: GetEformsignAccessTokenUsecase,
        private readonly createEformsignDocUsecase: CreateEformsignDocUsecase,
        private readonly configService: ConfigService,
    ) {}

    async execute(branchid: string, scheduleId: number): Promise<{ documentId: string }> {
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
        if (!schedule.primaryEmployee.phone) throw new BadRequestException("제공인력 연락처가 없습니다.");

        const tokenResponse = await this.getAccessTokenUsecase.execute(Date.now());
        const accessToken = tokenResponse.oauth_token.access_token;

        const prefillFields = [
            { id: "제공인력명", value: schedule.primaryEmployee.name },
            { id: "고객명", value: schedule.client?.name ?? "" },
            { id: "기록내용", value: this.renderRecord(schedule) },
        ];

        const result = await this.eformsignClient.createDocument(accessToken, {
            templateId,
            documentName: `서비스 제공기록지 - ${schedule.client?.name ?? ""}`,
            prefillFields,
            recipient: {
                name: schedule.primaryEmployee.name,
                sms: schedule.primaryEmployee.phone,
            },
        });

        // Persist for status tracking. linkToClient:false => client.eDocId is NEVER touched (contract isolation).
        await this.createEformsignDocUsecase.execute(branchid, {
            documentId: result.documentId,
            clientId: schedule.clientId,
            linkToClient: false,
            statusType: "010",
            statusDetail: "created",
            stepType: "01",
            stepIndex: "1",
            stepName: "제공기록지 서명",
            stepRecipientType: "signer",
            stepRecipientName: schedule.primaryEmployee.name,
            stepRecipientSms: schedule.primaryEmployee.phone,
            expiredDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
            documentKind: EFORMSIGN_DOCUMENT_KIND.SERVICE_FEEDBACK_SNAPSHOT,
            employeeScheduleId: schedule.id,
            templateId,
        });

        this.logger.log(`Feedback snapshot created+sent: documentId=${result.documentId}, schedule=${scheduleId}`);
        return { documentId: result.documentId };
    }

    private renderRecord(schedule: any): string {
        const lines: string[] = [];
        const h = schedule.serviceRecord;
        lines.push("■ 서비스 기본정보");
        if (h) {
            lines.push(`산모: ${h.momName ?? ""} (생년월일 ${h.momBirth ?? ""})`);
            lines.push(`신생아: ${h.babyName ?? ""} (출생 ${h.babyBirth ?? ""}, 몸무게 ${h.babyWeight ?? ""})`);
            lines.push(`분만형태: ${h.deliveryType ?? ""}`);
        }
        lines.push("");
        lines.push(`■ 일자별 기록 (총 ${schedule.serviceRecordDays.length}회)`);
        for (const d of schedule.serviceRecordDays) {
            lines.push(`- ${d.sessionIndex}회차 (${this.fmtDate(d.serviceDate)})`);
            const answers = this.renderAnswers((d.answers ?? {}) as Record<string, unknown>);
            if (answers) lines.push(`  ${answers}`);
            if (d.etcService) lines.push(`  기타: ${d.etcService}`);
            if (d.notes) lines.push(`  특이사항: ${d.notes}`);
            lines.push(`  결제확인: ${d.paymentConfirmed ? "완료" : "미확인"} · 산모서명: ${d.momSignature ? "있음" : "없음"}`);
        }
        return lines.join("\n");
    }

    private renderAnswers(answers: Record<string, unknown>): string {
        const parts: string[] = [];
        for (const [key, value] of Object.entries(answers)) {
            if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
            parts.push(`${key}=${Array.isArray(value) ? value.join("/") : String(value)}`);
        }
        return parts.join(", ");
    }

    private fmtDate(date: Date): string {
        const d = new Date(date);
        return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
    }
}
