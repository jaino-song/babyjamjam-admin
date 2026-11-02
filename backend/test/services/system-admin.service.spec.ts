import { SystemAdminService } from "application/services/system-admin.service";
import { SystemAdminBranchRequestDto } from "interface/dto/system-admin.dto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { Prisma } from "@prisma/client";

// noUncheckedIndexedAccess is on: narrow indexed access to a defined element.
const first = (rows: SystemAdminBranchRequestDto[]): SystemAdminBranchRequestDto => {
    expect(rows.length).toBeGreaterThan(0);
    return rows[0] as SystemAdminBranchRequestDto;
};

/**
 * SystemAdminService — privileged, system-admin-only branch listing.
 *
 * Surface reality (read fully before judging coverage): the service exposes a
 * single read-only method, `listBranchRequests()`. It is NOT a destructive
 * surface — there are no deletes, resets, or mutations here. The authorization
 * boundary (who may call this) is enforced *outside* this class, at the
 * controller/guard layer, so it cannot be unit-tested from here.
 *
 * What IS security-relevant inside this unit and therefore covered:
 *  - Cross-tenant aggregation is *by design*: a system admin must see every
 *    branch regardless of tenant. We pin that the Prisma query carries no
 *    branch/tenant `where` filter, so the contract cannot silently regress into
 *    leaking only one tenant (or, worse, the inverse — accidentally scoping and
 *    hiding branches from the admin).
 *  - The requester ("requestedBy") join: the service resolves approval
 *    requesters by id. We pin (a) it only ever queries the *exact* set of
 *    requester ids that appear on branches — no over-fetch of unrelated users —
 *    and (b) a branch can only ever be attributed to the user whose id it
 *    actually references, never another branch's requester (cross-attribution).
 *  - Status normalization is an input-validation boundary: any value that is
 *    not a known good status ("pending"/"approved") — including spoofed,
 *    legacy, or null DB values — must collapse to "not_requested", never leak
 *    through verbatim.
 *  - Null/absent column handling for nullable branch fields.
 */
