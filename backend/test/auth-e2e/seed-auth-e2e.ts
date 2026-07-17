import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const PASSWORD = "Password1!";

const ids = {
    owner: "10000000-0000-4000-8000-000000000001",
    adminA: "10000000-0000-4000-8000-000000000002",
    userA: "10000000-0000-4000-8000-000000000003",
    adminB: "10000000-0000-4000-8000-000000000004",
    userB: "10000000-0000-4000-8000-000000000005",
    manager: "10000000-0000-4000-8000-000000000006",
    pending: "10000000-0000-4000-8000-000000000007",
    unverified: "10000000-0000-4000-8000-000000000008",
    oauth: "10000000-0000-4000-8000-000000000009",
    branchA: "20000000-0000-4000-8000-000000000001",
    branchB: "20000000-0000-4000-8000-000000000002",
} as const;

async function upsertUser(params: {
    id: string;
    email: string;
    role: string | null;
    approvalStatus?: string;
    emailVerified?: boolean;
    kakaoId?: string;
}): Promise<void> {
    const passwordHash = params.kakaoId ? null : await bcrypt.hash(PASSWORD, 4);
    await prisma.user.upsert({
        where: { id: params.id },
        update: {
            email: params.email,
            name: params.email.split("@")[0],
            phone: `010${params.id.slice(-8)}`,
            birthDate: "1990-01-01",
            role: params.role,
            approvalStatus: params.approvalStatus ?? "approved",
            emailVerified: params.emailVerified ?? true,
            passwordHash,
            kakaoId: params.kakaoId,
            authProvider: params.kakaoId ? "kakao" : "email",
            tokenVersion: 0,
        },
        create: {
            id: params.id,
            email: params.email,
            name: params.email.split("@")[0],
            phone: `010${params.id.slice(-8)}`,
            birthDate: "1990-01-01",
            role: params.role,
            approvalStatus: params.approvalStatus ?? "approved",
            emailVerified: params.emailVerified ?? true,
            passwordHash,
            kakaoId: params.kakaoId,
            authProvider: params.kakaoId ? "kakao" : "email",
            tokenVersion: 0,
        },
    });
}

async function membership(
    userId: string,
    branchId: string,
    role: string,
): Promise<void> {
    await prisma.user_branch.upsert({
        where: { userId_branchId: { userId, branchId } },
        update: { role },
        create: { userId, branchId, role },
    });
}

async function main(): Promise<void> {
    await upsertUser({
        id: ids.owner,
        email: "owner@auth-e2e.test",
        role: "owner",
    });
    await prisma.branch.upsert({
        where: { id: ids.branchA },
        update: { name: "Auth E2E A", slug: "auth-e2e-a", ownerId: ids.owner, isActive: true },
        create: { id: ids.branchA, name: "Auth E2E A", slug: "auth-e2e-a", ownerId: ids.owner, isActive: true },
    });
    await prisma.branch.upsert({
        where: { id: ids.branchB },
        update: { name: "Auth E2E B", slug: "auth-e2e-b", ownerId: ids.owner, isActive: true },
        create: { id: ids.branchB, name: "Auth E2E B", slug: "auth-e2e-b", ownerId: ids.owner, isActive: true },
    });

    await Promise.all([
        upsertUser({ id: ids.adminA, email: "admin-a@auth-e2e.test", role: "admin" }),
        upsertUser({ id: ids.userA, email: "user-a@auth-e2e.test", role: "user" }),
        upsertUser({ id: ids.adminB, email: "admin-b@auth-e2e.test", role: "admin" }),
        upsertUser({ id: ids.userB, email: "user-b@auth-e2e.test", role: "user" }),
        upsertUser({ id: ids.manager, email: "manager@auth-e2e.test", role: "manager" }),
        upsertUser({ id: ids.pending, email: "pending@auth-e2e.test", role: null, approvalStatus: "pending" }),
        upsertUser({ id: ids.unverified, email: "unverified@auth-e2e.test", role: "user", emailVerified: false }),
        upsertUser({ id: ids.oauth, email: "oauth@auth-e2e.test", role: "user", kakaoId: "auth-e2e-kakao" }),
    ]);

    await Promise.all([
        membership(ids.adminA, ids.branchA, "admin"),
        membership(ids.userA, ids.branchA, "user"),
        membership(ids.adminB, ids.branchB, "admin"),
        membership(ids.userB, ids.branchB, "user"),
        membership(ids.manager, ids.branchA, "manager"),
        membership(ids.manager, ids.branchB, "manager"),
        membership(ids.unverified, ids.branchA, "user"),
        membership(ids.oauth, ids.branchA, "user"),
    ]);

    await prisma.auth_refresh_token.deleteMany();
    await prisma.auth_session.deleteMany();
    await prisma.auth_rate_limit.deleteMany();

    console.log("Seeded isolated auth E2E users and branches");
}

main()
    .catch((error) => {
        console.error(error);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
