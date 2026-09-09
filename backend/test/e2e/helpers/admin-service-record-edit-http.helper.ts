import { randomUUID } from "node:crypto";
import { JwtService, type JwtSignOptions } from "@nestjs/jwt";
import { PrismaClient } from "@prisma/client";

/**
 * Phase 6 uses one disposable PostgreSQL database.  Both Prisma URLs must
 * point at that exact loopback target before a client is constructed.
 */
export const SERVICE_RECORD_EDIT_HTTP_DATABASE =
    "postgresql://bjj_revision_test@127.0.0.1:62295/bjj_revision_task4";

export function assertApprovedServiceRecordEditHttpDatabaseTarget(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
): void {
    if (databaseUrl !== SERVICE_RECORD_EDIT_HTTP_DATABASE || directUrl !== SERVICE_RECORD_EDIT_HTTP_DATABASE) {
        throw new Error("Refusing service-record HTTP E2E outside the exact disposable task-4 database");
    }
}

/** Construct a client only after the exact target guard has passed. */
export function createApprovedServiceRecordEditHttpClient(
    databaseUrl = process.env["DATABASE_URL"],
    directUrl = process.env["DIRECT_URL"],
): PrismaClient {
    assertApprovedServiceRecordEditHttpDatabaseTarget(databaseUrl, directUrl);
    return new PrismaClient({ datasources: { db: { url: SERVICE_RECORD_EDIT_HTTP_DATABASE } } });
}

export interface HttpAuthFixture {
    userId: string;
    sessionId: string;
    branchId: string;
    role: string;
    branchRole: string;
    tokenVersion: number;
}

export interface AdminServiceRecordEditHttpFixture {
    activeBranchId: string;
    otherBranchId: string;
    inactiveBranchId: string;
    activeClientId: number;
    otherClientId: number;
    owner: HttpAuthFixture;
    admin: HttpAuthFixture;
    nonAdmin: HttpAuthFixture;
    inactiveAdmin: HttpAuthFixture;
    missingMembershipAdmin: HttpAuthFixture;
    expiredSessionAdmin: HttpAuthFixture;
    revokedSessionAdmin: HttpAuthFixture;
    wrongSessionAdmin: HttpAuthFixture;
}

interface CreateUserInput {
    role: string;
    name: string;
}

async function createUser(prisma: PrismaClient, input: CreateUserInput): Promise<{ id: string }> {
    return prisma.user.create({
        data: {
            id: randomUUID(),
            email: `${randomUUID()}@service-record-http.test`,
            name: input.name,
            role: input.role,
            approvalStatus: "approved",
            tokenVersion: 0,
        },
        select: { id: true },
    });
}

async function createBranch(
    prisma: PrismaClient,
    name: string,
    isActive: boolean,
    ownerId?: string,
): Promise<{ id: string }> {
    return prisma.branch.create({
        data: {
            id: randomUUID(),
            name,
            slug: `service-record-http-${randomUUID()}`,
            isActive,
            ...(ownerId ? { ownerId } : {}),
        },
        select: { id: true },
    });
}

async function createAuthFixture(
    prisma: PrismaClient,
    input: {
        role: string;
        branchRole: string;
        branchId: string;
        name: string;
        membership?: boolean;
        sessionExpiresAt?: Date;
        revokedAt?: Date;
    },
): Promise<HttpAuthFixture> {
    const user = await createUser(prisma, { role: input.role, name: input.name });
    if (input.membership !== false) {
        await prisma.user_branch.create({
            data: {
                userId: user.id,
                branchId: input.branchId,
                role: input.branchRole,
            },
        });
    }

    const sessionId = randomUUID();
    await prisma.auth_session.create({
        data: {
            id: sessionId,
            userId: user.id,
            selectedBranchId: input.branchId,
            expiresAt: input.sessionExpiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
            revokedAt: input.revokedAt,
        },
    });

    return {
        userId: user.id,
        sessionId,
        branchId: input.branchId,
        role: input.role,
        branchRole: input.branchRole,
        tokenVersion: 0,
    };
}

/**
 * Create only the rows required by the real JWT, tenant, and owner/admin
 * guards.  IDs are random so repeated runs can share the disposable database
 * without deleting append-only service-record history.
 */
