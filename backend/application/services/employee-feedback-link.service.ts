import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SendAligoSmsUsecase } from "application/usecases/aligo/send-sms.usecase";
import { EmployeeFeedbackTokenService } from "./employee-feedback-token.service";

const DEFAULT_GRACE_DAYS = 14;

/**
 * Issues / revokes the no-login 제공기록지 link for an assignment (BJJ-247).
 * Fire-and-forget from the assignment/replacement/termination flows — a messaging
 * failure must never break those operations, so every public method swallows errors.
 */
@Injectable()
export class EmployeeFeedbackLinkService {
    private readonly logger = new Logger(EmployeeFeedbackLinkService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokenService: EmployeeFeedbackTokenService,
        private readonly sendSms: SendAligoSmsUsecase,
        private readonly configService: ConfigService,
    ) {}

    /** Mint a fresh link for the assignment's primary 제공인력 and SMS it to them. */
    async issueAndSend(scheduleId: number): Promise<void> {
        try {
            const schedule = await this.prisma.employee_schedule.findUnique({
                where: { id: scheduleId },
                include: { primaryEmployee: true, client: true },
            });
            if (!schedule || !schedule.branchId) return;

            const employee = schedule.primaryEmployee;
            if (!employee.birthday) {
                this.logger.warn(
                    `Schedule ${scheduleId}: provider ${employee.id} has no DOB on file; feedback link NOT sent. Set the employee's birthday first.`
                );
                return;
            }

            const graceDays = Number(this.configService.get("EMPLOYEE_FEEDBACK_TOKEN_GRACE_DAYS")) || DEFAULT_GRACE_DAYS;
            const expiresAt = new Date(schedule.endDate.getTime() + graceDays * 24 * 60 * 60 * 1000);

            const { linkToken } = await this.tokenService.issueLink({
                branchId: schedule.branchId,
                scheduleId,
                employeeId: employee.id,
                expectedDob: employee.birthday,
                expiresAt,
            });

            const base = this.configService
                .get<string>("MOBILE_FEEDBACK_BASE_URL", "https://m.admin.babyjamjam.com")
                .replace(/\/+$/, "");
            const url = `${base}/feedback/${linkToken}`;
            const clientName = schedule.client?.name ?? "고객";
            const message =
                `[아가잼잼] ${clientName}님 산모·신생아 서비스 제공기록지 작성 링크입니다.\n` +
                `링크 접속 후 생년월일로 본인확인하고, 방문일마다 기록을 남겨주세요.\n${url}`;

            await this.sendSms.execute({
                receiver: employee.phone,
                message,
                senderPhone: this.configService.get<string>("ALIGO_SENDER_PHONE"),
            });
            this.logger.log(`Feedback link sent to provider ${employee.id} for schedule ${scheduleId}`);
        } catch (error) {
            this.logger.error(`Failed to issue/send feedback link for schedule ${scheduleId}: ${error}`);
        }
    }

    /** Revoke an assignment's feedback access (replacement / termination). */
    async revoke(scheduleId: number): Promise<void> {
        try {
            await this.tokenService.revokeForSchedule(scheduleId);
            this.logger.log(`Feedback access revoked for schedule ${scheduleId}`);
        } catch (error) {
            this.logger.error(`Failed to revoke feedback link for schedule ${scheduleId}: ${error}`);
        }
    }
}
