import { PrismaClient, Prisma, branch, user, user_branch, auth_session, auth_refresh_token, client, employee, employee_schedule, message_trigger_rule, message_trigger_job, message_log, eformsign_doc } from "@prisma/client";
import { randomUUID } from "node:crypto";

import {
    MessageTriggerEventType,
    MessageTriggerOffsetType,
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { DEFAULT_EMPLOYEE_GRADE } from "domain/constants/employee-grade.constants";
import type { PrismaService } from "infrastructure/database/prisma.service";

import type { RowTracker } from "./tracker";

/**
 * Minimal-valid-default factories for the state-integrity specs. Every required
 * column is derived from `prisma/schema.prisma`; values with a domain constraint
 * (CHECK in `prisma/migrations/**`) or an application-level vocabulary are taken
 * from the application's own constants or from values the production writers and
 * the existing real-DB specs actually write:
 *
 * - `client.service_status` → `client_service_status_allowed` CHECK: "active".
 * - `eformsign_doc.sync_status` → CHECK: schema default "pending".
 * - `message_log.provider_acceptance_state` → CHECK: schema default "legacy".
 * - `message_log.provider` → the application only ever writes "aligo_sms" (the
 *   Aligo SMS path) here.
 * - `message_trigger_rule` / `message_trigger_job` vocabularies (event type,
 *   offset type, recipient type, template key) come from
 *   `domain/constants/message-trigger-catalog` so they cannot drift.
 * - `employee.grade` → `DEFAULT_EMPLOYEE_GRADE` from
 *   `domain/constants/employee-grade.constants`.
 * - `eformsign_doc` status/step strings → the same values
 *   test/prisma/eformsign-void-fences.real-db.spec.ts writes.
 *
 * All generated values are unique per call (UUID suffixes, phone numbers unique
 * per call), so specs can run repeatedly against one database. Each factory
 * registers the created row in the caller's {@link RowTracker}; register parents
 * by creating them first — cleanup deletes children before parents.
 */
export type IntegrityPrisma = PrismaClient | PrismaService;

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** Short unique suffix per call, safe for slugs, keys and ids. */
const uniqueSuffix = (): string => randomUUID().replace(/-/g, "").slice(0, 12);

/** "010" + 8 random digits, unique per call, so (branchId, phoneNormalized) never collides across runs. */
const uniquePhone = (): string => {
    let digits = "";
    for (let index = 0; index < 8; index += 1) {
        digits += Math.floor(Math.random() * 10).toString();
    }
    return `010${digits}`;
};

const formattedPhone = (normalized: string): string => `${normalized.slice(0, 3)}-${normalized.slice(3, 7)}-${normalized.slice(7)}`;

export async function createBranch(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    overrides: Partial<Prisma.branchUncheckedCreateInput> = {},
): Promise<branch> {
    const suffix = uniqueSuffix();
    const row = await prisma.branch.create({
        data: {
            name: `무결성 지점 ${suffix}`,
            slug: `throwaway-si-${suffix}`,
            ...overrides,
        },
    });
    tracker.track("branch", row.id);
    return row;
}

export interface CreateUserMembership {
    branchId: string;
    role?: string;
}

export interface CreateUserOptions {
    /** Also creates one `user_branch` membership (registered in the tracker) for this user. */
    membership?: CreateUserMembership;
}

export async function createUser(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    overrides: Partial<Prisma.userUncheckedCreateInput> = {},
    options: CreateUserOptions = {},
): Promise<user> {
    const suffix = uniqueSuffix();
    const row = await prisma.user.create({
        data: {
            email: `si-${suffix}@integrity.test`,
            name: `무결성 사용자 ${suffix}`,
            phone: formattedPhone(uniquePhone()),
            kakaoId: `si-${suffix}`,
            role: "user",
            approvalStatus: "approved",
            emailVerified: true,
            authProvider: "kakao",
            ...overrides,
        },
    });
    tracker.track("user", row.id);
    if (options.membership) {
        const membershipRow = await prisma.user_branch.create({
            data: {
                userId: row.id,
                branchId: options.membership.branchId,
                role: options.membership.role ?? "user",
            },
        });
        tracker.track("user_branch", membershipRow.id);
    }
    return row;
}

/** Creates a bare `user_branch` membership row (role defaults to the schema default "user"). */
export async function createUserBranchMembership(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    deps: { userId: string; branchId: string },
    overrides: Partial<Prisma.user_branchUncheckedCreateInput> = {},
): Promise<user_branch> {
    const row = await prisma.user_branch.create({
        data: {
            userId: deps.userId,
            branchId: deps.branchId,
            role: "user",
            ...overrides,
        },
    });
    tracker.track("user_branch", row.id);
    return row;
}

export interface AuthSessionFactoryResult {
    session: auth_session;
    /** The one active refresh token created for the session (its `activeMarker` defaults to "active"). */
    refreshToken: auth_refresh_token;
}

export interface CreateAuthSessionOptions {
    /** Overrides for the one active `auth_refresh_token` created with the session. */
    refreshToken?: Partial<Prisma.auth_refresh_tokenUncheckedCreateInput>;
}

export async function createAuthSession(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    deps: { userId: string },
    overrides: Partial<Prisma.auth_sessionUncheckedCreateInput> = {},
    options: CreateAuthSessionOptions = {},
): Promise<AuthSessionFactoryResult> {
    const suffix = uniqueSuffix();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    const session = await prisma.auth_session.create({
        data: {
            userId: deps.userId,
            expiresAt,
            ...overrides,
        },
    });
    tracker.track("auth_session", session.id);
    const refreshToken = await prisma.auth_refresh_token.create({
        data: {
            sessionId: session.id,
            secretHash: `si-${suffix}-secret-hash`,
            expiresAt,
            ...options.refreshToken,
        },
    });
    tracker.track("auth_refresh_token", refreshToken.id);
    return { session, refreshToken };
}

export async function createClient(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    overrides: Partial<Prisma.clientUncheckedCreateInput> = {},
): Promise<client> {
    const suffix = uniqueSuffix();
    const phone = uniquePhone();
    const row = await prisma.client.create({
        data: {
            name: `무결성 고객 ${suffix}`,
            phone: formattedPhone(phone),
            phoneNormalized: phone,
            voucherClient: false,
            ...overrides,
        },
    });
    tracker.track("client", row.id);
    return row;
}

export async function createEmployee(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    overrides: Partial<Prisma.employeeUncheckedCreateInput> = {},
): Promise<employee> {
    const suffix = uniqueSuffix();
    const phone = uniquePhone();
    const row = await prisma.employee.create({
        data: {
            name: `무결성 요보사 ${suffix}`,
            workArea: [],
            phone: formattedPhone(phone),
            phoneNormalized: phone,
            grade: DEFAULT_EMPLOYEE_GRADE,
            ...overrides,
        },
    });
    tracker.track("employee", row.id);
    return row;
}

export async function createEmployeeSchedule(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    deps: { clientId: number; primaryEmployeeId: number },
    overrides: Partial<Prisma.employee_scheduleUncheckedCreateInput> = {},
): Promise<employee_schedule> {
    const row = await prisma.employee_schedule.create({
        data: {
            clientId: deps.clientId,
            primaryEmployeeId: deps.primaryEmployeeId,
            workAddress: "서울시 강남구 테헤란로 123",
            startDate: d("2026-10-01"),
            endDate: d("2026-10-16"),
            ...overrides,
        },
    });
    tracker.track("employee_schedule", row.id);
    return row;
}

export async function createMessageTriggerRule(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    overrides: Partial<Prisma.message_trigger_ruleUncheckedCreateInput> = {},
): Promise<message_trigger_rule> {
    const suffix = uniqueSuffix();
    const row = await prisma.message_trigger_rule.create({
        data: {
            name: `무결성 규칙 ${suffix}`,
            eventType: MessageTriggerEventType.CLIENT_CREATED,
            offsetType: MessageTriggerOffsetType.IMMEDIATE,
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
            ...overrides,
        },
    });
    tracker.track("message_trigger_rule", row.id);
    return row;
}

export async function createMessageTriggerJob(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    deps: { ruleId: string },
    overrides: Partial<Prisma.message_trigger_jobUncheckedCreateInput> = {},
): Promise<message_trigger_job> {
    const suffix = uniqueSuffix();
    const row = await prisma.message_trigger_job.create({
        data: {
            ruleId: deps.ruleId,
            scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
            recipientType: MessageTriggerRecipientType.CLIENT,
            templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
            dedupeKey: `si-${suffix}`,
            status: "pending",
            ...overrides,
        },
    });
    tracker.track("message_trigger_job", row.id);
    return row;
}

export async function createMessageLog(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    overrides: Partial<Prisma.message_logUncheckedCreateInput> = {},
): Promise<message_log> {
    const suffix = uniqueSuffix();
    const row = await prisma.message_log.create({
        data: {
            provider: "aligo_sms",
            templateKey: MessageTriggerTemplateKey.SERVICE_START_REMINDER,
            receiver: uniquePhone(),
            messageBody: `무결성 테스트 메시지 ${suffix}`,
            status: "pending",
            ...overrides,
        },
    });
    tracker.track("message_log", row.id);
    return row;
}

export async function createEformsignDoc(
    prisma: IntegrityPrisma,
    tracker: RowTracker,
    overrides: Partial<Prisma.eformsign_docUncheckedCreateInput> = {},
): Promise<eformsign_doc> {
    const suffix = uniqueSuffix();
    const now = new Date();
    const row = await prisma.eformsign_doc.create({
        data: {
            documentId: `si-${suffix}`,
            createdDate: now,
            updatedDate: now,
            statusType: "050",
            statusDetail: "Complete",
            stepType: "reviewer",
            stepIndex: "1",
            stepName: "reviewer",
            stepRecipientType: "client",
            stepRecipientName: "무결성 계약자",
            stepRecipientSms: uniquePhone(),
            expiredDate: d("2099-01-01"),
            ...overrides,
        },
    });
    tracker.track("eformsign_doc", row.id);
    return row;
}