export async function createAdminServiceRecordEditHttpFixture(
    prisma: PrismaClient,
): Promise<AdminServiceRecordEditHttpFixture> {
    assertApprovedServiceRecordEditHttpDatabaseTarget();

    const ownerUser = await createUser(prisma, { role: "owner", name: "HTTP owner" });
    const activeBranch = await createBranch(prisma, "HTTP active branch", true, ownerUser.id);
    const otherBranch = await createBranch(prisma, "HTTP other branch", true, ownerUser.id);
    const inactiveBranch = await createBranch(prisma, "HTTP inactive branch", false, ownerUser.id);

    const activeClient = await prisma.client.create({
        data: {
            name: "HTTP active client",
            voucherClient: true,
            duration: 15,
            branchId: activeBranch.id,
        },
        select: { id: true },
    });
    const otherClient = await prisma.client.create({
        data: {
            name: "HTTP other client",
            voucherClient: true,
            duration: 15,
            branchId: otherBranch.id,
        },
        select: { id: true },
    });

    const [admin, nonAdmin, inactiveAdmin, missingMembershipAdmin, expiredSessionAdmin, revokedSessionAdmin] = await Promise.all([
        createAuthFixture(prisma, {
            role: "admin",
            branchRole: "admin",
            branchId: activeBranch.id,
            name: "HTTP branch admin",
        }),
        createAuthFixture(prisma, {
            role: "user",
            branchRole: "user",
            branchId: activeBranch.id,
            name: "HTTP non-admin",
        }),
        createAuthFixture(prisma, {
            role: "admin",
            branchRole: "admin",
            branchId: inactiveBranch.id,
            name: "HTTP inactive branch admin",
        }),
        createAuthFixture(prisma, {
            role: "admin",
            branchRole: "admin",
            branchId: activeBranch.id,
            name: "HTTP missing membership admin",
            membership: false,
        }),
        createAuthFixture(prisma, {
            role: "admin",
            branchRole: "admin",
            branchId: activeBranch.id,
            name: "HTTP expired session admin",
            sessionExpiresAt: new Date(Date.now() - 60 * 1000),
        }),
        createAuthFixture(prisma, {
            role: "admin",
            branchRole: "admin",
            branchId: activeBranch.id,
            name: "HTTP revoked session admin",
            revokedAt: new Date(),
        }),
    ]);

    const ownerSessionId = randomUUID();
    await prisma.auth_session.create({
        data: {
            id: ownerSessionId,
            userId: ownerUser.id,
            selectedBranchId: activeBranch.id,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
    });
    const owner: HttpAuthFixture = {
        userId: ownerUser.id,
        sessionId: ownerSessionId,
        branchId: activeBranch.id,
        role: "owner",
        branchRole: "owner",
        tokenVersion: 0,
    };

    // A correctly signed token whose session belongs to another user must be
    // rejected by JwtStrategy's user/session identity check.
    const wrongSessionAdmin: HttpAuthFixture = {
        ...admin,
        sessionId: nonAdmin.sessionId,
    };

    return {
        activeBranchId: activeBranch.id,
        otherBranchId: otherBranch.id,
        inactiveBranchId: inactiveBranch.id,
        activeClientId: activeClient.id,
        otherClientId: otherClient.id,
        owner,
        admin,
        nonAdmin,
        inactiveAdmin,
        missingMembershipAdmin,
        expiredSessionAdmin,
        revokedSessionAdmin,
        wrongSessionAdmin,
    };
}

export interface AccessTokenOverrides {
    sessionId?: string;
    userId?: string;
    branchId?: string;
    branchRole?: string;
    role?: string;
    tokenVersion?: number;
    expiresIn?: JwtSignOptions["expiresIn"];
}

export async function issueAdminServiceRecordEditHttpToken(
    jwt: JwtService,
    fixture: HttpAuthFixture,
    overrides: AccessTokenOverrides = {},
): Promise<string> {
    return jwt.signAsync(
        {
            sub: overrides.userId ?? fixture.userId,
            sid: overrides.sessionId ?? fixture.sessionId,
            role: overrides.role ?? fixture.role,
            tokenVersion: overrides.tokenVersion ?? fixture.tokenVersion,
            type: "access",
            branchId: overrides.branchId ?? fixture.branchId,
            branchRole: overrides.branchRole ?? fixture.branchRole,
        },
        overrides.expiresIn === undefined ? undefined : { expiresIn: overrides.expiresIn },
    );
}