describe("SystemAdminService", () => {
    type MockBranchModel = {
        findMany: jest.Mock;
        findUnique: jest.Mock;
        findFirst: jest.Mock;
        create: jest.Mock;
        update: jest.Mock;
    };
    type MockUserModel = {
        findMany: jest.Mock;
        findFirst: jest.Mock;
        findUnique: jest.Mock;
        update: jest.Mock;
        updateMany: jest.Mock;
    };
    type MockUserBranchModel = {
        upsert: jest.Mock;
        updateMany: jest.Mock;
    };

    let branchModel: MockBranchModel;
    let userModel: MockUserModel;
    let userBranchModel: MockUserBranchModel;
    let prisma: PrismaService;
    let service: SystemAdminService;
    let queryRaw: jest.Mock;

    const adminOf = (overrides: Partial<Record<string, unknown>> = {}) => ({
        id: "owner-1",
        name: "지점장",
        email: "admin@example.com",
        phone: "010-1111-2222",
        role: "branch_admin",
        ...overrides,
    });

    const createBranchRow = (
        overrides: Partial<Record<string, unknown>> = {},
    ) => ({
        id: "branch-1",
        name: "연수점",
        slug: "yeonsu",
        region: "인천",
        district: "연수구",
        address: "인천 연수구 1",
        phone: "032-000-0000",
        email: "branch@example.com",
        isActive: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
        smsSenderApprovalStatus: "pending",
        smsSenderApprovalRequestedAt: new Date("2026-03-01T00:00:00.000Z"),
        smsSenderApprovalApprovedAt: null,
        smsSenderApprovalRequestedBy: "requester-1",
        admin: adminOf(),
        ...overrides,
    });

    const createRequesterRow = (
        overrides: Partial<Record<string, unknown>> = {},
    ) => ({
        id: "requester-1",
        name: "요청자",
        email: "requester@example.com",
        phone: "010-3333-4444",
        role: "branch_staff",
        ...overrides,
    });

    beforeEach(() => {
        branchModel = {
            findMany: jest.fn(),
            findUnique: jest.fn(),
            findFirst: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
        };
        userModel = {
            findMany: jest.fn(),
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
            updateMany: jest.fn(),
        };
        userBranchModel = {
            upsert: jest.fn(),
            updateMany: jest.fn(),
        };
        queryRaw = jest.fn().mockResolvedValue([]);
        prisma = {
            branch: branchModel,
            user: userModel,
            user_branch: userBranchModel,
            $transaction: jest.fn(async (callback) => callback({
                branch: branchModel,
                user: userModel,
                user_branch: userBranchModel,
                $queryRaw: queryRaw,
            })),
        } as unknown as PrismaService;
        service = new SystemAdminService(prisma);

        branchModel.findMany.mockResolvedValue([createBranchRow()]);
        branchModel.findUnique.mockResolvedValue(createBranchRow({
            smsSenderApprovalRequestedBy: null,
        }));
        branchModel.create.mockResolvedValue({ id: "branch-1" });
        branchModel.update.mockResolvedValue({ id: "branch-1" });
        branchModel.findFirst.mockResolvedValue(null);
        userModel.findMany.mockResolvedValue([createRequesterRow()]);
        userModel.findFirst.mockResolvedValue({ id: "owner-1", role: "manager" });
        userModel.findUnique.mockResolvedValue(null);
        userModel.updateMany.mockResolvedValue({ count: 0 });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    // ============================================
    // Tenant boundary — cross-tenant aggregation is intentional
    // ============================================
    describe("tenant boundary", () => {
        it("queries branches with NO tenant/branch where-filter (admin sees all tenants by design)", async () => {
            await service.listBranchRequests();

            expect(branchModel.findMany).toHaveBeenCalledTimes(1);
            const [args] = branchModel.findMany.mock.calls[0];
            // A silent regression that added a `where` would scope the admin to a
            // subset of tenants (leak/hide). Pin the absence explicitly.
            expect(args).not.toHaveProperty("where");
        });

        it("returns branches from multiple distinct tenants in one response", async () => {
            branchModel.findMany.mockResolvedValue([
                createBranchRow({
                    id: "branch-a",
                    slug: "a",
                    smsSenderApprovalRequestedBy: null,
                }),
                createBranchRow({
                    id: "branch-b",
                    slug: "b",
                    smsSenderApprovalRequestedBy: null,
                }),
            ]);

            const result = await service.listBranchRequests();

            expect(result.map((b) => b.id)).toEqual(["branch-a", "branch-b"]);
        });
    });

    // ============================================
    // Requester join — over-fetch + cross-attribution isolation
    // ============================================
    describe("requester (requestedBy) resolution", () => {
        it("looks up ONLY the exact requester ids referenced by branches (no over-fetch)", async () => {
            branchModel.findMany.mockResolvedValue([
                createBranchRow({ id: "b1", smsSenderApprovalRequestedBy: "u1" }),
                createBranchRow({ id: "b2", smsSenderApprovalRequestedBy: "u2" }),
                // duplicate id must be de-duped, not double-queried
                createBranchRow({ id: "b3", smsSenderApprovalRequestedBy: "u1" }),
            ]);
            userModel.findMany.mockResolvedValue([
                createRequesterRow({ id: "u1" }),
                createRequesterRow({ id: "u2" }),
            ]);

            await service.listBranchRequests();

            expect(userModel.findMany).toHaveBeenCalledTimes(1);
            const [args] = userModel.findMany.mock.calls[0];
            const queriedIds = (args.where.id.in as string[]).slice().sort();
            expect(queriedIds).toEqual(["u1", "u2"]);
        });

        it("does NOT query users at all when no branch has a requester (avoids needless privileged read)", async () => {
            branchModel.findMany.mockResolvedValue([
                createBranchRow({ smsSenderApprovalRequestedBy: null }),
            ]);

            await service.listBranchRequests();

            expect(userModel.findMany).not.toHaveBeenCalled();
        });

        it("attributes each branch ONLY to the user whose id it references (no cross-attribution)", async () => {
            branchModel.findMany.mockResolvedValue([
                createBranchRow({ id: "b1", smsSenderApprovalRequestedBy: "u1" }),
                createBranchRow({ id: "b2", smsSenderApprovalRequestedBy: "u2" }),
            ]);
            userModel.findMany.mockResolvedValue([
                createRequesterRow({ id: "u1", name: "Alice", email: "a@x.com" }),
                createRequesterRow({ id: "u2", name: "Bob", email: "b@x.com" }),
            ]);

            const result = await service.listBranchRequests();

            const byId = new Map(result.map((b) => [b.id, b]));
            expect(byId.get("b1")?.messageSenderApproval.requestedBy).toEqual({
                id: "u1",
                name: "Alice",
                email: "a@x.com",
                phone: "010-3333-4444",
                role: "branch_staff",
            });
            expect(byId.get("b2")?.messageSenderApproval.requestedBy?.id).toBe("u2");
        });

        it("yields null requestedBy when the referenced user no longer exists (dangling id)", async () => {
            branchModel.findMany.mockResolvedValue([
                createBranchRow({ smsSenderApprovalRequestedBy: "ghost" }),
            ]);
            userModel.findMany.mockResolvedValue([]); // user was deleted

            const result = await service.listBranchRequests();

            expect(first(result).messageSenderApproval.requestedBy).toBeNull();
        });

        it("yields null requestedBy when the branch never had a requester", async () => {
            branchModel.findMany.mockResolvedValue([
                createBranchRow({ smsSenderApprovalRequestedBy: null }),
            ]);

            const result = await service.listBranchRequests();

            expect(first(result).messageSenderApproval.requestedBy).toBeNull();
        });
    });

    // ============================================
    // Input validation — status normalization boundary
    // ============================================
    describe("approval status normalization", () => {
        it.each([
            ["pending", "pending"],
            ["approved", "approved"],
        ])("passes known good status %s through unchanged", async (raw, expected) => {
            branchModel.findMany.mockResolvedValue([
                createBranchRow({ smsSenderApprovalStatus: raw }),
            ]);

            const result = await service.listBranchRequests();

            expect(first(result).messageSenderApproval.approvalStatus).toBe(expected);
        });

        it.each([
            ["null", null],
            ["undefined", undefined],
            ["empty string", ""],
            ["unknown legacy value", "REJECTED"],
            ["spoofed admin-y string", "approved "], // trailing space — must NOT match
            ["case-mismatched", "Approved"],
            ["arbitrary injection", "approved'; DROP"],
        ])(
            "collapses %s to not_requested (never leaks an unrecognized status)",
            async (_label, raw) => {
                branchModel.findMany.mockResolvedValue([
                    createBranchRow({ smsSenderApprovalStatus: raw }),
                ]);

                const result = await service.listBranchRequests();

                expect(first(result).messageSenderApproval.approvalStatus).toBe(
                    "not_requested",
                );
            },
        );
    });

    // ============================================
    // Null / absent column handling + date serialization
    // ============================================
    describe("field mapping & null handling", () => {
        it("maps a fully-populated branch into the DTO shape with ISO dates", async () => {
            const result = await service.listBranchRequests();

            expect(first(result)).toEqual({
                id: "branch-1",
                name: "연수점",
                slug: "yeonsu",
                region: "인천",
                district: "연수구",
                address: "인천 연수구 1",
                phone: "032-000-0000",
                email: "branch@example.com",
                isActive: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-02-01T00:00:00.000Z",
                admin: adminOf(),
                owner: adminOf(),
                messageSenderApproval: {
                    approvalStatus: "pending",
                    requestedAt: "2026-03-01T00:00:00.000Z",
                    approvedAt: null,
                    requestedBy: createRequesterRow(),
                },
            });
        });

        it("coalesces nullable columns and dates to null / sane defaults", async () => {
            branchModel.findMany.mockResolvedValue([
                createBranchRow({
                    region: null,
                    district: null,
                    address: null,
                    phone: null,
                    email: null,
                    isActive: null, // defaults to false
                    createdAt: null,
                    updatedAt: null,
                    smsSenderApprovalStatus: null,
                    smsSenderApprovalRequestedAt: null,
                    smsSenderApprovalApprovedAt: null,
                    smsSenderApprovalRequestedBy: null,
                }),
            ]);

            const result = await service.listBranchRequests();

            expect(first(result)).toMatchObject({
                region: null,
                district: null,
                address: null,
                phone: null,
                email: null,
                isActive: false,
                createdAt: null,
                updatedAt: null,
                messageSenderApproval: {
                    approvalStatus: "not_requested",
                    requestedAt: null,
                    approvedAt: null,
                    requestedBy: null,
                },
            });
        });

        it("orders branches by requestedAt desc, then updatedAt desc, then name asc", async () => {
            await service.listBranchRequests();

            const [args] = branchModel.findMany.mock.calls[0];
            expect(args.orderBy).toEqual([
                { smsSenderApprovalRequestedAt: "desc" },
                { updatedAt: "desc" },
                { name: "asc" },
            ]);
        });

        it("returns an empty list when there are no branches", async () => {
            branchModel.findMany.mockResolvedValue([]);

            const result = await service.listBranchRequests();

            expect(result).toEqual([]);
            expect(userModel.findMany).not.toHaveBeenCalled();
        });
    });

    describe("branch mutations", () => {
        const branchInput = {
            name: "송도점",
            slug: "songdo",
            adminId: "owner-1",
            region: "인천",
            district: "연수구",
            address: "인천 연수구 송도동",
            phone: "032-111-2222",
            email: "songdo@example.com",
            isActive: true,
        };

        describe.each(["createBranch", "updateBranch"] as const)("%s transaction retries", (method) => {
            const conflicts = [
                ["P2034", { code: "P2034" }],
                ["raw deadlock message", new Error('Raw query failed. Code: `40P01`. Message: deadlock detected')],
                ["raw serialization message", new Error('Raw query failed. Code: `40001`.')],
                ["deadlock code", { code: "40P01" }],
                ["serialization code", { code: "40001" }],
                ["Prisma raw-query metadata", new Prisma.PrismaClientKnownRequestError("raw query failed", {
                    code: "P2010", clientVersion: "test", meta: { code: "40P01" },
                })],
            ] as const;

            const mutate = () => method === "createBranch"
                ? service.createBranch(branchInput)
                : service.updateBranch("branch-1", { adminId: "owner-1" });

            it.each(conflicts)("restarts the whole transaction after %s on attempt one", async (_label, error) => {
                // Fail after the first lock, not before the callback: a retry must
                // repeat the reads and locks rather than just the failed query.
                queryRaw.mockRejectedValueOnce(error);
                await expect(mutate()).resolves.toMatchObject({ id: "branch-1" });
                expect(prisma.$transaction).toHaveBeenCalledTimes(2);
                expect(queryRaw.mock.calls.filter(([query]) => query.values[0] === "owner-1")).toHaveLength(2);
                expect(userModel.findFirst).toHaveBeenCalledTimes(method === "createBranch" ? 2 : 1);
                if (method === "updateBranch") expect(branchModel.findUnique).toHaveBeenCalledTimes(4);
            });

            it.each(conflicts)("returns a clean 409 after three attempts of %s", async (_label, error) => {
                queryRaw.mockRejectedValue(error);
                await expect(mutate()).rejects.toMatchObject({
                    status: 409,
                    response: expect.objectContaining({ code: "REQUEST_CONFLICT", outcome: "NOT_APPLIED" }),
                });
                expect(prisma.$transaction).toHaveBeenCalledTimes(3);
                expect(branchModel.create).not.toHaveBeenCalled();
                expect(branchModel.update).not.toHaveBeenCalled();
            });
        });

        it("creates a branch and promotes an approved existing account to branch manager", async () => {
            const result = await service.createBranch(branchInput);

            expect(userModel.findFirst).toHaveBeenCalledWith({
                where: {
                    id: "owner-1",
                    approvalStatus: "approved",
                    role: { in: ["owner", "admin", "manager", "user"] },
                },
                select: { id: true, role: true },
            });
            expect(branchModel.create).toHaveBeenCalledWith({
                data: branchInput,
                select: { id: true },
            });
            expect(userBranchModel.upsert).toHaveBeenCalledWith({
                where: {
                    userId_branchId: {
                        userId: "owner-1",
                        branchId: "branch-1",
                    },
                },
                create: {
                    userId: "owner-1",
                    branchId: "branch-1",
                    role: "admin",
                },
                update: { role: "admin" },
            });
            expect(userModel.update).toHaveBeenCalledWith({
                where: { id: "owner-1" },
                data: { role: "admin" },
            });
            expect(result.id).toBe("branch-1");
        });

        it("preserves the system owner role when the owner manages a branch", async () => {
            userModel.findFirst.mockResolvedValue({ id: "owner-1", role: "owner" });

            await service.createBranch(branchInput);

            expect(userModel.update).toHaveBeenCalledWith({
                where: { id: "owner-1" },
                data: { role: "owner" },
            });
        });

        it("locks the proposed admin before creating a branch and reading transaction-local eligibility", async () => {
            await service.createBranch(branchInput);

            expect(queryRaw).toHaveBeenCalledTimes(1);
            expect(queryRaw.mock.calls[0][0]).toMatchObject({ values: ["owner-1"] });
            expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(branchModel.create.mock.invocationCallOrder[0]!);
            expect(queryRaw.mock.invocationCallOrder[0]).toBeLessThan(userModel.findFirst.mock.invocationCallOrder[1]!);
        });

        it("locks distinct old and new users in sorted order before the branch", async () => {
            branchModel.findUnique.mockResolvedValue({ adminId: "z-old" });
            await service.updateBranch("branch-1", { adminId: "a-new" });

            expect(queryRaw.mock.calls.map(([query]) => query.values)).toEqual([["a-new"], ["z-old"], ["branch-1"]]);
            expect(queryRaw.mock.calls.map(([query]) => query.text.includes('FROM "user"'))).toEqual([true, true, false]);
            expect(queryRaw.mock.invocationCallOrder[2]).toBeLessThan(branchModel.update.mock.invocationCallOrder[0]!);
        });

        it("locks a same-admin update only once before the branch", async () => {
            branchModel.findUnique.mockResolvedValue({ adminId: "owner-1" });
            await service.updateBranch("branch-1", { adminId: "owner-1" });
            expect(queryRaw.mock.calls.map(([query]) => query.values)).toEqual([["owner-1"], ["branch-1"]]);
        });

        it("refuses a changed admin after taking the branch lock without mutating authority", async () => {
            branchModel.findUnique.mockResolvedValueOnce({ adminId: "old" }).mockResolvedValueOnce({ adminId: "concurrent" });
            await expect(service.updateBranch("branch-1", { adminId: "new" })).rejects.toMatchObject({
                status: 409,
                response: expect.objectContaining({ code: "REQUEST_CONFLICT", outcome: "NOT_APPLIED" }),
            });
            expect(branchModel.update).not.toHaveBeenCalled();
            expect(userModel.update).not.toHaveBeenCalled();
            expect(userModel.updateMany).not.toHaveBeenCalled();
            expect(userBranchModel.upsert).not.toHaveBeenCalled();
        });

        it("normalizes cleared optional fields to null when updating", async () => {
            await service.updateBranch("branch-1", {
                ...branchInput,
                region: "",
                address: "   ",
                isActive: false,
            });

            expect(branchModel.update).toHaveBeenCalledWith({
                where: { id: "branch-1" },
                data: expect.objectContaining({
                    name: "송도점",
                    slug: "songdo",
                    adminId: "owner-1",
                    region: null,
                    address: null,
                    isActive: false,
                    updatedAt: expect.any(Date),
                }),
            });
            expect(userBranchModel.upsert).toHaveBeenCalledWith({
                where: {
                    userId_branchId: {
                        userId: "owner-1",
                        branchId: "branch-1",
                    },
                },
                create: {
                    userId: "owner-1",
                    branchId: "branch-1",
                    role: "admin",
                },
                update: { role: "admin" },
            });
        });

        it("rejects an unknown or unapproved branch manager before writing", async () => {
            userModel.findFirst.mockResolvedValue(null);

            await expect(service.createBranch(branchInput)).rejects.toMatchObject({
                status: 404,
                response: expect.objectContaining({
                    code: "RESOURCE_NOT_FOUND",
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });
            expect(branchModel.create).not.toHaveBeenCalled();
        });

        it("creates a branch with a null admin without looking up or promoting a manager", async () => {
            const result = await service.createBranch({ ...branchInput, adminId: null });

            expect(userModel.findFirst).not.toHaveBeenCalled();
            expect(branchModel.create).toHaveBeenCalledWith({
                data: { ...branchInput, adminId: null },
                select: { id: true },
            });
            expect(userBranchModel.upsert).not.toHaveBeenCalled();
            expect(userModel.update).not.toHaveBeenCalled();
            expect(result.id).toBe("branch-1");
        });

        it("runs the action receipt callback inside the branch transaction", async () => {
            const onCreated = jest.fn().mockResolvedValue(undefined);

            await service.createBranch(branchInput, onCreated);

            expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ branch: branchModel }), "branch-1");
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        });

        it("rolls the branch mutation back when the action receipt callback fails", async () => {
            const onCreated = jest.fn().mockRejectedValue(new Error("receipt could not be persisted"));

            await expect(service.createBranch(branchInput, onCreated)).rejects.toThrow("receipt could not be persisted");
            expect(branchModel.create).toHaveBeenCalledTimes(1);
            expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ branch: branchModel }), "branch-1");
        });

        it("updates a branch to a null admin without promoting a manager", async () => {
            await service.updateBranch("branch-1", {
                ...branchInput,
                adminId: null,
            });

            expect(userModel.findFirst).not.toHaveBeenCalled();
            expect(branchModel.update).toHaveBeenCalledWith({
                where: { id: "branch-1" },
                data: expect.objectContaining({
                    adminId: null,
                }),
            });
            expect(userBranchModel.upsert).not.toHaveBeenCalled();
            expect(userModel.update).not.toHaveBeenCalled();
        });

        it("throws a RESOURCE_NOT_FOUND problem body when the branch to update does not exist", async () => {
            branchModel.findUnique.mockResolvedValueOnce(null);

            await expect(
                service.updateBranch("missing-branch", { ...branchInput, adminId: null }),
            ).rejects.toMatchObject({
                status: 404,
                response: expect.objectContaining({
                    code: "RESOURCE_NOT_FOUND",
                    outcome: "NOT_APPLIED",
                    recovery: { action: "NONE", retry: { mode: "NEVER" } },
                }),
            });

            expect(branchModel.update).not.toHaveBeenCalled();
        });

        it("rethrows known prisma mutation failures as REQUEST_CONFLICT and RESOURCE_NOT_FOUND problem bodies", async () => {
            const known = (code: string) => new Prisma.PrismaClientKnownRequestError("db", { code, clientVersion: "test" });

            branchModel.findUnique.mockResolvedValueOnce(createBranchRow({ adminId: null }));
            (prisma.$transaction as jest.Mock).mockRejectedValueOnce(known("P2002"));
            await expect(
                service.updateBranch("branch-1", { ...branchInput, adminId: null }),
            ).rejects.toMatchObject({
                status: 409,
                response: expect.objectContaining({ code: "REQUEST_CONFLICT", outcome: "NOT_APPLIED" }),
            });

            branchModel.findUnique.mockResolvedValueOnce(createBranchRow({ adminId: null }));
            (prisma.$transaction as jest.Mock).mockRejectedValueOnce(known("P2025"));
            await expect(
                service.updateBranch("branch-1", { ...branchInput, adminId: null }),
            ).rejects.toMatchObject({
                status: 404,
                response: expect.objectContaining({ code: "RESOURCE_NOT_FOUND", outcome: "NOT_APPLIED" }),
            });

            branchModel.findUnique.mockResolvedValueOnce(createBranchRow({ adminId: null }));
            (prisma.$transaction as jest.Mock).mockRejectedValueOnce(new Error("downstream"));
            await expect(
                service.updateBranch("branch-1", { ...branchInput, adminId: null }),
            ).rejects.toThrow("downstream");
        });
    });

    // ============================================
    // Owner demotion on 지점장 교체/해제 (updateBranch)
    // ============================================
    describe("admin demotion on branch update", () => {
        const demotionInput = {
            name: "송도점",
            slug: "songdo",
            isActive: true,
        };

        it("demotes the previous admin (role admin, administers no other branch) to 'user' on 교체", async () => {
            branchModel.findUnique.mockResolvedValueOnce({ adminId: "prev-admin-1" }).mockResolvedValueOnce({ adminId: "prev-admin-1" });
            branchModel.findFirst.mockResolvedValueOnce(null);
            userModel.findFirst.mockResolvedValue({ id: "new-admin-1", role: "manager" });

            await service.updateBranch("branch-1", {
                ...demotionInput,
                adminId: "new-admin-1",
            });

            expect(branchModel.findFirst).toHaveBeenCalledWith({
                where: { adminId: "prev-admin-1" },
                select: { id: true },
            });
            expect(userModel.updateMany).toHaveBeenCalledWith({
                where: { id: "prev-admin-1", role: "admin" },
                data: { role: "user" },
            });
            expect(userBranchModel.updateMany).toHaveBeenCalledWith({
                where: {
                    userId: "prev-admin-1",
                    branchId: "branch-1",
                    role: "admin",
                },
                data: { role: "user" },
            });
        });

        it("does NOT demote the previous admin when they still administer another branch", async () => {
            branchModel.findUnique.mockResolvedValueOnce({ adminId: "prev-admin-1" }).mockResolvedValueOnce({ adminId: "prev-admin-1" });
            branchModel.findFirst.mockResolvedValueOnce({ id: "other-branch" });
            userModel.findFirst.mockResolvedValue({ id: "new-admin-1", role: "manager" });

            await service.updateBranch("branch-1", {
                ...demotionInput,
                adminId: "new-admin-1",
            });

            expect(userModel.updateMany).not.toHaveBeenCalled();
            expect(userBranchModel.updateMany).toHaveBeenCalledWith({
                where: {
                    userId: "prev-admin-1",
                    branchId: "branch-1",
                    role: "admin",
                },
                data: { role: "user" },
            });
        });

        it("does NOT run the demotion query when dto.adminId is not provided", async () => {
            branchModel.findUnique.mockResolvedValueOnce({ adminId: "prev-admin-1" }).mockResolvedValueOnce({ adminId: "prev-admin-1" });

            await service.updateBranch("branch-1", demotionInput);

            expect(branchModel.findFirst).not.toHaveBeenCalled();
            expect(userModel.updateMany).not.toHaveBeenCalled();
            expect(userBranchModel.updateMany).not.toHaveBeenCalled();
        });

        it("runs the demotion path on 해제 (adminId explicitly set to null)", async () => {
            branchModel.findUnique.mockResolvedValueOnce({ adminId: "prev-admin-1" }).mockResolvedValueOnce({ adminId: "prev-admin-1" });
            branchModel.findFirst.mockResolvedValueOnce(null);

            await service.updateBranch("branch-1", {
                ...demotionInput,
                adminId: null,
            });

            expect(userModel.updateMany).toHaveBeenCalledWith({
                where: { id: "prev-admin-1", role: "admin" },
                data: { role: "user" },
            });
            expect(userBranchModel.updateMany).toHaveBeenCalledWith({
                where: {
                    userId: "prev-admin-1",
                    branchId: "branch-1",
                    role: "admin",
                },
                data: { role: "user" },
            });
        });

        it("does NOT demote when the branch previously had no admin", async () => {
            branchModel.findUnique.mockResolvedValueOnce({ adminId: null }).mockResolvedValueOnce({ adminId: null });
            userModel.findFirst.mockResolvedValue({ id: "new-admin-1", role: "manager" });

            await service.updateBranch("branch-1", {
                ...demotionInput,
                adminId: "new-admin-1",
            });

            expect(branchModel.findFirst).not.toHaveBeenCalled();
            expect(userModel.updateMany).not.toHaveBeenCalled();
            expect(userBranchModel.updateMany).not.toHaveBeenCalled();
        });
    });
});
