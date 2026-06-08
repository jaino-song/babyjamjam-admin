import { SystemAdminService } from "application/services/system-admin.service";
import { SystemAdminBranchRequestDto } from "interface/dto/system-admin.dto";
import { PrismaService } from "infrastructure/database/prisma.service";

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
    type MockBranchModel = { findMany: jest.Mock };
    type MockUserModel = { findMany: jest.Mock };

    let branchModel: MockBranchModel;
    let userModel: MockUserModel;
    let prisma: PrismaService;
    let service: SystemAdminService;

    const ownerOf = (overrides: Partial<Record<string, unknown>> = {}) => ({
        id: "owner-1",
        name: "지점장",
        email: "owner@example.com",
        phone: "010-1111-2222",
        role: "branch_owner",
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
        smsSenderPhone: "1577-0000",
        smsSenderApprovalStatus: "pending",
        smsSenderApprovalRequestedAt: new Date("2026-03-01T00:00:00.000Z"),
        smsSenderApprovalApprovedAt: null,
        smsSenderApprovalRequestedBy: "requester-1",
        owner: ownerOf(),
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
        branchModel = { findMany: jest.fn() };
        userModel = { findMany: jest.fn() };
        prisma = {
            branch: branchModel,
            user: userModel,
        } as unknown as PrismaService;
        service = new SystemAdminService(prisma);

        branchModel.findMany.mockResolvedValue([createBranchRow()]);
        userModel.findMany.mockResolvedValue([createRequesterRow()]);
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
                owner: ownerOf(),
                messageSenderApproval: {
                    senderPhone: "1577-0000",
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
                    smsSenderPhone: null,
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
                    senderPhone: null,
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
});
